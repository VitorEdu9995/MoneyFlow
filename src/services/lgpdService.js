import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import { AppError, ErrorCodes } from '../domain/envelope.js';
import { Permissions, requireAuthorization } from '../domain/authorization.js';

export class LgpdService {
  constructor(db, spaceIsolationService, attachmentService = null) {
    this.db = db;
    this.spaceIsolationService = spaceIsolationService;
    this.attachmentService = attachmentService;
  }

  async exportSpaceData(authContext) {
    requireAuthorization(authContext, Permissions.SPACE_UPDATE);
    const spaceId = authContext.spaceId;
    const space = this.spaceIsolationService.getSpace(spaceId);
    if (!space) {
      throw new AppError(ErrorCodes.NOT_FOUND, 'Espaço de trabalho não encontrado.', 404);
    }

    const members = this.db.prepare(`
      SELECT sm.id, sm.role, sm.status, u.id as user_id, u.name as user_name, u.email as user_email, sm.created_at
      FROM space_members sm
      JOIN users u ON u.id = sm.user_id
      WHERE sm.space_id = ?
    `).all(spaceId);

    const accounts = this.db.prepare('SELECT * FROM accounts WHERE space_id = ?').all(spaceId);
    const categories = this.db.prepare('SELECT * FROM categories WHERE space_id = ?').all(spaceId);
    const tags = this.db.prepare('SELECT * FROM tags WHERE space_id = ?').all(spaceId);
    const creditCards = this.db.prepare('SELECT * FROM credit_cards WHERE space_id = ?').all(spaceId);
    const creditCardInvoices = this.db.prepare('SELECT * FROM credit_card_invoices WHERE space_id = ?').all(spaceId);
    const transactions = this.db.prepare('SELECT * FROM transactions WHERE space_id = ? AND deleted_at IS NULL').all(spaceId);
    const goals = this.db.prepare('SELECT * FROM goals WHERE space_id = ? AND deleted_at IS NULL').all(spaceId);
    const piggyBanks = this.db.prepare('SELECT * FROM piggy_banks WHERE space_id = ?').all(spaceId);
    const attachments = this.db.prepare(`
      SELECT id, entity_type, entity_id, file_name, mime_type, real_mime_type, file_size, uploaded_by, created_at, expires_at
      FROM attachments WHERE space_id = ? AND deleted_at IS NULL
    `).all(spaceId);

    const auditLogs = this.db.prepare('SELECT id, actor_user_id, action, entity_type, entity_id, created_at FROM audit_logs WHERE space_id = ? ORDER BY created_at ASC').all(spaceId);

    const exportedAt = new Date().toISOString();
    const exportId = randomUUID();

    const exportPayload = {
      schemaVersion: '1.0',
      exportId,
      exportedAt,
      spaceId,
      requestedBy: authContext.userId,
      space,
      members,
      accounts,
      categories,
      tags,
      creditCards,
      creditCardInvoices,
      transactions,
      goals,
      piggyBanks,
      attachments,
      auditLogs,
    };

    this.spaceIsolationService.logAudit({
      spaceId,
      actorUserId: authContext.userId,
      action: 'lgpd.export',
      entityType: 'spaces',
      entityId: spaceId,
      newData: { exportId, exportedAt, totalRecords: transactions.length + accounts.length + attachments.length }
    });

    return exportPayload;
  }

