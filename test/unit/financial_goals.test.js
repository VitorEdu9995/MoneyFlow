import test from 'node:test';
import assert from 'node:assert/strict';
import { createDatabase, runMigrations } from '../../src/db/index.js';
import { SpaceIsolationService } from '../../src/services/spaceIsolationService.js';
import { McpGateway } from '../../src/gateway/mcpGateway.js';
import { Roles } from '../../src/domain/authorization.js';
import { ErrorCodes } from '../../src/domain/envelope.js';

function setup() {
  const db = createDatabase(':memory:'); runMigrations(db);
  const service = new SpaceIsolationService(db);
  const owner = service.createUser({ email: 'goals-owner@example.test', name: 'Owner' });
  const viewer = service.createUser({ email: 'goals-viewer@example.test', name: 'Viewer' });
  const space = service.createSpace({ name: 'Metas', ownerUserId: owner.id });
  const ownerCtx = service.resolveAuthContext({ userId: owner.id, spaceId: space.id });
  service.addMember(ownerCtx, { targetUserId: viewer.id, role: Roles.VIEWER });
  const viewerCtx = service.resolveAuthContext({ userId: viewer.id, spaceId: space.id });
  return { service, gateway: new McpGateway({ service }), ownerCtx, viewerCtx };
}

test('metas: cria cofrinho, aporta e o patrimônio ignora sua conta', async () => {
  const { service, gateway, ownerCtx } = setup();
  const origem = service.createAccount(ownerCtx, { name: 'Corrente', openingBalance: 100000 });
  const created = await gateway.executeTool('metas_create', { name: 'Reserva', goal_type: 'savings', target_amount: 2000, start_date: '2026-01-01', deadline: '2026-12-31' }, ownerCtx);
  const goal = created.data;
  assert.equal(goal.piggy_bank.balance, 0);
  await gateway.executeTool('cofrinho_deposit', { goal_id: goal.id, source_account_id: origem.id, amount: 250, date: '2026-02-01' }, ownerCtx);
  const progress = (await gateway.executeTool('get_goal_progress', { id: goal.id }, ownerCtx)).data;
  assert.equal(progress.current_amount, 25000);
  assert.equal(service.getAccount(ownerCtx, origem.id).current_balance, 75000);
  const balances = (await gateway.executeTool('get_balances', {}, ownerCtx)).data;
  assert.equal(balances.simplifiedNetWorth, 75000);
  assert.equal(balances.accounts.some((account) => account.id === progress.piggy_bank.account_id), false);
  assert.equal(service.getAuditLogs(ownerCtx).some((item) => item.action === 'piggy_bank.deposit'), true);
});

test('metas: criação pública de transação não movimenta conta-cofrinho', async () => {
  const { service, gateway, ownerCtx } = setup();
  const origem = service.createAccount(ownerCtx, { name: 'Corrente', openingBalance: 100000 });
  const goal = (await gateway.executeTool('metas_create', {
    name: 'Reserva', goal_type: 'savings', target_amount: 2000,
    start_date: '2026-01-01', deadline: '2026-12-31',
  }, ownerCtx)).data;

  await assert.rejects(
    () => gateway.executeTool('create_transaction', {
      description: 'Tentativa direta', amount: 100, date: '2026-02-01',
      account_name: goal.piggy_bank.account_id, is_income: false, _allowPiggy: true,
    }, ownerCtx),
    { code: ErrorCodes.CROSS_SPACE_REFERENCE_DENIED },
  );

  await gateway.executeTool('cofrinho_deposit', {
    goal_id: goal.id, source_account_id: origem.id, amount: 100, date: '2026-02-01',
  }, ownerCtx);
  assert.equal((await gateway.executeTool('get_goal_progress', { id: goal.id }, ownerCtx)).data.current_amount, 10000);
  await gateway.executeTool('cofrinho_withdraw', {
    goal_id: goal.id, destination_account_id: origem.id, amount: 100, date: '2026-02-02',
  }, ownerCtx);
  assert.equal((await gateway.executeTool('get_goal_progress', { id: goal.id }, ownerCtx)).data.current_amount, 0);
});

