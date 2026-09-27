import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';

import { createDatabase, runMigrations } from '../../src/db/index.js';
import { ErrorCodes } from '../../src/domain/envelope.js';
import { Roles } from '../../src/domain/authorization.js';
import { McpGateway } from '../../src/gateway/mcpGateway.js';
import { executeMcpHttpRequest } from '../../src/gateway/mcpHttpTransport.js';
import { SpaceIsolationService } from '../../src/services/spaceIsolationService.js';
import { AttachmentService } from '../../src/services/attachmentService.js';

const pdf = Buffer.from('%PDF-1.7\nconteúdo');

function setup() {
  const db = createDatabase(':memory:');
  runMigrations(db);
  const service = new SpaceIsolationService(db);
  const owner = service.createUser({ name: 'Owner', email: `owner-${crypto.randomUUID()}@test.dev` });
  const editor = service.createUser({ name: 'Editor', email: `editor-${crypto.randomUUID()}@test.dev` });
  const viewer = service.createUser({ name: 'Viewer', email: `viewer-${crypto.randomUUID()}@test.dev` });
  const space = service.createSpace({ name: 'Espaço', ownerUserId: owner.id });
  const ownerContext = service.resolveAuthContext({ userId: owner.id, spaceId: space.id });
  service.addMember(ownerContext, { targetUserId: editor.id, role: Roles.EDITOR });
  service.addMember(ownerContext, { targetUserId: viewer.id, role: Roles.VIEWER });
  const attachmentService = new AttachmentService(db, service);
  return {
    db,
    attachmentService,
    ownerContext,
    editorContext: service.resolveAuthContext({ userId: editor.id, spaceId: space.id }),
    viewerContext: service.resolveAuthContext({ userId: viewer.id, spaceId: space.id }),
  };
}

async function upload(attachmentService, context) {
  return attachmentService.uploadAttachment(context, pdf, {
    entityType: 'transaction',
    entityId: crypto.randomUUID(),
    fileName: 'nota.pdf',
    declaredMimeType: 'application/pdf',
  });
}

async function cleanup(attachmentId) {
  await fs.rm(path.join(process.cwd(), '.data', 'attachments', `${attachmentId}.pdf`), { force: true });
}

test('anexos: URL temporária usa token de uso único, expira e mantém token fora da auditoria', async (t) => {
  const { db, attachmentService, ownerContext } = setup();
  const attachment = await upload(attachmentService, ownerContext);
  t.after(() => cleanup(attachment.id));

  const issued = await attachmentService.createDownloadUrl(ownerContext, attachment.id, { expiresInSeconds: 60 });
  assert.match(issued.downloadUrl, /^\/api\/v1\/attachments\/[\w-]+\/download\?token=/);
  assert.equal(issued.expiresAt.length > 0, true);
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM audit_logs WHERE action = 'attachment.download_url' AND new_data LIKE '%token%' ").get().count, 0);

  const token = new URL(`https://moneyflow.test${issued.downloadUrl}`).searchParams.get('token');
  const first = await executeMcpHttpRequest(new McpGateway({ attachmentService }), {
    method: 'GET', path: issued.downloadUrl, body: null, authContext: null,
  });
  assert.equal(first.status, 200);
  assert.equal(first.body.data.content_base64, pdf.toString('base64'));
  await assert.rejects(
    () => attachmentService.downloadAttachmentByToken(attachment.id, token),
    (error) => error.code === ErrorCodes.NOT_FOUND,
  );

  const expired = await attachmentService.createDownloadUrl(ownerContext, attachment.id, { expiresInSeconds: 1 });
  const expiredToken = new URL(`https://moneyflow.test${expired.downloadUrl}`).searchParams.get('token');
  db.prepare('UPDATE attachment_download_tokens SET expires_at = ? WHERE token_hash = ?')
    .run(new Date(Date.now() - 1_000).toISOString(), attachmentService.hashDownloadToken(expiredToken));
  await assert.rejects(
    () => attachmentService.downloadAttachmentByToken(attachment.id, expiredToken),
    (error) => error.code === ErrorCodes.NOT_FOUND,
  );
});

test('anexos: exclusão lógica bloqueia download, invalida URLs e é auditada; purge remove arquivo expirado', async (t) => {
  const { db, attachmentService, editorContext, ownerContext } = setup();
  const attachment = await upload(attachmentService, editorContext);
  t.after(() => cleanup(attachment.id));
  const issued = await attachmentService.createDownloadUrl(editorContext, attachment.id, { expiresInSeconds: 60 });
  const token = new URL(`https://moneyflow.test${issued.downloadUrl}`).searchParams.get('token');

  await attachmentService.deleteAttachment(editorContext, attachment.id);
  await assert.rejects(() => attachmentService.downloadAttachment(editorContext, attachment.id), /not found/i);
  await assert.rejects(() => attachmentService.downloadAttachmentByToken(attachment.id, token), /not found/i);
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM audit_logs WHERE action = 'attachment.delete'").get().count, 1);

  await attachmentService.setRetentionPolicy(ownerContext, { retentionDays: 1 });
  const retained = await upload(attachmentService, ownerContext);
  t.after(() => cleanup(retained.id));
  assert.match(db.prepare('SELECT expires_at FROM attachments WHERE id = ?').get(retained.id).expires_at, /^\d{4}-\d{2}-\d{2}T/);
  db.prepare('UPDATE attachments SET expires_at = ? WHERE id = ?').run(new Date(Date.now() - 1_000).toISOString(), retained.id);
  const result = await attachmentService.purgeExpiredAttachments(ownerContext);
  assert.equal(result.purged, 1);
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM attachments WHERE id = ?').get(retained.id).count, 0);
  await assert.rejects(() => fs.access(path.join(process.cwd(), '.data', 'attachments', `${retained.id}.pdf`)));
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM audit_logs WHERE action = 'attachment.expire'").get().count, 1);
});

test('anexos: isolamento por espaço, limites de papel e ferramentas MCP novas', async (t) => {
  const { attachmentService, editorContext, viewerContext } = setup();
  const attachment = await upload(attachmentService, editorContext);
  t.after(() => cleanup(attachment.id));
  const gateway = new McpGateway({ attachmentService });

  assert.equal(gateway.getToolNames().includes('anexos_download_url'), true);
  assert.equal(gateway.getToolNames().includes('anexos_delete'), true);
  assert.equal(gateway.getToolNames().includes('anexos_purge_expired'), true);
  const issued = await gateway.executeTool('anexos_download_url', { attachment_id: attachment.id, expires_in_seconds: 60 }, viewerContext);
  assert.equal(issued.status, 'ok');
  for (let request = 1; request < 30; request += 1) {
    await gateway.executeTool('anexos_download_url', { attachment_id: attachment.id, expires_in_seconds: 60 }, viewerContext);
  }
  await assert.rejects(
    () => gateway.executeTool('anexos_download_url', { attachment_id: attachment.id, expires_in_seconds: 60 }, viewerContext),
    (error) => error.code === ErrorCodes.RATE_LIMITED,
  );
  await assert.rejects(
    () => gateway.executeTool('anexos_delete', { attachment_id: attachment.id }, viewerContext),
    (error) => error.code === ErrorCodes.FORBIDDEN,
  );
});
