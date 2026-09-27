import test from 'node:test';
import assert from 'node:assert';
import { DatabaseSync } from 'node:sqlite';
import { SpaceIsolationService } from '../../src/services/spaceIsolationService.js';
import { AttachmentService } from '../../src/services/attachmentService.js';
import { Roles } from '../../src/domain/authorization.js';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { McpGateway, MAX_ATTACHMENT_CONTENT_BASE64_LENGTH } from '../../src/gateway/mcpGateway.js';
import { executeMcpHttpRequest, MAX_MCP_BODY_BYTES } from '../../src/gateway/mcpHttpTransport.js';

function createAttachableTransaction(db, context) {
  const id = randomUUID();
  db.prepare(
    "INSERT INTO transactions (id, space_id, type, description, amount, transaction_date) VALUES (?, ?, 'expense', 'Anexo', 1, '2026-09-27')",
  ).run(id, context.spaceId);
  return id;
}

async function setup() {
  const db = new DatabaseSync(':memory:');
  const mig1 = await import('../../src/db/migrations/001_initial_schema.js');
  db.exec(mig1.up);
  const mig2 = await import('../../src/db/migrations/002_custom_attributes_and_purchases.js');
  db.exec(mig2.up);
  const mig3 = await import('../../src/db/migrations/003_financial_core_phase2.js');
  db.exec(mig3.up);
  const mig4 = await import('../../src/db/migrations/004_import_real_mvp_format.js');
  db.exec(mig4.up);
  const mig5 = await import('../../src/db/migrations/005_audit_log_append_only.js');
  db.exec(mig5.up);
  const mig6 = await import('../../src/db/migrations/006_attachments.js');
  db.exec(mig6.up);
  const mig9 = await import('../../src/db/migrations/009_attachment_lifecycle.js');
  db.exec(mig9.up);

  const iso = new SpaceIsolationService(db);
  const att = new AttachmentService(db, iso);
  return { db, iso, att };
}

test('Attachment IDOR: Cannot access attachment from other space', async () => {
  const { db, iso, att } = await setup();
  const u1 = iso.createUser({ name: 'U1', email: 'u1@a.com' });
  const u2 = iso.createUser({ name: 'U2', email: 'u2@a.com' });
  const s1 = iso.createSpace({ name: 'S1', ownerUserId: u1.id });
  const s2 = iso.createSpace({ name: 'S2', ownerUserId: u2.id });

  const ctx1 = iso.resolveAuthContext({ userId: u1.id, spaceId: s1.id });
  const ctx2 = iso.resolveAuthContext({ userId: u2.id, spaceId: s2.id });

  const buf = Buffer.from('255044462D312E340A25C3A4C3BCC3B6C39F0A', 'hex'); // PDF

  const res = await att.uploadAttachment(ctx1, buf, {
    entityType: 'transaction',
    entityId: createAttachableTransaction(db, ctx1),
    fileName: 'test.pdf',
    declaredMimeType: 'application/pdf'
  });

  await assert.rejects(
    async () => await att.downloadAttachment(ctx2, res.id),
    /Attachment not found/
  );
});

test('Attachment MIME validation: rejects fake PDF', async () => {
  const { iso, att } = await setup();
  const u1 = iso.createUser({ name: 'U1', email: 'u1@a.com' });
  const s1 = iso.createSpace({ name: 'S1', ownerUserId: u1.id });
  const ctx1 = iso.resolveAuthContext({ userId: u1.id, spaceId: s1.id });

  const buf = Buffer.from('this is not a pdf file');

  await assert.rejects(
    async () => await att.uploadAttachment(ctx1, buf, {
      entityType: 'transaction',
      entityId: randomUUID(),
      fileName: 'test.pdf',
      declaredMimeType: 'application/pdf'
    }),
    /Invalid real MIME type/
  );
});