test('metas: transação interna do cofrinho não pode ser alterada ou excluída publicamente', async () => {
  const { service, gateway, ownerCtx } = setup();
  const origem = service.createAccount(ownerCtx, { name: 'Corrente', openingBalance: 100000 });
  const goal = (await gateway.executeTool('metas_create', {
    name: 'Reserva', goal_type: 'savings', target_amount: 2000,
    start_date: '2026-01-01', deadline: '2026-12-31',
  }, ownerCtx)).data;

  const deposit = await gateway.executeTool('cofrinho_deposit', {
    goal_id: goal.id, source_account_id: origem.id, amount: 100, date: '2026-02-01',
  }, ownerCtx);
  const sourceTransactionId = deposit.data.transfer.source_transaction_id;
  assert.equal(service.getTransaction(ownerCtx, sourceTransactionId).is_piggy_bank_internal, 1);

  await assert.rejects(
    () => gateway.executeTool('update_transaction', { id: sourceTransactionId, amount: 1 }, ownerCtx),
    { code: ErrorCodes.FORBIDDEN },
  );
  await assert.rejects(
    () => gateway.executeTool('delete_transaction', { id: sourceTransactionId }, ownerCtx),
    { code: ErrorCodes.FORBIDDEN },
  );

  await gateway.executeTool('cofrinho_withdraw', {
    goal_id: goal.id, destination_account_id: origem.id, amount: 100, date: '2026-02-02',
  }, ownerCtx);
  assert.equal(service.getAccount(ownerCtx, origem.id).current_balance, 100000);
  assert.equal((await gateway.executeTool('get_goal_progress', { id: goal.id }, ownerCtx)).data.current_amount, 0);
});

test('metas: transferência interna legada sem marcador também não pode ser excluída', async () => {
  const { service, gateway, ownerCtx } = setup();
  const origem = service.createAccount(ownerCtx, { name: 'Corrente', openingBalance: 100000 });
  const goal = (await gateway.executeTool('metas_create', {
    name: 'Reserva', goal_type: 'savings', target_amount: 2000,
    start_date: '2026-01-01', deadline: '2026-12-31',
  }, ownerCtx)).data;
  const deposit = await gateway.executeTool('cofrinho_deposit', {
    goal_id: goal.id, source_account_id: origem.id, amount: 100, date: '2026-02-01',
  }, ownerCtx);
  const sourceTransactionId = deposit.data.transfer.source_transaction_id;

  service.db.prepare('UPDATE transactions SET is_piggy_bank_internal = 0 WHERE id = ?').run(sourceTransactionId);
  await assert.rejects(
    () => gateway.executeTool('delete_transaction', { id: sourceTransactionId }, ownerCtx),
    { code: ErrorCodes.FORBIDDEN },
  );
  await gateway.executeTool('cofrinho_withdraw', {
    goal_id: goal.id, destination_account_id: origem.id, amount: 100, date: '2026-02-02',
  }, ownerCtx);
  assert.equal(service.getAccount(ownerCtx, origem.id).current_balance, 100000);
});

test('metas: gasto requer categoria e mede despesas no período', async () => {
  const { service, gateway, ownerCtx } = setup();
  const account = service.createAccount(ownerCtx, { name: 'Conta', openingBalance: 0 });
  const category = service.createCategory(ownerCtx, { name: 'Mercado', kind: 'expense' });
  await assert.rejects(() => gateway.executeTool('metas_create', { name: 'Sem categoria', goal_type: 'spending', target_amount: 100, start_date: '2026-01-01', deadline: '2026-01-31' }, ownerCtx), { code: ErrorCodes.VALIDATION_ERROR });
  const goal = (await gateway.executeTool('metas_create', { name: 'Mercado', goal_type: 'spending', target_amount: 1000, category_id: category.id, start_date: '2026-01-01', deadline: '2026-01-31' }, ownerCtx)).data;
  service.createTransaction(ownerCtx, { type: 'expense', description: 'Compra', amount: 12345, accountId: account.id, categoryId: category.id, transactionDate: '2026-01-15' });
  assert.equal((await gateway.executeTool('get_goal_progress', { id: goal.id }, ownerCtx)).data.current_amount, 12345);
});

test('metas: viewer lê, mas não aporta; saque sem saldo usa erro estável', async () => {
  const { service, gateway, ownerCtx, viewerCtx } = setup();
  const conta = service.createAccount(ownerCtx, { name: 'Conta', openingBalance: 0 });
  const goal = (await gateway.executeTool('metas_create', { name: 'Reserva', goal_type: 'savings', target_amount: 100, start_date: '2026-01-01', deadline: '2026-12-31' }, ownerCtx)).data;
  await assert.rejects(() => gateway.executeTool('cofrinho_deposit', { goal_id: goal.id, source_account_id: conta.id, amount: 1, date: '2026-01-01' }, viewerCtx), { code: ErrorCodes.FORBIDDEN });
  await assert.rejects(() => gateway.executeTool('cofrinho_withdraw', { goal_id: goal.id, destination_account_id: conta.id, amount: 1, date: '2026-01-01' }, ownerCtx), { code: ErrorCodes.INSUFFICIENT_FUNDS });
  assert.equal((await gateway.executeTool('list_metas', { limit: 10, offset: 0 }, viewerCtx)).data.length, 1);
  await assert.rejects(() => gateway.executeTool('cofrinho_deposit', { goal_id: goal.id, source_account_id: conta.id, amount: 1, date: '2026-01-01' }, ownerCtx), { code: ErrorCodes.INSUFFICIENT_FUNDS });
});
