import test from 'node:test';
import assert from 'node:assert/strict';

import { createDatabase, runMigrations } from '../../src/db/index.js';
import { SpaceIsolationService } from '../../src/services/spaceIsolationService.js';
import { Roles } from '../../src/domain/authorization.js';

function setupEnv() {
  const db = createDatabase(':memory:');
  runMigrations(db);
  const service = new SpaceIsolationService(db);

  const owner = service.createUser({ email: 'owner@moneyflow.dev', name: 'Owner' });
  const space = service.createSpace({ name: 'Espaço Saldo', ownerUserId: owner.id });
  const ownerCtx = service.resolveAuthContext({ userId: owner.id, spaceId: space.id });
  const category = service.createCategory(ownerCtx, { name: 'Geral', kind: 'expense' });

  const otherOwner = service.createUser({ email: 'outro@moneyflow.dev', name: 'Outro' });
  const otherSpace = service.createSpace({ name: 'Outro Espaço', ownerUserId: otherOwner.id });
  const otherCtx = service.resolveAuthContext({ userId: otherOwner.id, spaceId: otherSpace.id });

  return { service, space, ownerCtx, category, otherSpace, otherCtx };
}

test('RED -> GREEN: current_balance reflete opening_balance + receitas - despesas', () => {
  const { service, ownerCtx, category } = setupEnv();
  const conta = service.createAccount(ownerCtx, { name: 'Conta', openingBalance: 100000 });

  service.createTransaction(ownerCtx, { type: 'income', description: 'Salário', amount: 50000, accountId: conta.id, categoryId: category.id, transactionDate: '2026-09-01' });
  service.createTransaction(ownerCtx, { type: 'expense', description: 'Mercado', amount: 20000, accountId: conta.id, categoryId: category.id, transactionDate: '2026-09-05' });

  const updated = service.getAccount(ownerCtx, conta.id);
  assert.equal(updated.current_balance, 100000 + 50000 - 20000);
});

test('RED -> GREEN: transferência atualiza current_balance das duas contas corretamente', () => {
  const { service, ownerCtx } = setupEnv();
  const contaA = service.createAccount(ownerCtx, { name: 'Conta A', openingBalance: 10000 });
  const contaB = service.createAccount(ownerCtx, { name: 'Conta B', openingBalance: 0 });

  service.createTransfer(ownerCtx, { sourceAccountId: contaA.id, destinationAccountId: contaB.id, amount: 3000, transferDate: '2026-09-25' });

  assert.equal(service.getAccount(ownerCtx, contaA.id).current_balance, 7000);
  assert.equal(service.getAccount(ownerCtx, contaB.id).current_balance, 3000);
});

test('RED -> GREEN: compra no cartão (competência) NÃO altera current_balance de nenhuma conta', () => {
  const { service, ownerCtx, category } = setupEnv();
  const conta = service.createAccount(ownerCtx, { name: 'Conta Pagamento', openingBalance: 50000 });
  const cartao = service.createCreditCard(ownerCtx, { name: 'Cartão', closingDay: 10, dueDay: 20, paymentAccountId: conta.id });

  service.createCardTransaction(ownerCtx, {
    type: 'card_purchase',
    creditCardId: cartao.id,
    amount: 12000,
    description: 'Compra',
    categoryId: category.id,
    transactionDate: '2026-09-05',
  });

  // Competência (fatura) não é caixa: saldo da conta de pagamento continua intacto.
  assert.equal(service.getAccount(ownerCtx, conta.id).current_balance, 50000);
});

test('RED -> GREEN: pagamento de fatura debita a conta pagadora; desfazer o pagamento restaura o saldo', () => {
  const { service, ownerCtx, category } = setupEnv();
  const conta = service.createAccount(ownerCtx, { name: 'Conta Pagamento', openingBalance: 50000 });
  const cartao = service.createCreditCard(ownerCtx, { name: 'Cartão', closingDay: 10, dueDay: 20, paymentAccountId: conta.id });

  const purchase = service.createCardTransaction(ownerCtx, {
    type: 'card_purchase',
    creditCardId: cartao.id,
    amount: 12000,
    description: 'Compra',
    categoryId: category.id,
    transactionDate: '2026-09-05',
  });

  const paymentResult = service.registerInvoicePayment(ownerCtx, {
    invoiceId: purchase.credit_card_invoice_id,
    amount: 12000,
    paymentDate: '2026-09-15',
    accountId: conta.id,
  });

  assert.equal(service.getAccount(ownerCtx, conta.id).current_balance, 50000 - 12000);

  service.uninformInvoicePayment(ownerCtx, { paymentId: paymentResult.paymentId });

  assert.equal(service.getAccount(ownerCtx, conta.id).current_balance, 50000);
});

