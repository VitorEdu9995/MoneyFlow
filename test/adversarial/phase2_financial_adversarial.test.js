import test from 'node:test';
import assert from 'node:assert/strict';

import { createDatabase, runMigrations } from '../../src/db/index.js';
import { SpaceIsolationService } from '../../src/services/spaceIsolationService.js';
import { Roles } from '../../src/domain/authorization.js';
import { ErrorCodes, AppError } from '../../src/domain/envelope.js';

function setupEnv() {
  const db = createDatabase(':memory:');
  runMigrations(db);
  const service = new SpaceIsolationService(db);

  const owner = service.createUser({ email: 'owner@moneyflow.dev', name: 'Owner' });
  const space = service.createSpace({ name: 'Espaço Adversarial', ownerUserId: owner.id });
  const ownerCtx = service.resolveAuthContext({ userId: owner.id, spaceId: space.id });
  const category = service.createCategory(ownerCtx, { name: 'Geral', kind: 'expense' });

  return { service, space, ownerCtx, category };
}

test('Adversarial Fase 2 — Fevereiro: fechamento dia 29 em ano não-bissexto clampa para 28 sem estourar mês', () => {
  const { service, ownerCtx, category } = setupEnv();
  const conta = service.createAccount(ownerCtx, { name: 'Conta' });
  const cartao = service.createCreditCard(ownerCtx, { name: 'Cartão', closingDay: 29, dueDay: 10, paymentAccountId: conta.id });

  // 2026 não é bissexto: compra em 28/02 deve fechar a fatura no dia 28 (clamp), nunca em 01/03.
  const purchase = service.createCardTransaction(ownerCtx, {
    type: 'card_purchase',
    creditCardId: cartao.id,
    amount: 1000,
    description: 'Compra fim de Fevereiro',
    categoryId: category.id,
    transactionDate: '2026-02-28',
  });

  const invoice = service.getCreditCardInvoice(ownerCtx, purchase.credit_card_invoice_id);
  assert.equal(invoice.closing_date, '2026-02-28');
  assert.notEqual(invoice.closing_date, '2026-03-01');
});

test('Adversarial Fase 2 — Pagamento repetido: mesma idempotencyKey não duplica o pagamento', () => {
  const { service, ownerCtx, category } = setupEnv();
  const conta = service.createAccount(ownerCtx, { name: 'Conta Pagadora' });
  const cartao = service.createCreditCard(ownerCtx, { name: 'Cartão', closingDay: 10, dueDay: 20, paymentAccountId: conta.id });

  const purchase = service.createCardTransaction(ownerCtx, {
    type: 'card_purchase',
    creditCardId: cartao.id,
    amount: 10000,
    description: 'Compra',
    categoryId: category.id,
    transactionDate: '2026-09-05',
  });
  const invoiceId = purchase.credit_card_invoice_id;

  const first = service.registerInvoicePayment(ownerCtx, {
    invoiceId,
    amount: 10000,
    paymentDate: '2026-09-15',
    accountId: conta.id,
    idempotencyKey: 'pagamento-fatura-setembro',
  });
  const second = service.registerInvoicePayment(ownerCtx, {
    invoiceId,
    amount: 10000,
    paymentDate: '2026-09-15',
    accountId: conta.id,
    idempotencyKey: 'pagamento-fatura-setembro',
  });

  assert.equal(first.duplicate, false);
  assert.equal(second.duplicate, true);
  assert.equal(second.paymentId, first.paymentId);

  const invoice = service.getCreditCardInvoice(ownerCtx, invoiceId);
  assert.equal(invoice.total_paid, 10000); // não dobrou para 20000
});

test('Adversarial Fase 2 — Valor excedente: pagamento maior que o devido gera crédito e status paid', () => {
  const { service, ownerCtx, category } = setupEnv();
  const conta = service.createAccount(ownerCtx, { name: 'Conta Pagadora' });
  const cartao = service.createCreditCard(ownerCtx, { name: 'Cartão', closingDay: 10, dueDay: 20, paymentAccountId: conta.id });

  const purchase = service.createCardTransaction(ownerCtx, {
    type: 'card_purchase',
    creditCardId: cartao.id,
    amount: 5000,
    description: 'Compra pequena',
    categoryId: category.id,
    transactionDate: '2026-09-05',
  });

  const result = service.registerInvoicePayment(ownerCtx, {
    invoiceId: purchase.credit_card_invoice_id,
    amount: 8000, // paga R$30,00 a mais
    paymentDate: '2026-09-15',
    accountId: conta.id,
  });

  assert.equal(result.invoice.status, 'paid');
  assert.equal(result.invoice.open_amount, -3000); // crédito para a próxima fatura
  assert.equal(result.excessAmount, 3000);
});

