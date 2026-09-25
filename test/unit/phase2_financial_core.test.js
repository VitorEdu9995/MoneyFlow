import test from 'node:test';
import assert from 'node:assert/strict';

import { createDatabase, runMigrations } from '../../src/db/index.js';
import { SpaceIsolationService, addMonthsClamped, computeInvoiceCycle } from '../../src/services/spaceIsolationService.js';
import { Roles } from '../../src/domain/authorization.js';
import { ErrorCodes, AppError } from '../../src/domain/envelope.js';

function setupEnv() {
  const db = createDatabase(':memory:');
  runMigrations(db);
  const service = new SpaceIsolationService(db);

  const owner = service.createUser({ email: 'owner@moneyflow.dev', name: 'Owner' });
  const editor = service.createUser({ email: 'editor@moneyflow.dev', name: 'Editor' });
  const viewer = service.createUser({ email: 'viewer@moneyflow.dev', name: 'Viewer' });

  const space = service.createSpace({ name: 'Espaço Financeiro', ownerUserId: owner.id });

  const ownerCtx = service.resolveAuthContext({ userId: owner.id, spaceId: space.id });
  service.addMember(ownerCtx, { targetUserId: editor.id, role: Roles.EDITOR });
  service.addMember(ownerCtx, { targetUserId: viewer.id, role: Roles.VIEWER });

  const editorCtx = service.resolveAuthContext({ userId: editor.id, spaceId: space.id });
  const viewerCtx = service.resolveAuthContext({ userId: viewer.id, spaceId: space.id });

  const category = service.createCategory(editorCtx, { name: 'Mercado', kind: 'expense' });

  return { service, space, ownerCtx, editorCtx, viewerCtx, category };
}

test('Utilitário de data: addMonthsClamped nunca estoura o mês (edge case Fevereiro)', () => {
  assert.equal(addMonthsClamped('2026-01-31', 1), '2026-02-28');
  assert.equal(addMonthsClamped('2028-01-31', 1), '2028-02-29'); // 2028 é bissexto
  assert.equal(addMonthsClamped('2026-01-31', 2), '2026-03-31');
  assert.equal(addMonthsClamped('2026-11-30', 3), '2027-02-28');
});

test('computeInvoiceCycle lida com fechamento dia 31 em Fevereiro sem estourar', () => {
  const cycle = computeInvoiceCycle('2026-02-15', 31, 10);
  assert.equal(cycle.closingDate, '2026-02-28');
  assert.equal(cycle.cycleStart, '2026-02-01'); // fechamento anterior (Janeiro dia 31) + 1 dia
});

test('Tags: criação idempotente por nome e vínculo a transações', () => {
  const { service, editorCtx, category } = setupEnv();
  const account = service.createAccount(editorCtx, { name: 'Conta Corrente' });
  const tx = service.createTransaction(editorCtx, {
    type: 'expense',
    description: 'Compra supermercado',
    amount: 5000,
    accountId: account.id,
    categoryId: category.id,
    transactionDate: '2026-09-25',
  });

  const tagA1 = service.createTag(editorCtx, { name: 'essencial' });
  const tagA2 = service.createTag(editorCtx, { name: 'essencial' }); // mesmo nome -> mesma tag
  assert.equal(tagA1.id, tagA2.id);

  service.addTransactionsTags(editorCtx, { transactionIds: [tx.id], tagNames: ['essencial', 'mercado'] });
  const tags = service.listTransactionTags(editorCtx, tx.id);
  assert.equal(tags.length, 2);
  assert.deepEqual(tags.map((t) => t.name).sort(), ['essencial', 'mercado']);
});

test('Transferência pareada: cria duas transações type=transfer e não altera receita/despesa', () => {
  const { service, editorCtx } = setupEnv();
  const contaA = service.createAccount(editorCtx, { name: 'Conta A', openingBalance: 10000 });
  const contaB = service.createAccount(editorCtx, { name: 'Conta B' });

  const transfer = service.createTransfer(editorCtx, {
    sourceAccountId: contaA.id,
    destinationAccountId: contaB.id,
    amount: 3000,
    transferDate: '2026-09-25',
  });

  assert.equal(transfer.amount, 3000);
  const sourceTx = service.getTransaction(editorCtx, transfer.source_transaction_id);
  const destTx = service.getTransaction(editorCtx, transfer.destination_transaction_id);
  assert.equal(sourceTx.type, 'transfer');
  assert.equal(destTx.type, 'transfer');

  const summary = service.getPeriodSummary(editorCtx, { year: 2026, month: 9, basis: 'accrual' });
  assert.equal(summary.income, 0);
  assert.equal(summary.expense, 0);
});

test('Ciclo de fatura: compra gera fatura aberta, pagamento integral fecha (paid)', () => {
  const { service, editorCtx, category } = setupEnv();
  const conta = service.createAccount(editorCtx, { name: 'Conta Pagamento' });
  const cartao = service.createCreditCard(editorCtx, { name: 'Cartão Roxo', closingDay: 10, dueDay: 20, paymentAccountId: conta.id });

  const purchase = service.createCardTransaction(editorCtx, {
    type: 'card_purchase',
    creditCardId: cartao.id,
    amount: 15000,
    description: 'Compra parcelada única',
    categoryId: category.id,
    transactionDate: '2026-09-05',
  });

  const invoice = service.getCreditCardInvoice(editorCtx, purchase.credit_card_invoice_id);
  assert.equal(invoice.total_charges, 15000);
  assert.equal(invoice.open_amount, 15000);
  assert.equal(invoice.status, 'open');

  const paymentResult = service.registerInvoicePayment(editorCtx, {
    invoiceId: invoice.id,
    amount: 15000,
    paymentDate: '2026-09-18',
    accountId: conta.id,
  });

  assert.equal(paymentResult.invoice.status, 'paid');
  assert.equal(paymentResult.invoice.open_amount, 0);
});

