import { createHash, randomBytes, randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { AppError, ErrorCodes } from '../domain/envelope.js';
import { Permissions, requireAuthorization } from '../domain/authorization.js';
import { logger, redact } from '../utils/logger.js';

const UPLOAD_DIR = path.join(process.cwd(), '.data', 'attachments');

const ROLE_LIMITS = {
  editor: { maxFile: 5 * 1024 * 1024, maxSpace: 100 * 1024 * 1024 },
  admin: { maxFile: 10 * 1024 * 1024, maxSpace: 500 * 1024 * 1024 },
  owner: { maxFile: 20 * 1024 * 1024, maxSpace: 1024 * 1024 * 1024 },
  viewer: { maxFile: 0, maxSpace: 0 }
};

const MIME_EXTENSIONS = Object.freeze({
  'application/pdf': ['.pdf'],
  'image/jpeg': ['.jpg', '.jpeg'],
  'image/png': ['.png'],
});
const CANONICAL_EXTENSIONS = Object.freeze({
  'application/pdf': '.pdf',
  'image/jpeg': '.jpg',
  'image/png': '.png',
});
const MAX_FILE_NAME_BYTES = 255;
const DEFAULT_RETENTION_DAYS = 30;
const MAX_DOWNLOAD_URL_SECONDS = 15 * 60;
const DOWNLOAD_URL_RATE_LIMIT = 30;
const DOWNLOAD_URL_RATE_WINDOW_MS = 60 * 1000;
const ATTACHABLE_ENTITIES = Object.freeze({
  transaction: 'transactions',
  account: 'accounts',
  credit_card: 'credit_cards',
  category: 'categories',
});

export class AttachmentService {
  constructor(db, spaceIsolationService, { metrics = null } = {}) {
    this.db = db;
    this.spaceIsolationService = spaceIsolationService;
    this.downloadUrlRequests = new Map();
    this.metrics = metrics;
  }

  setMetrics(metrics) {
    this.metrics = metrics;
  }

  getStorageUsage(spaceId = null) {
    let query = 'SELECT COUNT(*) AS attachments, COALESCE(SUM(file_size), 0) AS bytes FROM attachments WHERE deleted_at IS NULL';
    const params = [];
    if (spaceId) {
      query += ' AND space_id = ?';
      params.push(spaceId);
    }
    const usage = this.db.prepare(query).get(...params);
    return { attachments: usage.attachments, bytes: usage.bytes };
  }

  _recordStorageUsage(spaceId = null) {
    this.metrics?.recordStorageUsage(this.getStorageUsage(spaceId));
  }

  hashDownloadToken(token) {
    return createHash('sha256').update(token).digest('hex');
  }

  _now() {
    return new Date().toISOString();
  }

  _getRetentionDays(spaceId) {
    return this.db.prepare('SELECT retention_days FROM attachment_retention_policies WHERE space_id = ?').get(spaceId)?.retention_days
      ?? DEFAULT_RETENTION_DAYS;
  }

  _activeAttachment(attachmentId, spaceId = null) {
    const spaceCondition = spaceId ? ' AND space_id = ?' : '';
    const params = spaceId ? [attachmentId, spaceId, this._now()] : [attachmentId, this._now()];
    return this.db.prepare(
      `SELECT * FROM attachments WHERE id = ?${spaceCondition} AND deleted_at IS NULL AND (expires_at IS NULL OR expires_at > ?)`,
    ).get(...params);
  }

  _assertDownloadUrlRateLimit(authContext) {
    const key = `${authContext.spaceId}:${authContext.userId}`;
    const now = Date.now();
    const requests = (this.downloadUrlRequests.get(key) || []).filter((timestamp) => timestamp > now - DOWNLOAD_URL_RATE_WINDOW_MS);
    if (requests.length >= DOWNLOAD_URL_RATE_LIMIT) {
      this.metrics?.recordRateLimit({ scope: 'attachment_download_url' });
      throw new AppError(ErrorCodes.RATE_LIMITED, 'Limite de geração de URLs temporárias excedido. Tente novamente em breve.', 429);
    }
    requests.push(now);
    this.downloadUrlRequests.set(key, requests);
  }

  async _ensureUploadDir() {
    await fs.mkdir(UPLOAD_DIR, { recursive: true });
  }

  _getRealMimeType(buffer) {
    if (buffer.length < 8) return 'application/octet-stream';
    const hex = buffer.toString('hex', 0, 8).toUpperCase();
    if (hex.startsWith('255044462D')) return 'application/pdf'; // %PDF-
    if (hex.startsWith('FFD8FF')) return 'image/jpeg';
    if (hex.startsWith('89504E470D0A1A0A')) return 'image/png';
    return 'application/octet-stream';
  }

  _normalizeFileName(fileName, realMimeType) {
    if (typeof fileName !== 'string' || fileName.length === 0) {
      throw new AppError(ErrorCodes.VALIDATION_ERROR, 'Nome do arquivo é obrigatório.', 400);
    }

    const normalized = fileName.normalize('NFC').replaceAll('\\', '/');
    const baseName = path.posix.basename(normalized);
    if (baseName !== normalized || Buffer.byteLength(baseName, 'utf8') > MAX_FILE_NAME_BYTES) {
      throw new AppError(ErrorCodes.VALIDATION_ERROR, 'Nome do arquivo é inválido ou excede 255 bytes.', 400);
    }

    const extension = path.posix.extname(baseName).toLowerCase();
    if (!MIME_EXTENSIONS[realMimeType]?.includes(extension)) {
      throw new AppError(
        ErrorCodes.VALIDATION_ERROR,
        'Extensão do arquivo não corresponde ao tipo detectado. Apenas PDF, JPEG e PNG são aceitos.',
        400,
      );
    }

    return `${baseName.slice(0, -extension.length)}${CANONICAL_EXTENSIONS[realMimeType]}`;
  }

  _assertAttachableEntity(authContext, entityType, entityId) {
    const table = ATTACHABLE_ENTITIES[entityType];
    if (!table) {
      throw new AppError(ErrorCodes.VALIDATION_ERROR, 'Tipo de entidade para anexo não permitido.', 400);
    }
    if (typeof entityId !== 'string' || entityId.length === 0) {
      throw new AppError(ErrorCodes.VALIDATION_ERROR, 'Identificador da entidade para anexo é obrigatório.', 400);
    }
    const entity = this.db.prepare(`SELECT id FROM ${table} WHERE id = ? AND space_id = ?`).get(entityId, authContext.spaceId);
    if (!entity) {
      throw new AppError(ErrorCodes.NOT_FOUND, 'Entidade para anexo não encontrada.', 404);
    }
  }

  async uploadAttachment(authContext, buffer, { entityType, entityId, fileName, declaredMimeType }) {
    requireAuthorization(authContext, Permissions.ATTACHMENTS_WRITE);

    if (!Buffer.isBuffer(buffer)) {
      throw new AppError(ErrorCodes.VALIDATION_ERROR, 'Conteúdo do arquivo deve ser binário.', 400);
    }

    const role = authContext.membership.role;
    const limits = ROLE_LIMITS[role];

    if (buffer.length > limits.maxFile) {
      throw new AppError(ErrorCodes.VALIDATION_ERROR, `File size exceeds limit for role ${role}.`, 400);
    }

    const realMimeType = this._getRealMimeType(buffer);
    const allowed = ['application/pdf', 'image/jpeg', 'image/png'];
    if (!allowed.includes(realMimeType)) {
      throw new AppError(ErrorCodes.VALIDATION_ERROR, 'Invalid real MIME type. Only PDF, JPEG and PNG allowed.', 400);
    }

    const normalizedFileName = this._normalizeFileName(fileName, realMimeType);
    this._assertAttachableEntity(authContext, entityType, entityId);

    await this._ensureUploadDir();
    const id = randomUUID();
    const storagePath = path.join(UPLOAD_DIR, `${id}${CANONICAL_EXTENSIONS[realMimeType]}`);

    // A própria inserção é a reserva de cota: a subconsulta e o INSERT pertencem
    // à mesma instrução SQLite, portanto não há janela entre validar e reservar.
    const retentionDays = this._getRetentionDays(authContext.spaceId);
    const expiresAt = new Date(Date.now() + retentionDays * 24 * 60 * 60 * 1000).toISOString();
    const reservation = this.db.prepare(
      `INSERT INTO attachments (id, space_id, entity_type, entity_id, file_name, mime_type, real_mime_type, file_size, storage_path, uploaded_by, expires_at)
       SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
       WHERE COALESCE((SELECT SUM(file_size) FROM attachments WHERE space_id = ? AND deleted_at IS NULL), 0) + ? <= ?`,
    ).run(
      id, authContext.spaceId, entityType, entityId, normalizedFileName, declaredMimeType, realMimeType,
      buffer.length, storagePath, authContext.userId, expiresAt, authContext.spaceId, buffer.length, limits.maxSpace,
    );
    if (reservation.changes !== 1) {
      throw new AppError(ErrorCodes.VALIDATION_ERROR, `Space quota exceeded for role ${role}.`, 400);
    }

    try {
      await fs.writeFile(storagePath, buffer, { flag: 'wx' });
    } catch (error) {
      this.db.prepare('DELETE FROM attachments WHERE id = ? AND space_id = ?').run(id, authContext.spaceId);
      this.metrics?.recordStorageFailure();
      throw error;
    }

    const newData = redact({ id, fileName: normalizedFileName, entityType, entityId, fileSize: buffer.length });

    this.spaceIsolationService.logAudit({
      spaceId: authContext.spaceId,
      actorUserId: authContext.userId,
      action: 'attachment.upload',
      entityType: 'attachments',
      entityId: id,
      newData
    });
    this._recordStorageUsage(authContext?.spaceId);

    return { id, fileName: normalizedFileName, realMimeType, fileSize: buffer.length };
  }

  async downloadAttachment(authContext, attachmentId) {
    requireAuthorization(authContext, Permissions.ATTACHMENTS_READ);

    const att = this._activeAttachment(attachmentId, authContext.spaceId);
    if (!att) {
      throw new AppError(ErrorCodes.NOT_FOUND, 'Attachment not found.', 404);
    }

    try {
      const buffer = await fs.readFile(att.storage_path);
      if (!this._activeAttachment(attachmentId, authContext.spaceId)) {
        throw new AppError(ErrorCodes.NOT_FOUND, 'Attachment not found.', 404);
      }
      
      this.spaceIsolationService.logAudit({
        spaceId: authContext.spaceId,
        actorUserId: authContext.userId,
        action: 'attachment.download',
        entityType: 'attachments',
        entityId: attachmentId
      });

      return {
        buffer,
        mimeType: att.real_mime_type,
        fileName: att.file_name
      };
    } catch (err) {
      throw new AppError(ErrorCodes.NOT_FOUND, 'Attachment file not found on disk.', 404);
    }
  }

  async setRetentionPolicy(authContext, { retentionDays }) {
    requireAuthorization(authContext, Permissions.SPACE_UPDATE);
    if (!Number.isInteger(retentionDays) || retentionDays < 1 || retentionDays > 3650) {
      throw new AppError(ErrorCodes.VALIDATION_ERROR, 'A retenção deve ser um número inteiro entre 1 e 3650 dias.', 400);
    }
    this.db.prepare(
      `INSERT INTO attachment_retention_policies (space_id, retention_days, updated_at) VALUES (?, ?, ?)
       ON CONFLICT(space_id) DO UPDATE SET retention_days = excluded.retention_days, updated_at = excluded.updated_at`,
    ).run(authContext.spaceId, retentionDays, this._now());
    return { retentionDays };
  }

  async createDownloadUrl(authContext, attachmentId, { expiresInSeconds } = {}) {
    requireAuthorization(authContext, Permissions.ATTACHMENTS_READ);
    if (!Number.isInteger(expiresInSeconds) || expiresInSeconds < 1 || expiresInSeconds > MAX_DOWNLOAD_URL_SECONDS) {
      throw new AppError(ErrorCodes.VALIDATION_ERROR, `A expiração da URL deve ser um inteiro entre 1 e ${MAX_DOWNLOAD_URL_SECONDS} segundos.`, 400);
    }
    this._assertDownloadUrlRateLimit(authContext);
    const attachment = this._activeAttachment(attachmentId, authContext.spaceId);
    if (!attachment) {
      throw new AppError(ErrorCodes.NOT_FOUND, 'Attachment not found.', 404);
    }

    const token = randomBytes(32).toString('base64url');
    const expiresAt = new Date(Date.now() + expiresInSeconds * 1000).toISOString();
    this.db.prepare(
      'INSERT INTO attachment_download_tokens (token_hash, attachment_id, space_id, created_by, expires_at) VALUES (?, ?, ?, ?, ?)',
    ).run(this.hashDownloadToken(token), attachment.id, attachment.space_id, authContext.userId, expiresAt);
    this.spaceIsolationService.logAudit({
      spaceId: authContext.spaceId,
      actorUserId: authContext.userId,
      action: 'attachment.download_url',
      entityType: 'attachments',
      entityId: attachment.id,
      newData: { expiresAt },
    });
    return {
      downloadUrl: `/api/v1/attachments/${encodeURIComponent(attachment.id)}/download?token=${encodeURIComponent(token)}`,
      expiresAt,
    };
  }

  async downloadAttachmentByToken(authContext, attachmentId, token) {
    const currentAuthContext = this.spaceIsolationService.resolveAuthContext({
      userId: authContext?.userId,
      spaceId: authContext?.spaceId,
      requestId: authContext?.requestId,
    });
    requireAuthorization(currentAuthContext, Permissions.ATTACHMENTS_READ);
    if (typeof attachmentId !== 'string' || typeof token !== 'string' || token.length < 32) {
      throw new AppError(ErrorCodes.NOT_FOUND, 'Attachment not found.', 404);
    }
    const now = this._now();
    const tokenHash = this.hashDownloadToken(token);
    const consumed = this.db.prepare(
      `UPDATE attachment_download_tokens SET used_at = ?
       WHERE token_hash = ? AND attachment_id = ? AND used_at IS NULL AND expires_at > ?
         AND space_id = ?
         AND EXISTS (SELECT 1 FROM attachments WHERE id = ? AND space_id = ? AND deleted_at IS NULL AND (expires_at IS NULL OR expires_at > ?))`,
    ).run(now, tokenHash, attachmentId, now, currentAuthContext.spaceId, attachmentId, currentAuthContext.spaceId, now);
    if (consumed.changes !== 1) {
      throw new AppError(ErrorCodes.NOT_FOUND, 'Attachment not found.', 404);
    }
    const attachment = this._activeAttachment(attachmentId, currentAuthContext.spaceId);
    if (!attachment) {
      throw new AppError(ErrorCodes.NOT_FOUND, 'Attachment not found.', 404);
    }
    try {
      const buffer = await fs.readFile(attachment.storage_path);
      if (!this._activeAttachment(attachmentId, currentAuthContext.spaceId)) {
        throw new AppError(ErrorCodes.NOT_FOUND, 'Attachment not found.', 404);
      }
      this.spaceIsolationService.logAudit({
        spaceId: attachment.space_id,
        actorUserId: currentAuthContext.userId,
        action: 'attachment.download',
        entityType: 'attachments',
        entityId: attachment.id,
        newData: { via: 'temporary_url' },
      });
      return { buffer, mimeType: attachment.real_mime_type, fileName: attachment.file_name };
    } catch {
      throw new AppError(ErrorCodes.NOT_FOUND, 'Attachment file not found on disk.', 404);
    }
  }

  async deleteAttachment(authContext, attachmentId, { hardDelete = false } = {}) {
    requireAuthorization(authContext, Permissions.ATTACHMENTS_WRITE);
    const attachment = this._activeAttachment(attachmentId, authContext.spaceId);
    if (!attachment) {
      throw new AppError(ErrorCodes.NOT_FOUND, 'Attachment not found.', 404);
    }
    const now = this._now();
    this.db.prepare('UPDATE attachments SET deleted_at = ? WHERE id = ? AND space_id = ? AND deleted_at IS NULL').run(now, attachment.id, authContext.spaceId);
    this.db.prepare('DELETE FROM attachment_download_tokens WHERE attachment_id = ?').run(attachment.id);
    this.spaceIsolationService.logAudit({
      spaceId: authContext.spaceId,
      actorUserId: authContext.userId,
      action: hardDelete ? 'attachment.hard_delete' : 'attachment.delete',
      entityType: 'attachments',
      entityId: attachment.id,
    });
    if (hardDelete) {
      await fs.rm(attachment.storage_path, { force: true });
      this.db.prepare('DELETE FROM attachments WHERE id = ? AND space_id = ?').run(attachment.id, authContext.spaceId);
      this._recordStorageUsage(authContext?.spaceId);
    }
    return { id: attachment.id, deleted: true, hardDeleted: hardDelete };
  }

  async purgeExpiredAttachments(authContext) {
    requireAuthorization(authContext, Permissions.SPACE_UPDATE);
    const now = this._now();
    const expired = this.db.prepare(
      'SELECT * FROM attachments WHERE space_id = ? AND expires_at IS NOT NULL AND expires_at <= ?',
    ).all(authContext.spaceId, now);
    for (const attachment of expired) {
      this.db.prepare('UPDATE attachments SET deleted_at = ? WHERE id = ? AND deleted_at IS NULL').run(now, attachment.id);
      this.db.prepare('DELETE FROM attachment_download_tokens WHERE attachment_id = ?').run(attachment.id);
      await fs.rm(attachment.storage_path, { force: true });
      this.db.prepare('DELETE FROM attachments WHERE id = ?').run(attachment.id);
      this.spaceIsolationService.logAudit({
        spaceId: authContext.spaceId,
        actorUserId: authContext.userId,
        action: 'attachment.expire',
        entityType: 'attachments',
        entityId: attachment.id,
      });
    }
    this._recordStorageUsage(authContext?.spaceId);
    return { purged: expired.length };
  }
}
