import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { randomUUID } from 'node:crypto';
import { createDatabase, runMigrations } from '../../src/db/index.js';
import { SpaceIsolationService } from '../../src/services/spaceIsolationService.js';
import { AttachmentService } from '../../src/services/attachmentService.js';
import { LgpdService } from '../../src/services/lgpdService.js';
import { BackupRestoreService } from '../../src/ops/backupRestoreService.js';
import { McpGateway } from '../../src/gateway/mcpGateway.js';
import { executeMcpHttpRequest } from '../../src/gateway/mcpHttpTransport.js';
import { OperationalMetrics } from '../../src/observability/operationalMetrics.js';
import { Roles } from '../../src/domain/authorization.js';

function setupEnvironment() {
  const db = createDatabase(':memory:');
  runMigrations(db);
  const service = new SpaceIsolationService(db);
  const metrics = new OperationalMetrics();
  const attachmentService = new AttachmentService(db, service, { metrics });
  const lgpdService = new LgpdService(db, service, attachmentService);
  const gateway = new McpGateway({ service, attachmentService, lgpdService, metrics });

  const owner = service.createUser({ name: 'Owner User', email: `owner-${randomUUID()}@flow.local` });
  const space = service.createSpace({ name: 'Espaço Principal', ownerUserId: owner.id });
  const ownerContext = service.resolveAuthContext({ userId: owner.id, spaceId: space.id });
  const editor = service.createUser({ name: 'Editor User', email: `editor-${randomUUID()}@flow.local` });
  service.addMember(ownerContext, { targetUserId: editor.id, role: Roles.EDITOR });
  const editorContext = service.resolveAuthContext({ userId: editor.id, spaceId: space.id });

  return { db, service, metrics, attachmentService, lgpdService, gateway, owner, space, editor, ownerContext, editorContext };
}

test('LGPD: exportSpaceData exporta estrutura completa e audita lgpd.export', async () => {
  const { service, lgpdService, ownerContext, editorContext, space } = setupEnvironment();

  // Cria contas e transação de teste
  const account = service.createAccount(ownerContext, { name: 'Banco Inter', accountType: 'checking', openingBalance: 50000 });
  const category = service.createCategory(ownerContext, { name: 'Salário', kind: 'income' });
  service.createTransaction(ownerContext, {
    accountId: account.id,
    categoryId: category.id,
    type: 'income',
    amount: 50000,
    transactionDate: '2026-09-27',
    description: 'Salário Mensal',
  });

  // Editor não pode exportar (requer SPACE_UPDATE / admin / owner)
  await assert.rejects(
    async () => lgpdService.exportSpaceData(editorContext),
    (err) => err.status === 403,
  );

  // Owner exporta com sucesso
  const exportData = await lgpdService.exportSpaceData(ownerContext);
  assert.equal(exportData.spaceId, space.id);
  assert.equal(exportData.accounts.length, 1);
  assert.equal(exportData.categories.length, 1);
  assert.equal(exportData.transactions.length, 1);
  assert.equal(exportData.transactions[0].description, 'Salário Mensal');

  // Verifica auditoria
  const auditLogs = service.getAuditLogs(ownerContext);
  const exportLog = auditLogs.find((l) => l.action === 'lgpd.export');
  assert.ok(exportLog, 'Evento de auditoria lgpd.export deve existir');
});

test('LGPD: deleteOrAnonymizeSpaceData exige confirmação explícita e papel owner', async () => {
  const { service, lgpdService, ownerContext, editorContext, space } = setupEnvironment();

  const account = service.createAccount(ownerContext, { name: 'Nubank', accountType: 'checking', openingBalance: 1000 });
  const category = service.createCategory(ownerContext, { name: 'Alimentação', kind: 'expense' });
  service.createTransaction(ownerContext, {
    accountId: account.id,
    categoryId: category.id,
    type: 'expense',
    amount: 1000,
    transactionDate: '2026-09-27',
    description: 'Almoço Pessoal',
  });

  // Editor é rejeitado (somente owner pode excluir/anonimizar o espaço)
  await assert.rejects(
    async () => lgpdService.deleteOrAnonymizeSpaceData(editorContext, { confirmation: 'CONFIRMO_EXCLUSAO_DEFINITIVA', mode: 'anonymize' }),
    (err) => err.status === 403,
  );

  // Sem texto exato de confirmação falha com 400
  await assert.rejects(
    async () => lgpdService.deleteOrAnonymizeSpaceData(ownerContext, { confirmation: 'errado', mode: 'anonymize' }),
    (err) => err.status === 400,
  );

  // Anonimização com sucesso
  const result = await lgpdService.deleteOrAnonymizeSpaceData(ownerContext, { confirmation: 'CONFIRMO_EXCLUSAO_DEFINITIVA', mode: 'anonymize' });
  assert.equal(result.status, 'anonymized');

  // Dados sensíveis foram anonimizados no banco
  const trans = service.db.prepare('SELECT description FROM transactions WHERE space_id = ?').get(space.id);
  assert.equal(trans.description, 'DADO_PESSOAL_ANONIMIZADO_LGPD');

  // Auditoria registrada
  const audit = service.getAuditLogs(ownerContext);
  assert.ok(audit.some((l) => l.action === 'lgpd.anonymize'));
});

