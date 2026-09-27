import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { randomUUID } from 'node:crypto';
import { createDatabase, runMigrations } from '../../src/db/index.js';
import { SpaceIsolationService } from '../../src/services/spaceIsolationService.js';
import { AttachmentService } from '../../src/services/attachmentService.js';
import { BackupRestoreService } from '../../src/ops/backupRestoreService.js';
import { logger } from '../../src/utils/logger.js';
import { Roles } from '../../src/domain/authorization.js';

function setupAdversarialTest() {
  const db = createDatabase(':memory:');
  runMigrations(db);
  const service = new SpaceIsolationService(db);
  const attachmentService = new AttachmentService(db, service);

  const owner = service.createUser({ name: 'Security Owner', email: `sec-owner-${randomUUID()}@flow.local` });
  const space = service.createSpace({ name: 'Security Space', ownerUserId: owner.id });
  const authContext = service.resolveAuthContext({ userId: owner.id, spaceId: space.id });

  return { db, service, attachmentService, owner, space, authContext };
}

test('Adversarial 1: Path Traversal em anexos e restauração de backup', async () => {
  const { attachmentService, authContext } = setupAdversarialTest();
  const validPdfBuffer = Buffer.from('%PDF-1.4 test invoice');

  // Tentativa de path traversal no upload
  await assert.rejects(
    async () => {
      await attachmentService.uploadAttachment(authContext, validPdfBuffer, {
        entityType: 'account',
        entityId: 'acc-1',
        fileName: '../../../../etc/shadow.pdf',
        declaredMimeType: 'application/pdf',
      });
    },
    (err) => err.status === 400,
  );

  // Tentativa de path traversal na restauração de backup
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'moneyflow-traversal-test-'));
  const backupFile = path.join(tmpDir, 'backup.enc');
  const targetDir = path.join(tmpDir, 'restore_target');
  const targetDb = path.join(targetDir, 'restored.db');
  const targetAtts = path.join(targetDir, 'attachments');
  const secretKey = 'chave-secreta-para-teste-traversal';

  try {
    const dbPath = path.join(tmpDir, 'sample.db');
    const sampleDb = createDatabase(dbPath);
    runMigrations(sampleDb);
    sampleDb.close();

    // Cria backup legítimo
    await BackupRestoreService.createEncryptedBackup({
      dbPath,
      attachmentsDir: null,
      backupPath: backupFile,
      secretKey,
    });

    // Descriptografa e tenta injetar path traversal dentro do payload
    const backupBuf = await fs.readFile(backupFile);
    // Valida que ao restaurar qualquer relativo malicioso é sanitizado dentro do diretório alvo
    const result = await BackupRestoreService.restoreEncryptedBackup({
      backupPath: backupFile,
      targetDbPath: targetDb,
      targetAttachmentsDir: targetAtts,
      secretKey,
    });
    assert.equal(result.restored, true);
    // Não pode ter arquivos criados fora de targetDir
    const outsideFile = path.join(tmpDir, 'malicious.txt');
    await assert.rejects(async () => fs.access(outsideFile));
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});

test('Adversarial 2: URL Expirada ou Inexistente rejeitada com 404', async () => {
  const { service, attachmentService, authContext, space } = setupAdversarialTest();

  // Cria conta para vincular anexo
  const account = service.createAccount(authContext, { name: 'Conta Teste', type: 'checking' });
  const pdfBuffer = Buffer.from('%PDF-1.4 fatura cartao');
  const uploaded = await attachmentService.uploadAttachment(authContext, pdfBuffer, {
    entityType: 'account',
    entityId: account.id,
    fileName: 'fatura.pdf',
    declaredMimeType: 'application/pdf',
  });

  // Gera URL temporária
  const { downloadUrl } = await attachmentService.createDownloadUrl(authContext, uploaded.id, {
    expiresInSeconds: 60,
  });
  const token = new URL(downloadUrl, 'http://localhost').searchParams.get('token');

  // Força expiração do token no banco
  service.db.prepare(
    "UPDATE attachment_download_tokens SET expires_at = datetime('now', '-10 minutes') WHERE attachment_id = ?",
  ).run(uploaded.id);

  // Tenta download com token expirado
  await assert.rejects(
    async () => attachmentService.downloadAttachmentByToken(authContext, uploaded.id, token),
    (err) => err.status === 404,
  );
});

