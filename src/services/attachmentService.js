import { randomUUID } from 'node:crypto';
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

export class AttachmentService {
  constructor(db, spaceIsolationService) {
    this.db = db;
    this.spaceIsolationService = spaceIsolationService;
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

    await this._ensureUploadDir();
    const id = randomUUID();
    const storagePath = path.join(UPLOAD_DIR, `${id}${CANONICAL_EXTENSIONS[realMimeType]}`);

    // A própria inserção é a reserva de cota: a subconsulta e o INSERT pertencem
    // à mesma instrução SQLite, portanto não há janela entre validar e reservar.
    const reservation = this.db.prepare(
      `INSERT INTO attachments (id, space_id, entity_type, entity_id, file_name, mime_type, real_mime_type, file_size, storage_path, uploaded_by)
       SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
       WHERE COALESCE((SELECT SUM(file_size) FROM attachments WHERE space_id = ? AND deleted_at IS NULL), 0) + ? <= ?`,
    ).run(
      id, authContext.spaceId, entityType, entityId, normalizedFileName, declaredMimeType, realMimeType,
      buffer.length, storagePath, authContext.userId, authContext.spaceId, buffer.length, limits.maxSpace,
    );
    if (reservation.changes !== 1) {
      throw new AppError(ErrorCodes.VALIDATION_ERROR, `Space quota exceeded for role ${role}.`, 400);
    }

    try {
      await fs.writeFile(storagePath, buffer, { flag: 'wx' });
    } catch (error) {
      this.db.prepare('DELETE FROM attachments WHERE id = ? AND space_id = ?').run(id, authContext.spaceId);
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

    return { id, fileName: normalizedFileName, realMimeType, fileSize: buffer.length };
  }

  async downloadAttachment(authContext, attachmentId) {
    requireAuthorization(authContext, Permissions.ATTACHMENTS_READ);

    const att = this.db.prepare('SELECT * FROM attachments WHERE id = ? AND space_id = ? AND deleted_at IS NULL').get(attachmentId, authContext.spaceId);
    if (!att) {
      throw new AppError(ErrorCodes.NOT_FOUND, 'Attachment not found.', 404);
    }

    try {
      const buffer = await fs.readFile(att.storage_path);
      
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
}
