import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { AppError, ErrorCodes } from '../domain/envelope.js';
import { Permissions, requireAuthorization } from '../domain/authorization.js';
import { logger } from '../utils/logger.js';

const UPLOAD_DIR = path.join(process.cwd(), '.data', 'attachments');

const ROLE_LIMITS = {
  editor: { maxFile: 5 * 1024 * 1024, maxSpace: 100 * 1024 * 1024 },
  admin: { maxFile: 10 * 1024 * 1024, maxSpace: 500 * 1024 * 1024 },
  owner: { maxFile: 20 * 1024 * 1024, maxSpace: 1024 * 1024 * 1024 },
  viewer: { maxFile: 0, maxSpace: 0 }
};

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

  async uploadAttachment(authContext, buffer, { entityType, entityId, fileName, declaredMimeType }) {
    requireAuthorization(authContext, Permissions.ATTACHMENTS_WRITE);

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

    const currentUsageRow = this.db.prepare('SELECT COALESCE(SUM(file_size), 0) as total FROM attachments WHERE space_id = ? AND deleted_at IS NULL').get(authContext.spaceId);
    const currentUsage = currentUsageRow.total;

    if (currentUsage + buffer.length > limits.maxSpace) {
      throw new AppError(ErrorCodes.VALIDATION_ERROR, `Space quota exceeded for role ${role}.`, 400);
    }

    await this._ensureUploadDir();
    const id = randomUUID();
    const ext = path.extname(fileName);
    const storagePath = path.join(UPLOAD_DIR, `${id}${ext}`);

    await fs.writeFile(storagePath, buffer);

    this.db.prepare(
      `INSERT INTO attachments (id, space_id, entity_type, entity_id, file_name, mime_type, real_mime_type, file_size, storage_path, uploaded_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(id, authContext.spaceId, entityType, entityId, fileName, declaredMimeType, realMimeType, buffer.length, storagePath, authContext.userId);

    this.spaceIsolationService.logAudit({
      spaceId: authContext.spaceId,
      actorUserId: authContext.userId,
      action: 'attachment.upload',
      entityType: 'attachments',
      entityId: id,
      newData: { id, fileName, entityType, entityId, fileSize: buffer.length }
    });

    return { id, fileName, realMimeType, fileSize: buffer.length };
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