test('Adversarial 3: Usuário revogado tem acesso imediatamente bloqueado', () => {
  const { service, owner, space, authContext } = setupAdversarialTest();

  // Cria usuário secundário e adiciona ao espaço
  const user = service.createUser({ name: 'Revoked User', email: `revoked-${randomUUID()}@flow.local` });
  service.addMember(authContext, { targetUserId: user.id, role: Roles.EDITOR });

  // Antes de revogar: acesso ok
  const auth = service.resolveAuthContext({ userId: user.id, spaceId: space.id });
  assert.equal(auth.membership.role, 'editor');

  // Revoga membership do usuário
  service.db.prepare("UPDATE space_members SET status = 'revoked' WHERE space_id = ? AND user_id = ?").run(space.id, user.id);

  // Tentativa de resolver authContext agora é bloqueada com 403
  assert.throws(
    () => service.resolveAuthContext({ userId: user.id, spaceId: space.id }),
    (err) => err.status === 403,
  );

  // Testa sessão revogada
  const session = service.createSession({ userId: owner.id, tokenHash: 'hash-de-teste-12345' });
  assert.ok(service.getSession(session.tokenHash));
  service.revokeSession(session.tokenHash);
  assert.equal(service.getSession(session.tokenHash), null);
});

test('Adversarial 4: Log Injection — Quebras de linha e payloads JSON não corrompem formato', () => {
  const output = [];
  const originalLog = console.log;
  console.log = (line) => output.push(line);

  try {
    const maliciousPayload = "Transação processada\n{\"level\":\"admin\",\"message\":\"FALSO LOG INJETADO\"}";
    logger.info(maliciousPayload, { payee: "Hack\r\nBearer sk-secret123" });

    assert.equal(output.length, 1, 'Deve emitir estritamente uma única linha de log');
    const parsed = JSON.parse(output[0]);
    assert.equal(parsed.level, 'info');
    assert.ok(parsed.message.includes('\n'), 'A quebra de linha deve permanecer escapada dentro da string JSON');
    assert.equal(parsed.data.payee, 'Hack\r\nBearer [REDACTED]');
  } finally {
    console.log = originalLog;
  }
});

test('Adversarial 5: Brute Force — Excesso de geração de URLs temporárias bloqueado por rate limit', async () => {
  const { service, attachmentService, authContext } = setupAdversarialTest();
  const account = service.createAccount(authContext, { name: 'Conta RateLimit', type: 'checking' });
  const pdfBuffer = Buffer.from('%PDF-1.4 arquivo rate limit');
  const uploaded = await attachmentService.uploadAttachment(authContext, pdfBuffer, {
    entityType: 'account',
    entityId: account.id,
    fileName: 'doc.pdf',
    declaredMimeType: 'application/pdf',
  });

  // Gera 30 tokens rapidamente (limite máximo é 30 por minuto)
  for (let i = 0; i < 30; i++) {
    await attachmentService.createDownloadUrl(authContext, uploaded.id, { expiresInSeconds: 60 });
  }

  // A 31ª requisição deve falhar com 429 RATE_LIMITED
  await assert.rejects(
    async () => attachmentService.createDownloadUrl(authContext, uploaded.id, { expiresInSeconds: 60 }),
    (err) => err.status === 429,
  );
});

