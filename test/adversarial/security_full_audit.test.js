import test from 'node:test';
import assert from 'node:assert/strict';
import { createDatabase, runMigrations } from '../../src/db/index.js';
import { SpaceIsolationService } from '../../src/services/spaceIsolationService.js';
import { SettingsService, maskSecret } from '../../src/services/settingsService.js';
import { GeminiAudioService } from '../../src/services/geminiAudioService.js';
import { McpGateway, OPEN_FINANCE_DISABLED_TOOLS } from '../../src/gateway/mcpGateway.js';
import { redact } from '../../src/utils/logger.js';
import { Roles } from '../../src/domain/authorization.js';
import { AppError } from '../../src/domain/envelope.js';

function setupAuditEnvironment() {
  const db = createDatabase(':memory:');
  runMigrations(db);

  const service = new SpaceIsolationService(db);
  const userA = service.createUser({ name: 'Alice Space Owner', email: 'alice@audit.local' });
  const userB = service.createUser({ name: 'Bob Space Owner', email: 'bob@audit.local' });

  const spaceA = service.createSpace({ name: 'Espaço Alice', ownerUserId: userA.id });
  const spaceB = service.createSpace({ name: 'Espaço Bob', ownerUserId: userB.id });

  const settingsService = new SettingsService(db, { appSecret: 'super-audit-secret-key-32-chars!' });
  const geminiAudioService = new GeminiAudioService(db, settingsService, { storageDir: '.data/audit-audio' });

  const gateway = new McpGateway({
    service,
    settingsService,
    geminiAudioService,
  });

  const authAlice = {
    userId: userA.id,
    spaceId: spaceA.id,
    role: Roles.OWNER,
    membership: { status: 'active', role: Roles.OWNER },
  };

  const authBob = {
    userId: userB.id,
    spaceId: spaceB.id,
    role: Roles.OWNER,
    membership: { status: 'active', role: Roles.OWNER },
  };

  return { db, service, spaceA, spaceB, authAlice, authBob, settingsService, geminiAudioService, gateway };
}

// ============================================================================
// 1. Auditoria de Segredos e Redação em Logs
// ============================================================================

test('Segurança: Redação de Chaves Gemini, Tokens e Payloads Base64 em Logs', () => {
  // 1. Chave Google AI Studio Gemini
  const geminiLog = redact('Chamando https://generativelanguage.googleapis.com/v1beta/models?key=AIzaSyA1B2C3D4E5F6G7H8I9J0K1L2M3N4O5P6Q');
  assert.equal(geminiLog.includes('AIzaSyA1B2C3D4E5F6G7H8I9J0K1L2M3N4O5P6Q'), false);
  assert.ok(geminiLog.includes('[REDACTED]'));

  // 2. Chave OpenAI / Anthropic
  const skLog = redact('Erro com chave sk-1234567890abcdef1234567890abcdef');
  assert.equal(skLog.includes('sk-1234567890abcdef1234567890abcdef'), false);
  assert.ok(skLog.includes('[REDACTED]'));

  // 3. Bearer Token
  const tokenLog = redact('Authorization: Bearer secret-token-xyz-123');
  assert.equal(tokenLog.includes('secret-token-xyz-123'), false);
  assert.ok(tokenLog.includes('Bearer [REDACTED]'));

  // 4. Cartão de Crédito
  const cardLog = redact('Cartão recebido: 4532 1122 3344 5566 para validação');
  assert.equal(cardLog.includes('4532 1122 3344 5566'), false);
  assert.ok(cardLog.includes('[REDACTED]'));

  // 5. Objeto com chaves sensíveis e Base64
  const payloadObj = {
    gemini_api_key: 'AIzaSySecretRealKey999',
    evolution_api_key: 'secret-evo-token',
    audio_base64: 'UklGRi4AAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQAAAAA=',
    safe_data: 'Relatório Semanal de Despesas',
  };
  const redactedObj = redact(payloadObj);
  assert.equal(redactedObj.gemini_api_key, '[REDACTED]');
  assert.equal(redactedObj.evolution_api_key, '[REDACTED]');
  assert.equal(redactedObj.audio_base64, '[REDACTED]');
  assert.equal(redactedObj.safe_data, 'Relatório Semanal de Despesas');
});

// ============================================================================
// 2. Auditoria Anti-IDOR e Isolamento Estrito entre Espaços
// ============================================================================