test('Parcelamento: soma exata em centavos e datas mensais sem estouro (Fevereiro)', () => {
  const { service, editorCtx, category } = setupEnv();
  const conta = service.createAccount(editorCtx, { name: 'Conta Parcelas' });

  const plan = service.createInstallmentPlan(editorCtx, {
    description: 'Geladeira',
    totalAmount: 1000, // 3 parcelas: 334 + 333 + 333 = 1000
    installmentsCount: 3,
    firstDueDate: '2026-01-31',
    accountId: conta.id,
    categoryId: category.id,
  });

  const amounts = plan.installments.map((i) => i.amount);
  assert.deepEqual(amounts, [334, 333, 333]);
  assert.equal(amounts.reduce((a, b) => a + b, 0), 1000);

  const dueDates = plan.installments.map((i) => i.transaction_date);
  assert.deepEqual(dueDates, ['2026-01-31', '2026-02-28', '2026-03-31']);
});

test('Recorrência: gera previsões e promove uma delas a lançamento real', () => {
  const { service, editorCtx, category } = setupEnv();
  const conta = service.createAccount(editorCtx, { name: 'Conta Assinaturas' });

  const recurrence = service.createRecurrence(editorCtx, {
    description: 'Streaming',
    type: 'expense',
    amount: 2500,
    accountId: conta.id,
    categoryId: category.id,
    frequency: 'monthly',
    startDate: '2026-09-10',
  });

  const occurrences = service.generateForecastOccurrences(editorCtx, {
    recurrenceId: recurrence.id,
    untilDate: '2026-12-31',
  });
  assert.equal(occurrences.length, 4); // set, out, nov, dez

  const promoted = service.promoteForecastToTransaction(editorCtx, { occurrenceId: occurrences[0].id });
  assert.equal(promoted.amount, 2500);
  assert.equal(promoted.recurrence_id, recurrence.id);
});

test('Exclusão com histórico prefere arquivamento e exibe impacto', () => {
  const { service, editorCtx, category } = setupEnv();
  const conta = service.createAccount(editorCtx, { name: 'Conta com Histórico' });
  service.createTransaction(editorCtx, {
    type: 'expense',
    description: 'Compra',
    amount: 1000,
    accountId: conta.id,
    categoryId: category.id,
    transactionDate: '2026-09-25',
  });

  const result = service.deleteAccount(editorCtx, conta.id);
  assert.equal(result.archived, true);
  assert.equal(result.deleted, false);
  assert.equal(result.impact.transactionsCount, 1);

  // Conta arquivada some da listagem padrão, mas ainda pode ser consultada.
  const listed = service.listAccounts(editorCtx);
  assert.equal(listed.some((a) => a.id === conta.id), false);
  const fetched = service.getAccount(editorCtx, conta.id);
  assert.ok(fetched.archived_at);
});

test('Exclusão sem histórico remove fisicamente', () => {
  const { service, editorCtx } = setupEnv();
  const conta = service.createAccount(editorCtx, { name: 'Conta Vazia' });
  const result = service.deleteAccount(editorCtx, conta.id);
  assert.equal(result.deleted, true);
  assert.equal(result.archived, false);

  assert.throws(
    () => service.getAccount(editorCtx, conta.id),
    (err) => err instanceof AppError && err.code === ErrorCodes.NOT_FOUND,
  );
});

test('Importação do slice local: cria contas, categorias e transações e preserva o export original', () => {
  const { service, editorCtx } = setupEnv();
  const payload = {
    source: 'localstorage_mvp',
    accounts: [{ localId: 'acc-1', name: 'Conta Importada', openingBalance: 500 }],
    categories: [{ localId: 'cat-1', name: 'Transporte', kind: 'expense' }],
    transactions: [
      {
        localId: 'tx-1',
        type: 'expense',
        description: 'Uber',
        amount: 2000,
        transactionDate: '2026-09-01',
        accountLocalId: 'acc-1',
        categoryLocalId: 'cat-1',
      },
    ],
  };

  const result = service.importLocalStorageExport(editorCtx, { payload });
  assert.equal(result.duplicate, false);
  assert.equal(result.importedAccounts, 1);
  assert.equal(result.importedCategories, 1);
  assert.equal(result.importedTransactions, 1);
  assert.equal(result.skipped, 0);

  const batch = service.getImportBatch(editorCtx, result.batchId);
  const storedPayload = JSON.parse(batch.raw_payload);
  assert.deepEqual(storedPayload, payload);
});

test('Reversão de importação arquiva/soft-deleta apenas as entidades daquele lote', () => {
  const { service, editorCtx } = setupEnv();
  const payload = {
    accounts: [{ localId: 'acc-1', name: 'Conta a Reverter' }],
    categories: [],
    transactions: [],
  };
  const result = service.importLocalStorageExport(editorCtx, { payload });
  const reversal = service.reverseImportBatch(editorCtx, { batchId: result.batchId });
  assert.equal(reversal.reversed, true);
  assert.equal(reversal.entitiesCount, 1);

  const account = service.db
    .prepare('SELECT * FROM accounts WHERE space_id = ? AND name = ?')
    .get(editorCtx.spaceId, 'Conta a Reverter');
  assert.ok(account.archived_at);
});