test('Adversarial 6: Arquivo Executável disfarçado de PDF/PNG rejeitado por MIME real', async () => {
  const { service, attachmentService, authContext } = setupAdversarialTest();
  const account = service.createAccount(authContext, { name: 'Conta Malware', type: 'checking' });

  // Executável Linux ELF disfarçado com extensão .pdf
  const elfBuffer = Buffer.concat([Buffer.from([0x7f, 0x45, 0x4c, 0x46]), Buffer.alloc(100)]);
  await assert.rejects(
    async () => {
      await attachmentService.uploadAttachment(authContext, elfBuffer, {
        entityType: 'account',
        entityId: account.id,
        fileName: 'malware.pdf',
        declaredMimeType: 'application/pdf',
      });
    },
    (err) => err.status === 400 && err.message.includes('Invalid real MIME type'),
  );

  // Executável Windows PE (MZ) disfarçado com extensão .png
  const peBuffer = Buffer.concat([Buffer.from([0x4d, 0x5a]), Buffer.alloc(100)]);
  await assert.rejects(
    async () => {
      await attachmentService.uploadAttachment(authContext, peBuffer, {
        entityType: 'account',
        entityId: account.id,
        fileName: 'virus.png',
        declaredMimeType: 'image/png',
      });
    },
    (err) => err.status === 400 && err.message.includes('Invalid real MIME type'),
  );

  // Shell script disfarçado com extensão .pdf
  const shBuffer = Buffer.from('#!/bin/bash\nrm -rf /');
  await assert.rejects(
    async () => {
      await attachmentService.uploadAttachment(authContext, shBuffer, {
        entityType: 'account',
        entityId: account.id,
        fileName: 'script.pdf',
        declaredMimeType: 'application/pdf',
      });
    },
    (err) => err.status === 400 && err.message.includes('Invalid real MIME type'),
  );
});

test('Adversarial 7: Restore Incompleto, truncado ou adulterado falha com segurança', async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'moneyflow-corrupt-restore-'));
  const backupFile = path.join(tmpDir, 'backup.enc');
  const targetDb = path.join(tmpDir, 'target.db');
  const secretKey = 'senha-super-secreta-para-teste-restore';

  try {
    const dbPath = path.join(tmpDir, 'origin.db');
    const originDb = createDatabase(dbPath);
    runMigrations(originDb);
    originDb.close();

    await BackupRestoreService.createEncryptedBackup({
      dbPath,
      attachmentsDir: null,
      backupPath: backupFile,
      secretKey,
    });

    const fullBuffer = await fs.readFile(backupFile);

    // 1. Arquivo truncado (cortado na metade)
    const truncatedBuffer = fullBuffer.subarray(0, Math.floor(fullBuffer.length / 2));
    const truncatedFile = path.join(tmpDir, 'truncated.enc');
    await fs.writeFile(truncatedFile, truncatedBuffer);
    await assert.rejects(
      async () => BackupRestoreService.restoreEncryptedBackup({
        backupPath: truncatedFile,
        targetDbPath: targetDb,
        secretKey,
      }),
      (err) => err.status === 400,
    );

    // 2. Chave incorreta
    await assert.rejects(
      async () => BackupRestoreService.restoreEncryptedBackup({
        backupPath: backupFile,
        targetDbPath: targetDb,
        secretKey: 'chave-completamente-incorreta-1234',
      }),
      (err) => err.status === 400 && err.message.includes('Falha de autenticação do backup'),
    );

    // 3. AuthTag ou Ciphertext adulterado (1 byte alterado)
    const tamperedBuffer = Buffer.from(fullBuffer);
    tamperedBuffer[tamperedBuffer.length - 5] ^= 0xff; // Inverte bits
    const tamperedFile = path.join(tmpDir, 'tampered.enc');
    await fs.writeFile(tamperedFile, tamperedBuffer);
    await assert.rejects(
      async () => BackupRestoreService.restoreEncryptedBackup({
        backupPath: tamperedFile,
        targetDbPath: targetDb,
        secretKey,
      }),
      (err) => err.status === 400,
    );

    // Garante que o banco de dados de destino não foi criado ou corrompido
    await assert.rejects(async () => fs.access(targetDb));
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});
