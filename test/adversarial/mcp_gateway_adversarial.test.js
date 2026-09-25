import test from 'node:test';
import assert from 'node:assert/strict';

import { createDatabase, runMigrations } from '../../src/db/index.js';
import { SpaceIsolationService } from '../../src/services/spaceIsolationService.js';
import { McpGateway, BATCH_LIMITS } from '../../src/gateway/mcpGateway.js';
import { AppError, ErrorCodes } from '../../src/domain/envelope.js';
import { Roles } from '../../src/domain/authorization.js';

function setupEnvironment() {
  const db = createDatabase(':memory:');
  runMigrations(db);
  const service = new SpaceIsolationService(db);
  const gateway = new McpGateway({ service });

  const ownerA = service.createUser({ email: 'ownerA@flow.com', name: 'Owner A' });
  const spaceA = service.createSpace({ ownerUserId: ownerA.id, name: 'Espaço A' });
  const authContextA = { spaceId: spaceA.id, userId: ownerA.id, role: Roles.OWNER };

  const ownerB = service.createUser({ email: 'ownerB@flow.com', name: 'Owner B' });
  const spaceB = service.createSpace({ ownerUserId: ownerB.id, name: 'Espaço B' });
  const authContextB = { spaceId: spaceB.id, userId: ownerB.id, role: Roles.OWNER };

  return { service, gateway, authContextA, authContextB, spaceA, spaceB };
}

test('McpGateway Adversarial: rejeita ferramenta desconhecida com NOT_FOUND', async () => {
  const { gateway, authContextA } = setupEnvironment();

  await assert.rejects(
    async () => {
      await gateway.executeTool('ferramenta_inexistente_hacker', {}, authContextA);
    },
    (err) => {
      assert.ok(err instanceof AppError);
      assert.equal(err.code, ErrorCodes.NOT_FOUND);
      assert.equal(err.status, 404);
      return true;
    },
  );
});

test('McpGateway Adversarial: validação estrita de schema (parâmetro obrigatório ausente e tipos inválidos)', async () => {
  const { gateway, authContextA } = setupEnvironment();

  // create_account exige 'name'
  await assert.rejects(
    async () => {
      await gateway.executeTool('create_account', {}, authContextA);
    },
    (err) => {
      assert.ok(err instanceof AppError);
      assert.equal(err.code, ErrorCodes.VALIDATION_ERROR);
      assert.ok(err.message.includes('name'));
      return true;
    },
  );

  // create_category exige 'name'
  await assert.rejects(
    async () => {
      await gateway.executeTool('create_category', { is_income: true }, authContextA);
    },
    (err) => {
      assert.ok(err instanceof AppError);
      assert.equal(err.code, ErrorCodes.VALIDATION_ERROR);
      return true;
    },
  );
});

test('McpGateway Adversarial: Open Finance com credenciais ou banco NUNCA conecta e retorna OPEN_FINANCE_DISABLED', async () => {
  const { gateway, authContextA } = setupEnvironment();

  const attackArgs = {
    bank: 'banco-vulneravel',
    client_id: 'secret_123',
    client_secret: 'super_secret',
    token: 'jwt_compromised',
  };

  const res1 = await gateway.executeTool('get_open_finance_status', attackArgs, authContextA);
  assert.equal(res1.status, 'OPEN_FINANCE_DISABLED');
  assert.equal(res1.isMockFixture, true);

  const res2 = await gateway.executeTool('get_bank_connections', attackArgs, authContextA);
  assert.equal(res2.status, 'OPEN_FINANCE_DISABLED');

  const res3 = await gateway.executeTool('get_latest_imports', attackArgs, authContextA);
  assert.equal(res3.status, 'OPEN_FINANCE_DISABLED');
});