test('Segurança: Anti-IDOR — Usuário do Espaço B não pode ler, alterar nem referenciar dados do Espaço A', async () => {
  const { gateway, authAlice, authBob } = setupAuditEnvironment();

  // 1. Alice cria conta no Espaço A
  const accAliceRes = await gateway.executeTool('create_account', {
    name: 'Conta Secreta da Alice',
    account_type: 'checking',
    opening_balance: 50000,
  }, authAlice);
  const accountAliceId = accAliceRes.data.id;

  // 2. Alice cria categoria no Espaço A
  const catAliceRes = await gateway.executeTool('create_category', {
    name: 'Investimentos Pessoais',
    color: '#138A63',
    is_income: false,
  }, authAlice);
  const catAliceId = catAliceRes.data.id;

  // 3. Bob tenta listar contas — conta da Alice NÃO deve aparecer
  const bobAccounts = await gateway.executeTool('list_accounts', {}, authBob);
  assert.equal(bobAccounts.data.some((a) => a.id === accountAliceId), false);

  // 4. Bob tenta atualizar a conta da Alice (IDOR direto)
  await assert.rejects(
    async () => {
      await gateway.executeTool('update_account', { id: accountAliceId, name: 'Conta Invadida' }, authBob);
    },
    (err) => err.code === 'NOT_FOUND' || err.status === 404,
  );

  // 5. Bob tenta excluir a conta da Alice (IDOR direto)
  await assert.rejects(
    async () => {
      await gateway.executeTool('delete_account', { id: accountAliceId }, authBob);
    },
    (err) => err.code === 'NOT_FOUND' || err.status === 404,
  );

  // 6. Bob tenta criar transação no seu espaço usando a conta da Alice (Cross-Space Reference Injection)
  await assert.rejects(
    async () => {
      await gateway.executeTool('create_transaction', {
        account_id: accountAliceId, // Conta de outro espaço!
        category_id: catAliceId,
        description: 'Tentativa de Fraude',
        amount: 1000,
        date: '2026-09-28',
        is_income: false,
      }, authBob);
    },
    (err) => err.code === 'CROSS_SPACE_REFERENCE_DENIED' || err.code === 'NOT_FOUND' || err.status === 403 || err.status === 404,
  );
});

// ============================================================================
// 3. Auditoria contra Path Traversal
// ============================================================================

test('Segurança: Proteção contra Path Traversal no Serviço de Áudio e Storage', async () => {
  const { geminiAudioService } = setupAuditEnvironment();

  // 1. Tentativa com '../'
  await assert.rejects(
    async () => {
      await geminiAudioService.getAudioFile('../../../etc/passwd');
    },
    (err) => err instanceof AppError,
  );

  // 2. Tentativa com caracteres maliciosos de injeção de caminho
  await assert.rejects(
    async () => {
      await geminiAudioService.getAudioFile('..\\..\\windows\\win.ini');
    },
    (err) => err instanceof AppError,
  );

  // 3. ID nulo ou vazio
  await assert.rejects(
    async () => {
      await geminiAudioService.getAudioFile('');
    },
    (err) => err.code === 'NOT_FOUND' || err.code === 'VALIDATION_ERROR',
  );
});

// ============================================================================
// 4. Auditoria contra SQL Injection
// ============================================================================

test('Segurança: Imunidade a SQL Injection em buscas e parâmetros dinâmicos', async () => {
  const { gateway, authAlice } = setupAuditEnvironment();

  // 1. Injeção clássica em busca de transações
  const searchResult = await gateway.executeTool('search_transactions', {
    query: "' OR 1=1 --",
  }, authAlice);
  assert.equal(searchResult.status, 'ok');
  assert.equal(Array.isArray(searchResult.data.items), true);

  // 2. Injeção com UNION SELECT em listagem
  const txList = await gateway.executeTool('list_transactions', {
    start_date: "2026-09-01' UNION SELECT * FROM users --",
  }, authAlice);
  // O sistema rejeita formato de data inválido ou parametriza sem injetar
  assert.ok(txList.status === 'ok' || txList.status === 400);

  // 3. Injeção em nome de conta
  const newAcc = await gateway.executeTool('create_account', {
    name: "Conta'; DROP TABLE users; --",
    account_type: 'checking',
    opening_balance: 100,
  }, authAlice);
  assert.equal(newAcc.status, 'ok');
  assert.equal(newAcc.data.name, "Conta'; DROP TABLE users; --"); // Salvo como dado literal seguro
});

// ============================================================================
// 5. Invariante Open Finance
// ============================================================================

test('Segurança: Ferramentas de Open Finance permanecem 100% desabilitadas', async () => {
  const { gateway, authAlice } = setupAuditEnvironment();

  for (const tool of OPEN_FINANCE_DISABLED_TOOLS) {
    const res = await gateway.executeTool(tool, { credentials: 'hack' }, authAlice);
    assert.equal(res.status, 'OPEN_FINANCE_DISABLED');
  }
});