test('Attachment quotas and role limits', async () => {
  const { iso, att } = await setup();
  const u1 = iso.createUser({ name: 'U1', email: 'u1@a.com' }); // owner
  const u2 = iso.createUser({ name: 'U2', email: 'u2@a.com' }); // viewer
  const s1 = iso.createSpace({ name: 'S1', ownerUserId: u1.id });
  iso.addMember(iso.resolveAuthContext({ userId: u1.id, spaceId: s1.id }), { targetUserId: u2.id, role: Roles.VIEWER });

  const ctx2 = iso.resolveAuthContext({ userId: u2.id, spaceId: s1.id });

  const buf = Buffer.from('255044462D312E340A25C3A4C3BCC3B6C39F0A', 'hex'); // PDF

  await assert.rejects(
    async () => await att.uploadAttachment(ctx2, buf, {
      entityType: 'transaction',
      entityId: randomUUID(),
      fileName: 'test.pdf',
      declaredMimeType: 'application/pdf'
    }),
    /negada: o papel 'viewer' n/
  );
});

test('Attachment audit redacts PII embedded in file names before persistence', async () => {
  const { db, iso, att } = await setup();
  const user = iso.createUser({ name: 'U1', email: 'u1@a.com' });
  const space = iso.createSpace({ name: 'S1', ownerUserId: user.id });
  const context = iso.resolveAuthContext({ userId: user.id, spaceId: space.id });
  const cardNumber = '4111 1111 1111 1111';
  const pdf = Buffer.from('255044462D312E340A25C3A4C3BCC3B6C39F0A', 'hex');

  await att.uploadAttachment(context, pdf, {
    entityType: 'transaction',
    entityId: createAttachableTransaction(db, context),
    fileName: `fatura-${cardNumber}.pdf`,
    declaredMimeType: 'application/pdf'
  });

  const audit = db.prepare("SELECT new_data FROM audit_logs WHERE action = 'attachment.upload'").get();
  const newData = JSON.parse(audit.new_data);

  assert.doesNotMatch(audit.new_data, new RegExp(cardNumber.replaceAll(' ', '\\s*')));
  assert.strictEqual(newData.fileName, 'fatura-[REDACTED].pdf');
});

test('Attachment quota: reserva atômica impede 21 uploads concorrentes de 5 MiB em espaço de editor', async () => {
  const { db, iso, att } = await setup();
  const owner = iso.createUser({ name: 'Owner', email: 'owner@quota.test' });
  const editor = iso.createUser({ name: 'Editor', email: 'editor@quota.test' });
  const space = iso.createSpace({ name: 'Quota', ownerUserId: owner.id });
  const ownerContext = iso.resolveAuthContext({ userId: owner.id, spaceId: space.id });
  iso.addMember(ownerContext, { targetUserId: editor.id, role: Roles.EDITOR });
  const context = iso.resolveAuthContext({ userId: editor.id, spaceId: space.id });
  const entityId = createAttachableTransaction(db, context);
  const pdf = Buffer.alloc(5 * 1024 * 1024);
  Buffer.from('%PDF-1.7\n').copy(pdf);

  const outcomes = await Promise.allSettled(
    Array.from({ length: 21 }, (_, index) => att.uploadAttachment(context, pdf, {
      entityType: 'transaction',
      entityId,
      fileName: `quota-${index}.pdf`,
      declaredMimeType: 'application/pdf',
    })),
  );

  const successful = outcomes.filter((outcome) => outcome.status === 'fulfilled');
  const rejected = outcomes.filter((outcome) => outcome.status === 'rejected');
  const { total } = db.prepare('SELECT COALESCE(SUM(file_size), 0) AS total FROM attachments WHERE space_id = ?').get(space.id);

  assert.equal(successful.length, 20);
  assert.equal(rejected.length, 1);
  assert.equal(total, 100 * 1024 * 1024);

  await Promise.all(successful.map(({ value }) => fs.rm(path.join(process.cwd(), '.data', 'attachments', `${value.id}.pdf`), { force: true })));
});