  async deleteOrAnonymizeSpaceData(authContext, { confirmation, mode = 'anonymize' } = {}) {
    requireAuthorization(authContext, Permissions.SPACE_DELETE);
    const spaceId = authContext.spaceId;
    if (confirmation !== 'CONFIRMO_EXCLUSAO_DEFINITIVA') {
      throw new AppError(
        ErrorCodes.VALIDATION_ERROR,
        'Confirmação explícita "CONFIRMO_EXCLUSAO_DEFINITIVA" é obrigatória para processar solicitação LGPD.',
        400,
      );
    }

    const space = this.spaceIsolationService.getSpace(spaceId);
    if (!space) {
      throw new AppError(ErrorCodes.NOT_FOUND, 'Espaço de trabalho não encontrado.', 404);
    }

    const timestamp = new Date().toISOString();

    if (mode === 'anonymize') {
      const atts = this.db.prepare('SELECT storage_path FROM attachments WHERE space_id = ?').all(spaceId);
      for (const att of atts) {
        if (att.storage_path) {
          try { await fs.rm(att.storage_path, { force: true }); } catch {}
        }
      }

      this.db.prepare(`
        UPDATE transactions
        SET description = 'DADO_PESSOAL_ANONIMIZADO_LGPD'
        WHERE space_id = ?
      `).run(spaceId);

      this.db.prepare(`
        UPDATE accounts
        SET name = 'Conta Anonimizada ' || substr(id, 1, 8)
        WHERE space_id = ?
      `).run(spaceId);

      this.db.prepare(`
        UPDATE attachments
        SET file_name = 'anonimizado.bin',
            deleted_at = ?
        WHERE space_id = ?
      `).run(timestamp, spaceId);

      this.db.prepare(`UPDATE spaces SET archived_at = ?, name = 'Espaço Anonimizado LGPD' WHERE id = ?`).run(timestamp, spaceId);

      this.spaceIsolationService.logAudit({
        spaceId,
        actorUserId: authContext.userId,
        action: 'lgpd.anonymize',
        entityType: 'spaces',
        entityId: spaceId,
        newData: { timestamp, mode: 'anonymize' },
      });

      return { status: 'anonymized', spaceId, timestamp };
    } else if (mode === 'hard_delete') {
      const atts = this.db.prepare('SELECT storage_path FROM attachments WHERE space_id = ?').all(spaceId);
      for (const att of atts) {
        if (att.storage_path) {
          try { await fs.rm(att.storage_path, { force: true }); } catch {}
        }
      }

      this.db.prepare('DELETE FROM attachments WHERE space_id = ?').run(spaceId);
      this.db.prepare('DELETE FROM attachment_download_tokens WHERE space_id = ?').run(spaceId);
      this.db.prepare('DELETE FROM attachment_retention_policies WHERE space_id = ?').run(spaceId);
      this.db.prepare('DELETE FROM piggy_banks WHERE space_id = ?').run(spaceId);
      this.db.prepare('DELETE FROM goals WHERE space_id = ?').run(spaceId);
      this.db.prepare('DELETE FROM transactions WHERE space_id = ?').run(spaceId);
      this.db.prepare('DELETE FROM credit_card_invoices WHERE space_id = ?').run(spaceId);
      this.db.prepare('DELETE FROM credit_cards WHERE space_id = ?').run(spaceId);
      this.db.prepare('DELETE FROM accounts WHERE space_id = ?').run(spaceId);
      this.db.prepare('DELETE FROM tags WHERE space_id = ?').run(spaceId);
      this.db.prepare('DELETE FROM categories WHERE space_id = ?').run(spaceId);
      this.db.prepare('DELETE FROM space_members WHERE space_id = ?').run(spaceId);
      this.db.prepare('DELETE FROM spaces WHERE id = ?').run(spaceId);

      this.spaceIsolationService.logAudit({
        spaceId,
        actorUserId: authContext.userId,
        action: 'lgpd.deletion',
        entityType: 'spaces',
        entityId: spaceId,
        newData: { timestamp, mode: 'hard_delete', evidence: 'Dados e arquivos removidos com sucesso em conformidade com art. 18 LGPD' },
      });

      return { status: 'deleted', spaceId, timestamp };
    } else {
      throw new AppError(ErrorCodes.VALIDATION_ERROR, `Modo inválido '${mode}'. Válidos: anonymize, hard_delete.`, 400);
    }
  }
}