test('McpGateway Adversarial: limites de lote (100, 200, 500) estritamente aplicados', async () => {
  const { gateway, authContextA } = setupEnvironment();

  // 1. mass_create_transactions: teto 100
  const over100Transactions = Array.from({ length: 101 }, (_, i) => ({
    description: `Tx ${i}`,
    amount: 10,
    date: '2026-09-25',
    is_income: false,
  }));

  await assert.rejects(
    async () => {
      await gateway.executeTool('mass_create_transactions', { transactions: over100Transactions }, authContextA);
    },
    (err) => {
      assert.ok(err instanceof AppError);
      assert.equal(err.code, ErrorCodes.VALIDATION_ERROR);
      assert.ok(err.message.includes('100'));
      return true;
    },
  );

  // 2. mass_delete_transactions: teto 500
  const over500Ids = Array.from({ length: 501 }, (_, i) => `id-${i}`);
  await assert.rejects(
    async () => {
      await gateway.executeTool('mass_delete_transactions', { ids: over500Ids }, authContextA);
    },
    (err) => {
      assert.ok(err instanceof AppError);
      assert.equal(err.code, ErrorCodes.VALIDATION_ERROR);
      assert.ok(err.message.includes('500'));
      return true;
    },
  );

  // 3. mass_update_transactions: filtros e updates obrigatórios
  await assert.rejects(
    async () => {
      await gateway.executeTool('mass_update_transactions', { filters: {}, updates: { description: 'test' } }, authContextA);
    },
    (err) => {
      assert.ok(err instanceof AppError);
      assert.equal(err.code, ErrorCodes.VALIDATION_ERROR);
      return true;
    },
  );

  await assert.rejects(
    async () => {
      await gateway.executeTool('mass_update_transactions', { filters: { account_id: 'acc1' }, updates: {} }, authContextA);
    },
    (err) => {
      assert.ok(err instanceof AppError);
      assert.equal(err.code, ErrorCodes.VALIDATION_ERROR);
      return true;
    },
  );

  // 4. add_transactions_tags: teto 200
  const over200Items = Array.from({ length: 201 }, (_, i) => ({ id: `tx-${i}`, tags: ['tag'] }));
  await assert.rejects(
    async () => {
      await gateway.executeTool('add_transactions_tags', { items: over200Items }, authContextA);
    },
    (err) => {
      assert.ok(err instanceof AppError);
      assert.equal(err.code, ErrorCodes.VALIDATION_ERROR);
      assert.ok(err.message.includes('200'));
      return true;
    },
  );
});

test('McpGateway Adversarial: Anti-IDOR e isolamento entre espaços garantido', async () => {
  const { gateway, authContextA, authContextB } = setupEnvironment();

  // Cria conta e cartão no Espaço B
  const accBRes = await gateway.executeTool('create_account', { name: 'Conta Secreta B' }, authContextB);
  const accBId = accBRes.data.id;

  const cardBRes = await gateway.executeTool(
    'create_credit_card',
    { name: 'Cartão B', closing_day: 10, due_day: 20 },
    authContextB,
  );
  const cardBId = cardBRes.data.id;

  // Tentativa de usuário no Espaço A acessar/ler recursos do Espaço B
  await assert.rejects(
    async () => {
      await gateway.executeTool('get_credit_card_invoices', { credit_card_id: cardBId }, authContextA);
    },
    (err) => {
      assert.ok(err instanceof AppError);
      assert.equal(err.code, ErrorCodes.NOT_FOUND);
      return true;
    },
  );

  // Tentativa de criar transação no Espaço A referenciando conta do Espaço B
  await assert.rejects(
    async () => {
      await gateway.executeTool(
        'create_transaction',
        {
          description: 'Ataque Cross-Space',
          amount: 50.0,
          date: '2026-09-25',
          is_income: false,
          account_name: accBId,
        },
        authContextA,
      );
    },
    (err) => {
      assert.ok(err instanceof AppError);
      assert.equal(err.code, ErrorCodes.CROSS_SPACE_REFERENCE_DENIED);
      return true;
    },
  );
});

test('McpGateway Adversarial: Paginação e limites de listagem respeitados', async () => {
  const { gateway, authContextA } = setupEnvironment();

  // Cria 5 transações
  for (let i = 1; i <= 5; i++) {
    await gateway.executeTool(
      'create_transaction',
      {
        description: `Tx ${i}`,
        amount: i * 10,
        date: '2026-09-25',
        is_income: true,
      },
      authContextA,
    );
  }

  // Lista com per_page = 2
  const listRes = await gateway.executeTool(
    'list_transactions',
    {
      page: 1,
      per_page: 2,
    },
    authContextA,
  );

  assert.equal(listRes.status, 'ok');
  assert.equal(listRes.data.items.length, 2);
  assert.equal(listRes.data.pagination.page, 1);
  assert.equal(listRes.data.pagination.perPage, 2);
  assert.equal(listRes.data.pagination.totalCount, 5);
  assert.equal(listRes.data.pagination.totalPages, 3);
});

test('McpGateway Adversarial: clone_budgets não sobrescreve mês que já tem orçamentos', async () => {
  const { gateway, authContextA } = setupEnvironment();

  // Cria categoria
  const catRes = await gateway.executeTool('create_category', { name: 'Alimentação' }, authContextA);
  const catId = catRes.data.id;

  // Cria orçamento no mês atual
  await gateway.executeTool('create_budget', { category_name: 'Alimentação', amount: 500 }, authContextA);

  // Tentativa de clonar para o mesmo mês que já possui orçamentos
  await assert.rejects(
    async () => {
      await gateway.executeTool('clone_budgets', {}, authContextA);
    },
    (err) => {
      assert.ok(err instanceof AppError);
      assert.equal(err.code, ErrorCodes.VALIDATION_ERROR);
      assert.ok(err.message.includes('já possui'));
      return true;
    },
  );
});