test('Attachment upload hardening: rejeita base64 excessivo antes de decodificar e corpo MCP excessivo', async () => {
  const { db, iso } = await setup();
  const user = iso.createUser({ name: 'U1', email: 'dos@test.dev' });
  const space = iso.createSpace({ name: 'S1', ownerUserId: user.id });
  const context = iso.resolveAuthContext({ userId: user.id, spaceId: space.id });
  const gateway = new McpGateway({ service: iso });
  const entityId = createAttachableTransaction(db, context);
  const oversizedBase64 = 'A'.repeat(MAX_ATTACHMENT_CONTENT_BASE64_LENGTH + 4);

  await assert.rejects(
    () => gateway.executeTool('anexos_upload', {
      entity_type: 'transaction', entity_id: entityId, file_name: 'nota.pdf',
      declared_mime_type: 'application/pdf', content_base64: oversizedBase64,
    }, context),
    (error) => error.code === 'VALIDATION_ERROR',
  );

  const response = await executeMcpHttpRequest(gateway, {
    method: 'POST', path: '/api/v1/mcp/execute', authContext: context,
    body: { toolName: 'list_accounts', args: { padding: 'x'.repeat(MAX_MCP_BODY_BYTES) } },
  });
  assert.equal(response.status, 413);
  assert.equal(response.body.error.code, 'VALIDATION_ERROR');
});

test('Attachment upload hardening: rejeita tipo não permitido, entidade ausente e referência de outro espaço', async () => {
  const { db, iso, att } = await setup();
  const owner = iso.createUser({ name: 'Owner', email: 'owner-entity@test.dev' });
  const other = iso.createUser({ name: 'Other', email: 'other-entity@test.dev' });
  const space = iso.createSpace({ name: 'S1', ownerUserId: owner.id });
  const otherSpace = iso.createSpace({ name: 'S2', ownerUserId: other.id });
  const context = iso.resolveAuthContext({ userId: owner.id, spaceId: space.id });
  const otherContext = iso.resolveAuthContext({ userId: other.id, spaceId: otherSpace.id });
  const pdf = Buffer.from('%PDF-1.7\nconteúdo');
  const foreignId = createAttachableTransaction(db, otherContext);

  await assert.rejects(
    () => att.uploadAttachment(context, pdf, { entityType: 'user', entityId: foreignId, fileName: 'nota.pdf', declaredMimeType: 'application/pdf' }),
    (error) => error.code === 'VALIDATION_ERROR',
  );
  await assert.rejects(
    () => att.uploadAttachment(context, pdf, { entityType: 'transaction', entityId: randomUUID(), fileName: 'nota.pdf', declaredMimeType: 'application/pdf' }),
    (error) => error.code === 'NOT_FOUND',
  );
  await assert.rejects(
    () => att.uploadAttachment(context, pdf, { entityType: 'transaction', entityId: foreignId, fileName: 'nota.pdf', declaredMimeType: 'application/pdf' }),
    (error) => error.code === 'NOT_FOUND',
  );
});

test('Extension tools sem handler retornam erro estável, sem fixture de sucesso', async () => {
  const { iso } = await setup();
  const user = iso.createUser({ name: 'U1', email: 'extension-handler@test.dev' });
  const space = iso.createSpace({ name: 'S1', ownerUserId: user.id });
  const context = iso.resolveAuthContext({ userId: user.id, spaceId: space.id });
  const gateway = new McpGateway({ service: iso });

  await assert.rejects(
    () => gateway.executeTool('create_attribute_definition', {
      target_type: 'transaction', name: 'Teste', slug: 'teste', data_type: 'text',
    }, context),
    (error) => error.code === 'NOT_IMPLEMENTED' && error.status === 501,
  );
});

test('Attachment MIME validation: assinatura válida com extensão não permitida é rejeitada', async () => {
  const { iso, att } = await setup();
  const user = iso.createUser({ name: 'U1', email: 'extension@test.dev' });
  const space = iso.createSpace({ name: 'S1', ownerUserId: user.id });
  const context = iso.resolveAuthContext({ userId: user.id, spaceId: space.id });
  const pdf = Buffer.from('%PDF-1.7\nconteudo');

  await assert.rejects(
    () => att.uploadAttachment(context, pdf, {
      entityType: 'transaction',
      entityId: randomUUID(),
      fileName: 'fatura.pdf.exe',
      declaredMimeType: 'application/pdf',
    }),
    /extensão/i,
  );
});
