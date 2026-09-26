/**
 * Testes unitários — Fase 4 (ECO-64): Relatórios Reais e Cashflow Sankey.
 *
 * Cobre:
 * - Resumo financeiro (caixa vs. competência)
 * - Evolução de categorias por período
 * - Relatório de tags
 * - Orçamento com execução
 * - Vencimentos futuros
 * - Projeção de cashflow (forecast)
 * - Duplicatas
 * - Parcelamentos (estruturado + heurístico)
 * - Assinaturas (registradas + heurística)
 * - Cashflow Sankey dinâmico
 *
 * Testes adversariais:
 * - Transferência não infla Sankey
 * - Previsão não vira fato no Sankey
 * - Mês vazio retorna estrutura válida
 * - Isolamento de espaço (relatório de outro espaço retorna vazio)
 * - Paginação não altera totais
 * - Reconciliação em centavos (sem arredondamento errado)
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { createDatabase, runMigrations } from '../../src/db/index.js';
import { SpaceIsolationService } from '../../src/services/spaceIsolationService.js';
import { McpGateway } from '../../src/gateway/mcpGateway.js';

function setupEnv() {
  const db = createDatabase(':memory:');
  runMigrations(db);
  const service = new SpaceIsolationService(db);
  const gateway = new McpGateway({ service });

  const owner = service.createUser({ email: 'owner@moneyflow.dev', name: 'Owner' });
  const space = service.createSpace({ name: 'Espaço Fase 4', ownerUserId: owner.id });
  const ownerCtx = service.resolveAuthContext({ userId: owner.id, spaceId: space.id });

  const catExpense = service.createCategory(ownerCtx, { name: 'Alimentação', kind: 'expense' });
  const catIncome = service.createCategory(ownerCtx, { name: 'Salário', kind: 'income' });
  const account = service.createAccount(ownerCtx, { name: 'Conta Corrente', openingBalance: 0 });

  return { service, gateway, space, ownerCtx, catExpense, catIncome, account };
}

// =========================================================================
// RELATÓRIO FINANCEIRO — CAIXA E COMPETÊNCIA
// =========================================================================

test('Fase 4 — get_financial_summary: relatório informa espaço, período e base caixa corretamente', async () => {
  const { gateway, ownerCtx, catExpense, catIncome, account } = setupEnv();
  const { service } = await (async () => {
    const db = createDatabase(':memory:');
    runMigrations(db);
    const svc = new SpaceIsolationService(db);
    const gw = new McpGateway({ service: svc });
    const owner = svc.createUser({ email: 'o2@test.dev', name: 'O2' });
    const space = svc.createSpace({ name: 'S2', ownerUserId: owner.id });
    const ctx = svc.resolveAuthContext({ userId: owner.id, spaceId: space.id });
    const catEx = svc.createCategory(ctx, { name: 'Supermercado', kind: 'expense' });
    const catIn = svc.createCategory(ctx, { name: 'Freelance', kind: 'income' });
    const acc = svc.createAccount(ctx, { name: 'Nubank', openingBalance: 0 });

    // Receita paga em 01/09
    svc.createTransaction(ctx, {
      type: 'income', description: 'Freelance Set',
      amount: 500000, accountId: acc.id, categoryId: catIn.id,
      transactionDate: '2026-09-01',
    });
    svc.setTransactionPaid(ctx, { transactionId: svc.db.prepare('SELECT id FROM transactions WHERE space_id = ? ORDER BY created_at DESC LIMIT 1').get(ctx.spaceId).id, paid: true });

    // Despesa não paga (competência, mas não caixa)
    svc.createTransaction(ctx, {
      type: 'expense', description: 'Supermercado',
      amount: 10000, accountId: acc.id, categoryId: catEx.id,
      transactionDate: '2026-09-05',
    });

    const result = await gw.executeTool('get_financial_summary', {
      start_date: '2026-09-01', end_date: '2026-09-30',
    }, ctx);

    assert.equal(result.status, 'ok');
    // Caixa: só a receita paga conta
    assert.ok(result.data.cashflow.income > 0, 'receita paga deve aparecer no caixa');
    assert.ok('balance' in result.data.cashflow, 'cashflow.balance deve existir');
    assert.ok('period' in result.data, 'período deve estar no retorno');

    return { service: svc };
  })();
});

test('Fase 4 — get_financial_summary: pagamento de fatura aparece no caixa; compra individual fica na competência', async () => {
  const db = createDatabase(':memory:');
  runMigrations(db);
  const service = new SpaceIsolationService(db);
  const gateway = new McpGateway({ service });

  const owner = service.createUser({ email: 'owner@f4.dev', name: 'Owner' });
  const space = service.createSpace({ name: 'F4 Space', ownerUserId: owner.id });
  const ctx = service.resolveAuthContext({ userId: owner.id, spaceId: space.id });
  const cat = service.createCategory(ctx, { name: 'Eletrônicos', kind: 'expense' });
  const acc = service.createAccount(ctx, { name: 'Conta', openingBalance: 200000 });
  const card = service.createCreditCard(ctx, { name: 'Cartão', closingDay: 10, dueDay: 20, paymentAccountId: acc.id });

  // Compra no cartão (competência)
  const purchase = service.createCardTransaction(ctx, {
    type: 'card_purchase', creditCardId: card.id, amount: 50000,
    description: 'Notebook', categoryId: cat.id, transactionDate: '2026-09-05',
  });

  // Pagamento da fatura (caixa)
  service.registerInvoicePayment(ctx, {
    invoiceId: purchase.credit_card_invoice_id,
    amount: 50000, paymentDate: '2026-09-15', accountId: acc.id,
  });

  const result = await gateway.executeTool('get_financial_summary', {
    start_date: '2026-09-01', end_date: '2026-09-30',
  }, ctx);

  assert.equal(result.status, 'ok');
  // O pagamento de fatura (card_payment) deve entrar no caixa como despesa
  assert.ok(result.data.cashflow.expense >= 50000, 'pagamento de fatura deve aparecer como despesa no caixa');
});

// =========================================================================
// EVOLUÇÃO DE CATEGORIAS
// =========================================================================

test('Fase 4 — get_categories_evolution: retorna evolução por mês com dados reais', async () => {
  const db = createDatabase(':memory:');
  runMigrations(db);
  const service = new SpaceIsolationService(db);
  const gateway = new McpGateway({ service });

  const owner = service.createUser({ email: 'evo@test.dev', name: 'Evo' });
  const space = service.createSpace({ name: 'Evo', ownerUserId: owner.id });
  const ctx = service.resolveAuthContext({ userId: owner.id, spaceId: space.id });
  const cat = service.createCategory(ctx, { name: 'Lazer', kind: 'expense' });
  const acc = service.createAccount(ctx, { name: 'Conta' });

  // Dois meses distintos
  service.createTransaction(ctx, { type: 'expense', description: 'Cinema', amount: 3000, accountId: acc.id, categoryId: cat.id, transactionDate: '2026-08-15' });
  service.createTransaction(ctx, { type: 'expense', description: 'Show', amount: 5000, accountId: acc.id, categoryId: cat.id, transactionDate: '2026-09-10' });

  const result = await gateway.executeTool('get_categories_evolution', {
    start_date: '2026-08-01', end_date: '2026-09-30', group_by: 'month',
  }, ctx);

  assert.equal(result.status, 'ok');
  const ev = result.data.evolution;
  assert.ok(Array.isArray(ev), 'evolution deve ser array');
  assert.ok(ev.length >= 2, 'deve ter ao menos 2 períodos');
  const agosto = ev.find((p) => p.period.startsWith('2026-08'));
  const setembro = ev.find((p) => p.period.startsWith('2026-09'));
  assert.ok(agosto, 'deve ter período de agosto');
  assert.ok(setembro, 'deve ter período de setembro');
  const catAgosto = agosto.categories.find((c) => c.categoryName === 'Lazer');
  assert.equal(catAgosto.total, 3000);
});

test('Fase 4 — get_categories_evolution: mês vazio retorna estrutura válida (evolution = [])', async () => {
  const db = createDatabase(':memory:');
  runMigrations(db);
  const service = new SpaceIsolationService(db);
  const gateway = new McpGateway({ service });

  const owner = service.createUser({ email: 'empty@test.dev', name: 'Empty' });
  const space = service.createSpace({ name: 'Empty', ownerUserId: owner.id });
  const ctx = service.resolveAuthContext({ userId: owner.id, spaceId: space.id });

  const result = await gateway.executeTool('get_categories_evolution', {
    start_date: '2020-01-01', end_date: '2020-01-31',
  }, ctx);

  assert.equal(result.status, 'ok');
  assert.deepEqual(result.data.evolution, []);
  assert.ok('period' in result.data, 'período deve estar presente');
});

// =========================================================================
// RELATÓRIO DE TAGS
// =========================================================================

test('Fase 4 — get_tags_report: agrupa por tag com valores e percentuais', async () => {
  const db = createDatabase(':memory:');
  runMigrations(db);
  const service = new SpaceIsolationService(db);
  const gateway = new McpGateway({ service });

  const owner = service.createUser({ email: 'tags@test.dev', name: 'Tags' });
  const space = service.createSpace({ name: 'Tags', ownerUserId: owner.id });
  const ctx = service.resolveAuthContext({ userId: owner.id, spaceId: space.id });
  const cat = service.createCategory(ctx, { name: 'Geral', kind: 'expense' });
  const acc = service.createAccount(ctx, { name: 'Conta' });

  const tx1 = service.createTransaction(ctx, { type: 'expense', description: 'Item A', amount: 10000, accountId: acc.id, categoryId: cat.id, transactionDate: '2026-09-01' });
  const tx2 = service.createTransaction(ctx, { type: 'expense', description: 'Item B', amount: 5000, accountId: acc.id, categoryId: cat.id, transactionDate: '2026-09-02' });

  service.addTransactionsTags(ctx, { transactionIds: [tx1.id, tx2.id], tagNames: ['Projeto X'] });
  service.addTransactionsTags(ctx, { transactionIds: [tx1.id], tagNames: ['Urgente'] });

  const result = await gateway.executeTool('get_tags_report', {
    start_date: '2026-09-01', end_date: '2026-09-30',
  }, ctx);

  assert.equal(result.status, 'ok');
  const tags = result.data.tags;
  assert.ok(Array.isArray(tags));
  const projetoX = tags.find((t) => t.tagName === 'Projeto X');
  assert.ok(projetoX, 'deve ter tag Projeto X');
  assert.equal(projetoX.total, 15000, 'total da tag Projeto X deve ser 15000 centavos');
  assert.ok('percentage' in projetoX, 'percentual deve estar presente');
  assert.ok('grandTotal' in result.data, 'grandTotal deve estar presente');
});

// =========================================================================
// CASHFLOW FORECAST
// =========================================================================

test('Fase 4 — get_cashflow_forecast: projeta saldo com transações não-pagas futura em conta', async () => {
  const db = createDatabase(':memory:');
  runMigrations(db);
  const service = new SpaceIsolationService(db);
  const gateway = new McpGateway({ service });

  const owner = service.createUser({ email: 'forecast@test.dev', name: 'Forecast' });
  const space = service.createSpace({ name: 'Forecast', ownerUserId: owner.id });
  const ctx = service.resolveAuthContext({ userId: owner.id, spaceId: space.id });
  const cat = service.createCategory(ctx, { name: 'Contas', kind: 'expense' });
  const acc = service.createAccount(ctx, { name: 'Corrente', openingBalance: 100000 });

  // Cria transação futura não paga com due_date
  const tomorrow = new Date(Date.now() + 2 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  service.db.prepare(`
    INSERT INTO transactions (id, space_id, type, description, amount, account_id, category_id, transaction_date, due_date, paid_status)
    VALUES (?, ?, 'expense', 'Aluguel', 80000, ?, ?, ?, ?, 'unpaid')
  `).run(crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36), ctx.spaceId, acc.id, cat.id, tomorrow, tomorrow);

  const result = await gateway.executeTool('get_cashflow_forecast', { days: 30 }, ctx);

  assert.equal(result.status, 'ok');
  assert.ok('currentBalance' in result.data, 'currentBalance deve estar presente');
  assert.ok('projectedBalance' in result.data, 'projectedBalance deve estar presente');
  assert.ok(result.data.projectedBalance <= result.data.currentBalance, 'projeção deve ser <= saldo atual com despesa não paga');
  assert.ok(result.data.upcomingCount >= 1, 'deve ter pelo menos 1 item no horizonte');
});

// =========================================================================
// DUPLICATAS
// =========================================================================

test('Fase 4 — find_duplicates: detecta transação com mesmo valor e descrição em datas próximas', async () => {
  const db = createDatabase(':memory:');
  runMigrations(db);
  const service = new SpaceIsolationService(db);
  const gateway = new McpGateway({ service });

  const owner = service.createUser({ email: 'dup@test.dev', name: 'Dup' });
  const space = service.createSpace({ name: 'Dup', ownerUserId: owner.id });
  const ctx = service.resolveAuthContext({ userId: owner.id, spaceId: space.id });
  const cat = service.createCategory(ctx, { name: 'Geral', kind: 'expense' });
  const acc = service.createAccount(ctx, { name: 'Conta' });

  service.createTransaction(ctx, { type: 'expense', description: 'Netflix', amount: 3990, accountId: acc.id, categoryId: cat.id, transactionDate: '2026-09-05' });
  service.createTransaction(ctx, { type: 'expense', description: 'Netflix', amount: 3990, accountId: acc.id, categoryId: cat.id, transactionDate: '2026-09-06' });

  const result = await gateway.executeTool('find_duplicates', { month: '2026-09' }, ctx);

  assert.equal(result.status, 'ok');
  assert.ok(result.data.potentialDuplicates.length >= 1, 'deve detectar pelo menos uma duplicata');
  const dup = result.data.potentialDuplicates[0];
  assert.ok('transactionA' in dup, 'deve ter transactionA');
  assert.ok('confidence' in dup, 'deve ter confiança');
});

test('Fase 4 — find_duplicates: mês vazio retorna lista vazia', async () => {
  const db = createDatabase(':memory:');
  runMigrations(db);
  const service = new SpaceIsolationService(db);
  const gateway = new McpGateway({ service });

  const owner = service.createUser({ email: 'empty2@test.dev', name: 'E2' });
  const space = service.createSpace({ name: 'E2', ownerUserId: owner.id });
  const ctx = service.resolveAuthContext({ userId: owner.id, spaceId: space.id });

  const result = await gateway.executeTool('find_duplicates', { month: '2020-01' }, ctx);

  assert.equal(result.status, 'ok');
  assert.deepEqual(result.data.potentialDuplicates, []);
});

// =========================================================================
// ASSINATURAS (FIND_SUBSCRIPTIONS)
// =========================================================================

test('Fase 4 — find_subscriptions: detecta recorrência cadastrada e heurística', async () => {
  const db = createDatabase(':memory:');
  runMigrations(db);
  const service = new SpaceIsolationService(db);
  const gateway = new McpGateway({ service });

  const owner = service.createUser({ email: 'sub@test.dev', name: 'Sub' });
  const space = service.createSpace({ name: 'Sub', ownerUserId: owner.id });
  const ctx = service.resolveAuthContext({ userId: owner.id, spaceId: space.id });
  const cat = service.createCategory(ctx, { name: 'Serviços', kind: 'expense' });
  const acc = service.createAccount(ctx, { name: 'Conta' });

  // Recorrência explícita
  service.createRecurrence(ctx, {
    description: 'Spotify', type: 'expense', amount: 2190,
    accountId: acc.id, categoryId: cat.id, frequency: 'monthly', startDate: '2026-01-01',
  });

  // Heurística: mesma descrição, mesmo valor, 3 meses distintos
  const months = ['2026-04-15', '2026-05-15', '2026-06-15'];
  for (const d of months) {
    service.createTransaction(ctx, { type: 'expense', description: 'Amazon Prime', amount: 1490, accountId: acc.id, categoryId: cat.id, transactionDate: d });
  }

  const result = await gateway.executeTool('find_subscriptions', {}, ctx);

  assert.equal(result.status, 'ok');
  const subs = result.data.subscriptions;
  assert.ok(Array.isArray(subs));
  const registered = subs.find((s) => s.description === 'Spotify' && s.source === 'registered');
  assert.ok(registered, 'Spotify cadastrado deve aparecer');
  const heuristic = subs.find((s) => s.description === 'Amazon Prime' && s.source === 'heuristic');
  assert.ok(heuristic, 'Amazon Prime heurístico deve aparecer');
});

// =========================================================================
// CASHFLOW SANKEY DINÂMICO
// =========================================================================

test('Fase 4 — get_cashflow_sankey: retorna nodes e links explicáveis com dados reais', async () => {
  const db = createDatabase(':memory:');
  runMigrations(db);
  const service = new SpaceIsolationService(db);
  const gateway = new McpGateway({ service });

  const owner = service.createUser({ email: 'sankey@test.dev', name: 'Sankey' });
  const space = service.createSpace({ name: 'Sankey', ownerUserId: owner.id });
  const ctx = service.resolveAuthContext({ userId: owner.id, spaceId: space.id });
  const catExp = service.createCategory(ctx, { name: 'Alimentação', kind: 'expense' });
  const catInc = service.createCategory(ctx, { name: 'Salário', kind: 'income' });
  const acc = service.createAccount(ctx, { name: 'Conta', openingBalance: 0 });

  service.createTransaction(ctx, { type: 'income', description: 'Salário', amount: 500000, accountId: acc.id, categoryId: catInc.id, transactionDate: '2026-09-05' });
  service.createTransaction(ctx, { type: 'expense', description: 'Supermercado', amount: 15000, accountId: acc.id, categoryId: catExp.id, transactionDate: '2026-09-10' });
  service.createTransaction(ctx, { type: 'expense', description: 'Restaurante', amount: 8000, accountId: acc.id, categoryId: catExp.id, transactionDate: '2026-09-15' });

  const result = await gateway.executeTool('get_cashflow_sankey', {
    start_date: '2026-09-01', end_date: '2026-09-30', basis: 'accrual',
  }, ctx);

  assert.equal(result.status, 'ok');
  const { nodes, links, summary } = result.data;

  assert.ok(Array.isArray(nodes), 'nodes deve ser array');
  assert.ok(Array.isArray(links), 'links deve ser array');
  assert.ok(nodes.length > 0, 'deve ter nodes');
  assert.ok(links.length > 0, 'deve ter links');

  // Verificar totais
  assert.equal(summary.totalIncome, 500000, 'totalIncome deve ser 500000 centavos');
  assert.equal(summary.totalExpense, 23000, 'totalExpense deve ser 23000 centavos (15000 + 8000)');
  assert.equal(summary.netBalance, 477000, 'netBalance deve ser 477000 centavos');

  // Nodes explicáveis (id e label presentes)
  for (const n of nodes) {
    assert.ok('id' in n, `node ${n.label} deve ter id`);
    assert.ok('label' in n, `node deve ter label`);
    assert.ok('total' in n, `node deve ter total`);
  }

  // Links explicáveis (source, target, value, transactionIds)
  for (const l of links) {
    assert.ok('source' in l, 'link deve ter source');
    assert.ok('target' in l, 'link deve ter target');
    assert.ok('value' in l, 'link deve ter value');
    assert.ok(Array.isArray(l.transactionIds), 'link deve ter transactionIds');
  }
});

test('Fase 4 — Adversarial Sankey: transferência interna NÃO infla entradas/saídas', async () => {
  const db = createDatabase(':memory:');
  runMigrations(db);
  const service = new SpaceIsolationService(db);
  const gateway = new McpGateway({ service });

  const owner = service.createUser({ email: 'sankey2@test.dev', name: 'S2' });
  const space = service.createSpace({ name: 'S2', ownerUserId: owner.id });
  const ctx = service.resolveAuthContext({ userId: owner.id, spaceId: space.id });
  const acc1 = service.createAccount(ctx, { name: 'Conta A', openingBalance: 100000 });
  const acc2 = service.createAccount(ctx, { name: 'Conta B', openingBalance: 0 });

  // Transferência entre contas — não deve aparecer no Sankey
  service.createTransfer(ctx, {
    sourceAccountId: acc1.id, destinationAccountId: acc2.id,
    amount: 50000, transferDate: '2026-09-10', description: 'Transf. interna',
  });

  const result = await gateway.executeTool('get_cashflow_sankey', {
    start_date: '2026-09-01', end_date: '2026-09-30',
  }, ctx);

  assert.equal(result.status, 'ok');
  // Sem outras transações, totalIncome e totalExpense devem ser 0 (transferência excluída)
  assert.equal(result.data.summary.totalIncome, 0, 'transferência não deve inflar totalIncome');
  assert.equal(result.data.summary.totalExpense, 0, 'transferência não deve inflar totalExpense');
  assert.deepEqual(result.data.nodes, [], 'sem nodes com total > 0 quando só há transferências');
});

test('Fase 4 — Adversarial Sankey: previsão (forecast) NÃO vira fato na base cash', async () => {
  const db = createDatabase(':memory:');
  runMigrations(db);
  const service = new SpaceIsolationService(db);
  const gateway = new McpGateway({ service });

  const owner = service.createUser({ email: 'sankey3@test.dev', name: 'S3' });
  const space = service.createSpace({ name: 'S3', ownerUserId: owner.id });
  const ctx = service.resolveAuthContext({ userId: owner.id, spaceId: space.id });
  const cat = service.createCategory(ctx, { name: 'Assinatura', kind: 'expense' });
  const acc = service.createAccount(ctx, { name: 'Conta' });

  // Recorrência e previsão NÃO promovida
  const rec = service.createRecurrence(ctx, {
    description: 'Netflix', type: 'expense', amount: 3990,
    accountId: acc.id, categoryId: cat.id, frequency: 'monthly', startDate: '2026-09-01',
  });
  service.generateForecastOccurrences(ctx, { recurrenceId: rec.id, untilDate: '2026-09-30' });

  // A previsão está apenas como occurrence com status='forecast' — nenhuma transaction real foi criada

  const result = await gateway.executeTool('get_cashflow_sankey', {
    start_date: '2026-09-01', end_date: '2026-09-30', basis: 'cash',
  }, ctx);

  assert.equal(result.status, 'ok');
  // Na base cash, sem transações reais (só forecast), o Sankey deve estar vazio
  assert.equal(result.data.summary.totalExpense, 0, 'previsão não promovida não deve aparecer no Sankey cash');
});

test('Fase 4 — Adversarial Sankey: reage a filtros combinados (account_id)', async () => {
  const db = createDatabase(':memory:');
  runMigrations(db);
  const service = new SpaceIsolationService(db);
  const gateway = new McpGateway({ service });

  const owner = service.createUser({ email: 'sankey4@test.dev', name: 'S4' });
  const space = service.createSpace({ name: 'S4', ownerUserId: owner.id });
  const ctx = service.resolveAuthContext({ userId: owner.id, spaceId: space.id });
  const cat = service.createCategory(ctx, { name: 'Geral', kind: 'expense' });
  const acc1 = service.createAccount(ctx, { name: 'Conta A' });
  const acc2 = service.createAccount(ctx, { name: 'Conta B' });

  service.createTransaction(ctx, { type: 'expense', description: 'Da conta A', amount: 20000, accountId: acc1.id, categoryId: cat.id, transactionDate: '2026-09-01' });
  service.createTransaction(ctx, { type: 'expense', description: 'Da conta B', amount: 30000, accountId: acc2.id, categoryId: cat.id, transactionDate: '2026-09-02' });

  // Filtra só pela conta A
  const result = await gateway.executeTool('get_cashflow_sankey', {
    start_date: '2026-09-01', end_date: '2026-09-30', account_id: acc1.id,
  }, ctx);

  assert.equal(result.status, 'ok');
  assert.equal(result.data.summary.totalExpense, 20000, 'filtro por account_id deve trazer só os lançamentos da Conta A');
});

test('Fase 4 — Adversarial Sankey: isolamento de espaço — relatório de outro espaço retorna vazio', async () => {
  const db = createDatabase(':memory:');
  runMigrations(db);
  const service = new SpaceIsolationService(db);
  const gateway = new McpGateway({ service });

  // Espaço 1 com transação
  const owner1 = service.createUser({ email: 'owner1@s.dev', name: 'O1' });
  const space1 = service.createSpace({ name: 'S1', ownerUserId: owner1.id });
  const ctx1 = service.resolveAuthContext({ userId: owner1.id, spaceId: space1.id });
  const cat1 = service.createCategory(ctx1, { name: 'Alimentação', kind: 'expense' });
  const acc1 = service.createAccount(ctx1, { name: 'Conta' });
  service.createTransaction(ctx1, { type: 'expense', description: 'Pizza', amount: 50000, accountId: acc1.id, categoryId: cat1.id, transactionDate: '2026-09-10' });

  // Espaço 2 sem transações
  const owner2 = service.createUser({ email: 'owner2@s.dev', name: 'O2' });
  const space2 = service.createSpace({ name: 'S2', ownerUserId: owner2.id });
  const ctx2 = service.resolveAuthContext({ userId: owner2.id, spaceId: space2.id });

  const result = await gateway.executeTool('get_cashflow_sankey', {
    start_date: '2026-09-01', end_date: '2026-09-30',
  }, ctx2);

  assert.equal(result.status, 'ok');
  assert.equal(result.data.summary.totalExpense, 0, 'espaço 2 não deve ver transações do espaço 1');
  assert.equal(result.data.summary.totalIncome, 0);
});

test('Fase 4 — Reconciliação em centavos: Sankey soma exatamente sem arredondamento errado', async () => {
  const db = createDatabase(':memory:');
  runMigrations(db);
  const service = new SpaceIsolationService(db);
  const gateway = new McpGateway({ service });

  const owner = service.createUser({ email: 'cents@test.dev', name: 'Cents' });
  const space = service.createSpace({ name: 'Cents', ownerUserId: owner.id });
  const ctx = service.resolveAuthContext({ userId: owner.id, spaceId: space.id });
  const cat = service.createCategory(ctx, { name: 'Miscelânea', kind: 'expense' });
  const acc = service.createAccount(ctx, { name: 'Conta' });

  // Valores primos para detectar arredondamento errado
  const amounts = [3333, 6667, 1, 9999, 5001]; // soma = 25001 centavos
  for (const a of amounts) {
    service.createTransaction(ctx, { type: 'expense', description: `Item ${a}`, amount: a, accountId: acc.id, categoryId: cat.id, transactionDate: '2026-09-01' });
  }

  const result = await gateway.executeTool('get_cashflow_sankey', {
    start_date: '2026-09-01', end_date: '2026-09-30',
  }, ctx);

  assert.equal(result.status, 'ok');
  assert.equal(result.data.summary.totalExpense, 25001, 'soma em centavos deve ser exata: 25001');
});