test('Adversarial Fase 2 — Previsão promovida: dupla promoção da mesma ocorrência é bloqueada', () => {
  const { service, ownerCtx, category } = setupEnv();
  const conta = service.createAccount(ownerCtx, { name: 'Conta Assinatura' });
  const recurrence = service.createRecurrence(ownerCtx, {
    description: 'Academia',
    type: 'expense',
    amount: 9000,
    accountId: conta.id,
    categoryId: category.id,
    frequency: 'monthly',
    startDate: '2026-09-05',
  });
  const [occurrence] = service.generateForecastOccurrences(ownerCtx, { recurrenceId: recurrence.id, untilDate: '2026-09-30' });

  service.promoteForecastToTransaction(ownerCtx, { occurrenceId: occurrence.id });

  assert.throws(
    () => service.promoteForecastToTransaction(ownerCtx, { occurrenceId: occurrence.id }),
    (err) => err instanceof AppError && err.code === ErrorCodes.OCCURRENCE_ALREADY_PROMOTED,
  );
});

test('Adversarial Fase 2 — Transferência pareada: referência entre espaços é negada e não cria perna órfã', () => {
  const { service, ownerCtx } = setupEnv();
  const contaA = service.createAccount(ownerCtx, { name: 'Conta A' });

  const outroOwner = service.createUser({ email: 'outro@moneyflow.dev', name: 'Outro' });
  const outroSpace = service.createSpace({ name: 'Outro Espaço', ownerUserId: outroOwner.id });
  const outroCtx = service.resolveAuthContext({ userId: outroOwner.id, spaceId: outroSpace.id });
  const contaEstranha = service.createAccount(outroCtx, { name: 'Conta de Outro Espaço' });

  assert.throws(
    () =>
      service.createTransfer(ownerCtx, {
        sourceAccountId: contaA.id,
        destinationAccountId: contaEstranha.id, // pertence a outro espaço
        amount: 1000,
        transferDate: '2026-09-25',
      }),
    (err) => err instanceof AppError && err.code === ErrorCodes.CROSS_SPACE_REFERENCE_DENIED,
  );

  // Nenhuma perna de transferência (transaction type=transfer) foi criada no espaço do owner.
  const orphanCount = service.db
    .prepare("SELECT COUNT(*) as count FROM transactions WHERE space_id = ? AND type = 'transfer'")
    .get(ownerCtx.spaceId).count;
  assert.equal(orphanCount, 0);
});

test('Adversarial Fase 2 — Dupla importação: mesmo payload não duplica contas', () => {
  const { service, ownerCtx } = setupEnv();
  const payload = {
    accounts: [{ localId: 'acc-1', name: 'Conta Duplicada?' }],
    categories: [],
    transactions: [],
  };

  const first = service.importLocalStorageExport(ownerCtx, { payload });
  const second = service.importLocalStorageExport(ownerCtx, { payload });

  assert.equal(first.duplicate, false);
  assert.equal(second.duplicate, true);
  assert.equal(second.batchId, first.batchId);

  const count = service.db
    .prepare('SELECT COUNT(*) as count FROM accounts WHERE space_id = ? AND name = ?')
    .get(ownerCtx.spaceId, 'Conta Duplicada?').count;
  assert.equal(count, 1);
});

test('Adversarial Fase 2 — Moeda incompatível: transferência entre contas com moedas diferentes é negada', () => {
  const { service, ownerCtx } = setupEnv();
  const contaBRL = service.createAccount(ownerCtx, { name: 'Conta BRL', currency: 'BRL' });
  const contaUSD = service.createAccount(ownerCtx, { name: 'Conta USD', currency: 'USD' });

  assert.throws(
    () =>
      service.createTransfer(ownerCtx, {
        sourceAccountId: contaBRL.id,
        destinationAccountId: contaUSD.id,
        amount: 1000,
        transferDate: '2026-09-25',
      }),
    (err) => err instanceof AppError && err.code === ErrorCodes.CURRENCY_MISMATCH,
  );
});