test('LGPD: rotas HTTP no mcpHttpTransport isolam espaço e validam autorização', async () => {
  const { gateway, ownerContext, space } = setupEnvironment();

  // Exportação via HTTP
  const exportRes = await executeMcpHttpRequest(gateway, {
    method: 'GET',
    path: `/api/v1/spaces/${space.id}/lgpd/export`,
    authContext: ownerContext,
  });
  assert.equal(exportRes.status, 200);
  assert.equal(exportRes.body.ok, true);
  assert.equal(exportRes.body.data.spaceId, space.id);

  // Tentativa cross-space via HTTP
  const crossSpaceRes = await executeMcpHttpRequest(gateway, {
    method: 'GET',
    path: '/api/v1/spaces/outro-space-id/lgpd/export',
    authContext: ownerContext,
  });
  assert.equal(crossSpaceRes.status, 403);
});

test('Backup & Restore: cria backup criptografado AES-256-GCM e restaura em ambiente isolado', async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'moneyflow-backup-test-'));
  const srcDbPath = path.join(tmpDir, 'source.db');
  const srcAttachmentsDir = path.join(tmpDir, 'attachments');
  const backupFile = path.join(tmpDir, 'moneyflow.backup.enc');
  const targetDbPath = path.join(tmpDir, 'restored', 'restored.db');
  const targetAttachmentsDir = path.join(tmpDir, 'restored', 'attachments');

  try {
    await fs.mkdir(srcAttachmentsDir, { recursive: true });
    await fs.writeFile(path.join(srcAttachmentsDir, 'comprovante.pdf'), '%PDF-1.4 mock content');

    // Cria banco com dados
    const db = createDatabase(srcDbPath);
    runMigrations(db);
    const service = new SpaceIsolationService(db);
    const user = service.createUser({ name: 'Backup Test User', email: 'backup@flow.local' });
    const space = service.createSpace({ name: 'Backup Space', ownerUserId: user.id });
    const auth = service.resolveAuthContext({ userId: user.id, spaceId: space.id });
    service.createAccount(auth, { name: 'Conta Backup', accountType: 'checking', openingBalance: 99900 });
    db.close();

    const secretKey = 'segredo-muito-seguro-para-backup-moneyflow';

    // Cria backup criptografado
    const backupResult = await BackupRestoreService.createEncryptedBackup({
      dbPath: srcDbPath,
      attachmentsDir: srcAttachmentsDir,
      backupPath: backupFile,
      secretKey,
    });
    assert.ok(backupResult.checksumSha256);
    assert.equal(backupResult.filesCount, 2);

    // Valida que o arquivo no disco tem cabeçalho mágico MFBK
    const fileBytes = await fs.readFile(backupFile);
    assert.equal(fileBytes.subarray(0, 4).toString('ascii'), 'MFBK');

    // Restaura o backup em diretório de teste isolado
    const restoreResult = await BackupRestoreService.restoreEncryptedBackup({
      backupPath: backupFile,
      targetDbPath,
      targetAttachmentsDir,
      secretKey,
    });
    assert.equal(restoreResult.restored, true);
    assert.equal(restoreResult.filesRestored, 1);

    // Valida integridade e dados do banco restaurado
    const restoredDb = createDatabase(targetDbPath);
    const restoredService = new SpaceIsolationService(restoredDb);
    const restoredSpace = restoredService.getSpace(space.id);
    assert.ok(restoredSpace);
    const restoredAccounts = restoredService.listAccounts(auth);
    restoredDb.close();
    assert.equal(restoredAccounts.length, 1);
    assert.equal(restoredAccounts[0].current_balance, 99900);

    // Valida que o anexo foi restaurado
    const restoredAttContent = await fs.readFile(path.join(targetAttachmentsDir, 'comprovante.pdf'), 'utf8');
    assert.equal(restoredAttContent, '%PDF-1.4 mock content');
  } finally {
    try {
      await fs.rm(tmpDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    } catch {}
  }
});

test('Métricas e Alertas: cobrem migrations, filas e latência', () => {
  const alertsReceived = [];
  const metrics = new OperationalMetrics({
    alertThresholds: { migrationFailure: 1, queueFailure: 1, highLatency: 2 },
    onAlert: (alert) => alertsReceived.push(alert),
  });

  metrics.recordMigrationFailure();
  assert.equal(alertsReceived.some((a) => a.type === 'migration_failure'), true);

  metrics.recordQueueFailure();
  assert.equal(alertsReceived.some((a) => a.type === 'queue_failure'), true);

  metrics.recordApiRequest({ status: 200, latencyMs: 2500 });
  metrics.recordApiRequest({ status: 200, latencyMs: 2200 });
  assert.equal(alertsReceived.some((a) => a.type === 'high_latency'), true);

  const snap = metrics.snapshot();
  assert.equal(snap.operations.migrationFailures, 1);
  assert.equal(snap.operations.queueFailures, 1);
  assert.equal(snap.operations.highLatencies, 2);
});