test('RED -> GREEN: pagamento duplicado (mesma idempotencyKey) não debita a conta duas vezes', () => {
  const { service, ownerCtx, category } = setupEnv();
  const conta = service.createAccount(ownerCtx, { name: 'Conta Pagamento', openingBalance: 50000 });
  const cartao = service.createCreditCard(ownerCtx, { name: 'Cartão', closingDay: 10, dueDay: 20, paymentAccountId: conta.id });
  const purchase = service.createCardTransaction(ownerCtx, {
    type: 'card_purchase',
    creditCardId: cartao.id,
    amount: 10000,
    description: 'Compra',
    categoryId: category.id,
    transactionDate: '2026-09-05',
  });

  const key = 'pagamento-unico';
  service.registerInvoicePayment(ownerCtx, { invoiceId: purchase.credit_card_invoice_id, amount: 10000, paymentDate: '2026-09-15', accountId: conta.id, idempotencyKey: key });
  service.registerInvoicePayment(ownerCtx, { invoiceId: purchase.credit_card_invoice_id, amount: 10000, paymentDate: '2026-09-15', accountId: conta.id, idempotencyKey: key });

  assert.equal(service.getAccount(ownerCtx, conta.id).current_balance, 50000 - 10000);
});

test('RED -> GREEN: devolução em dinheiro (item refund com conta) aumenta current_balance', () => {
  const { service, ownerCtx, category } = setupEnv();
  const conta = service.createAccount(ownerCtx, { name: 'Conta', openingBalance: 10000 });
  const location = service.createPurchaseLocation(ownerCtx, { brandName: 'Mercado X' });
  const purchase = service.createPurchaseWithItems(ownerCtx, {
    accountId: conta.id,
    locationId: location.id,
    transactionDate: '2026-09-05',
    description: 'Compra mercado',
    items: [{ categoryId: category.id, description: 'Item', quantity: 1, unit: 'un', unitPrice: 5000 }],
  });

  const saldoAposCompra = service.getAccount(ownerCtx, conta.id).current_balance;
  assert.equal(saldoAposCompra, 10000 - 5000);

  service.createItemRefund(ownerCtx, {
    purchaseItemId: purchase.items[0].id,
    refundQuantity: 1,
    refundAmount: 5000,
    refundDate: '2026-09-10',
    accountId: conta.id,
  });

  assert.equal(service.getAccount(ownerCtx, conta.id).current_balance, saldoAposCompra + 5000);
});

test('RED -> GREEN: editar valor de uma transação recalcula current_balance; excluir também', () => {
  const { service, ownerCtx, category } = setupEnv();
  const conta = service.createAccount(ownerCtx, { name: 'Conta', openingBalance: 10000 });
  const tx = service.createTransaction(ownerCtx, { type: 'expense', description: 'Compra', amount: 3000, accountId: conta.id, categoryId: category.id, transactionDate: '2026-09-05' });

  assert.equal(service.getAccount(ownerCtx, conta.id).current_balance, 7000);

  service.updateTransaction(ownerCtx, tx.id, { amount: 5000 });
  assert.equal(service.getAccount(ownerCtx, conta.id).current_balance, 5000);

  service.deleteTransaction(ownerCtx, tx.id);
  assert.equal(service.getAccount(ownerCtx, conta.id).current_balance, 10000);
});

test('RED -> GREEN: importação recalcula current_balance sem contar compra no cartão (competência) como caixa', () => {
  const { service, ownerCtx } = setupEnv();
  const payload = {
    accounts: [{ id: 'account-1', name: 'Conta Importada', balance: 100000, source: 'manual' }],
    cards: [{ id: 'card-1', name: 'Cartão Importado', closingDay: 10, dueDay: 20, paymentAccountId: 'account-1' }],
    transactions: [
      { id: 'tx-income', type: 'income', description: 'Salário', amount: 200000, transactionDate: '2026-09-01', accountId: 'account-1', category: 'Renda' },
      { id: 'tx-expense', type: 'expense', description: 'Conta de luz', amount: 15000, transactionDate: '2026-09-03', accountId: 'account-1', category: 'Casa' },
      { id: 'tx-purchase', type: 'card_purchase', description: 'Compra', amount: 8000, transactionDate: '2026-09-05', creditCardId: 'card-1', category: 'Compras' },
    ],
    payments: [],
  };

  service.importLocalStorageExport(ownerCtx, { payload });

  const account = service.db.prepare('SELECT * FROM accounts WHERE space_id = ? AND name = ?').get(ownerCtx.spaceId, 'Conta Importada');
  // opening_balance (100000) + income (200000) - expense (15000); a compra no cartão NÃO entra aqui.
  assert.equal(account.current_balance, 100000 + 200000 - 15000);
});

test('RED -> GREEN: recálculo de saldo nunca cruza espaços', () => {
  const { service, ownerCtx, otherCtx } = setupEnv();
  const contaOutroEspaco = service.createAccount(otherCtx, { name: 'Conta de Outro Espaço', openingBalance: 99999 });

  const catOutro = service.createCategory(otherCtx, { name: 'Outra Categoria', kind: 'expense' });
  service.createTransaction(otherCtx, { type: 'expense', description: 'Gasto', amount: 1000, accountId: contaOutroEspaco.id, categoryId: catOutro.id, transactionDate: '2026-09-05' });

  // Nada no espaço do owner foi tocado; a conta do outro espaço reflete só o seu próprio histórico.
  assert.equal(service.getAccount(otherCtx, contaOutroEspaco.id).current_balance, 99999 - 1000);
  assert.equal(service.listAccounts(ownerCtx).length, 0);
});
