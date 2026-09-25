import test from 'node:test';
import assert from 'node:assert/strict';

import { createDatabase, runMigrations } from '../../src/db/index.js';
import { SpaceIsolationService } from '../../src/services/spaceIsolationService.js';
import { Roles } from '../../src/domain/authorization.js';

/**
 * Fixture que reproduz EXATAMENTE o formato gravado por
 * `localStorage.setItem('moneyflow-state-v1', JSON.stringify(state))` no slice
 * local do MVP (worktree `local-20260925-iniciar-o-moneyflow-como-aplicat`,
 * `src/main.js` + `src/domain/finance.js`):
 *
 * - Chaves de topo: accounts, cards, transactions, payments (NUNCA "categories":
 *   categoria é texto livre em `transaction.category`, não uma lista separada).
 * - `id` de cada entidade É a identidade local (ex: "account-<uuid>",
 *   "card-<uuid>"), reaproveitado diretamente como FK em outras entidades
 *   (`transaction.accountId`, `transaction.creditCardId`) — não existe um campo
 *   `localId` separado.
 * - `payments[]` é uma lista à parte de `transactions[]`; cada pagamento também
 *   gera, na UI, uma transação espelho `type: 'card_payment'` (ver
 *   app.addEventListener('submit', ...) em src/main.js) — o mesmo evento de caixa
 *   contado duas vezes se importado ingenuamente.
 * - `payment.invoiceId` segue o formato `${card.id}-${closingDateISO}` (ver
 *   `getInvoiceForPurchase` em src/domain/finance.js), sem `creditCardId` próprio.
 */
function realMvpExportFixture() {
  return {
    accounts: [
      { id: 'account-demo', name: 'Conta principal', institution: 'Nubank', type: 'Conta corrente', balance: 845000, source: 'manual' },
    ],
    cards: [
      { id: 'card-demo', name: 'Cartão do dia a dia', brand: 'Mastercard', closingDay: 10, dueDay: 18, creditLimit: 350000, paymentAccountId: 'account-demo', source: 'manual' },
    ],
    transactions: [
      { id: 'demo-purchase-1', type: 'card_purchase', description: 'Mercado Municipal', amount: 12680, transactionDate: '2026-09-05', creditCardId: 'card-demo', category: 'Alimentação' },
      { id: 'demo-purchase-2', type: 'card_purchase', description: 'Café do bairro', amount: 1850, transactionDate: '2026-09-06', creditCardId: 'card-demo', category: 'Alimentação' },
      { id: 'demo-expense-1', type: 'expense', description: 'Aluguel', amount: 210000, transactionDate: '2026-09-05', accountId: 'account-demo', category: 'Moradia' },
      { id: 'demo-income-1', type: 'income', description: 'Salário', amount: 500000, transactionDate: '2026-09-01', accountId: 'account-demo', category: 'Renda' },
      // Espelho de UI de um pagamento de fatura: mesma grana do payments[] abaixo.
      { id: 'demo-card-payment-1', type: 'card_payment', description: 'Pagamento fatura Cartão do dia a dia', amount: 14530, transactionDate: '2026-09-15', accountId: 'account-demo', invoiceId: 'card-demo-2026-09-10', category: 'Pagamento de fatura', source: 'manual' },
    ],
    payments: [
      // `externalTransactionId` é omitido de propósito: `JSON.stringify` (tanto o do
      // MVP ao gravar no localStorage quanto o do checksum aqui) já descarta chaves
      // com valor `undefined`, então o payload real nunca carrega essa chave vazia.
      { id: 'demo-payment-1', invoiceId: 'card-demo-2026-09-10', fromAccountId: 'account-demo', amount: 14530, paymentDate: '2026-09-15', source: 'manual', status: 'confirmed' },
    ],
  };
}

function setupEnv() {
  const db = createDatabase(':memory:');
  runMigrations(db);
  const service = new SpaceIsolationService(db);

  const owner = service.createUser({ email: 'owner@moneyflow.dev', name: 'Owner' });
  const space = service.createSpace({ name: 'Espaço Migrado', ownerUserId: owner.id });
  const ownerCtx = service.resolveAuthContext({ userId: owner.id, spaceId: space.id });

  const otherOwner = service.createUser({ email: 'outro@moneyflow.dev', name: 'Outro' });
  const otherSpace = service.createSpace({ name: 'Outro Espaço', ownerUserId: otherOwner.id });
  const otherCtx = service.resolveAuthContext({ userId: otherOwner.id, spaceId: otherSpace.id });

  return { service, space, ownerCtx, otherSpace, otherCtx };
}

test('RED -> GREEN: importa o formato real do slice local (accounts/cards/transactions/payments, sem "categories")', () => {
  const { service, ownerCtx } = setupEnv();
  const payload = realMvpExportFixture();

  const result = service.importLocalStorageExport(ownerCtx, { payload });

  assert.equal(result.duplicate, false);
  assert.equal(result.importedAccounts, 1);
  assert.equal(result.importedCards, 1);
  // 4 transações "reais" (2 card_purchase + 1 expense + 1 income); o card_payment
  // espelhado na UI NÃO é importado como transação avulsa (é derivado de payments[]).
  assert.equal(result.importedTransactions, 4);
  assert.equal(result.importedPayments, 1);
  assert.equal(result.skipped, 0);

  const accounts = service.listAccounts(ownerCtx);
  assert.equal(accounts.length, 1);
  assert.equal(accounts[0].name, 'Conta principal');

  // Categorias foram derivadas do texto livre `category` das transações (3 nomes distintos).
  const categories = service.db.prepare('SELECT name FROM categories WHERE space_id = ?').all(ownerCtx.spaceId);
  assert.deepEqual(categories.map((c) => c.name).sort(), ['Alimentação', 'Moradia', 'Renda']);

  // O pagamento de fatura foi processado via registerInvoicePayment: existe fatura fechando a
  // conta certa, com total pago batendo com o valor do payments[].
  const invoices = service.db.prepare('SELECT * FROM credit_card_invoices WHERE space_id = ?').all(ownerCtx.spaceId);
  assert.equal(invoices.length, 1);
  assert.equal(invoices[0].total_paid, 14530);

  // Só UMA transação type=card_payment existe de fato (nunca duas para o mesmo evento de caixa).
  const cardPayments = service.db
    .prepare("SELECT * FROM transactions WHERE space_id = ? AND type = 'card_payment' AND deleted_at IS NULL")
    .all(ownerCtx.spaceId);
  assert.equal(cardPayments.length, 1);
});

test('RED -> GREEN: importação idempotente do formato real (checksum) não duplica linhas', () => {
  const { service, ownerCtx } = setupEnv();
  const payload = realMvpExportFixture();

  const first = service.importLocalStorageExport(ownerCtx, { payload });
  const second = service.importLocalStorageExport(ownerCtx, { payload });

  assert.equal(first.duplicate, false);
  assert.equal(second.duplicate, true);
  assert.equal(second.batchId, first.batchId);

  const accountCount = service.db.prepare('SELECT COUNT(*) as c FROM accounts WHERE space_id = ?').get(ownerCtx.spaceId).c;
  const cardCount = service.db.prepare('SELECT COUNT(*) as c FROM credit_cards WHERE space_id = ?').get(ownerCtx.spaceId).c;
  assert.equal(accountCount, 1);
  assert.equal(cardCount, 1);
});

test('RED -> GREEN: snapshot original do formato real é preservado integralmente', () => {
  const { service, ownerCtx } = setupEnv();
  const payload = realMvpExportFixture();

  const result = service.importLocalStorageExport(ownerCtx, { payload });
  const batch = service.getImportBatch(ownerCtx, result.batchId);
  assert.deepEqual(JSON.parse(batch.raw_payload), payload);
});

test('RED -> GREEN: reversão do formato real arquiva/soft-deleta contas, cartões, categorias e transações do lote', () => {
  const { service, ownerCtx } = setupEnv();
  const payload = realMvpExportFixture();

  const result = service.importLocalStorageExport(ownerCtx, { payload });
  const reversal = service.reverseImportBatch(ownerCtx, { batchId: result.batchId });

  assert.equal(reversal.reversed, true);
  assert.ok(reversal.entitiesCount > 0);

  const account = service.db.prepare('SELECT * FROM accounts WHERE space_id = ? AND name = ?').get(ownerCtx.spaceId, 'Conta principal');
  assert.ok(account.archived_at);

  const card = service.db.prepare('SELECT * FROM credit_cards WHERE space_id = ? AND name = ?').get(ownerCtx.spaceId, 'Cartão do dia a dia');
  assert.ok(card.archived_at);
});

test('RED -> GREEN: isolamento por space_id é preservado ao importar o formato real', () => {
  const { service, ownerCtx, otherCtx } = setupEnv();
  const payload = realMvpExportFixture();

  service.importLocalStorageExport(ownerCtx, { payload });

  const accountsInOtherSpace = service.listAccounts(otherCtx);
  const cardsInOtherSpace = service.db.prepare('SELECT COUNT(*) as c FROM credit_cards WHERE space_id = ?').get(otherCtx.spaceId).c;
  assert.equal(accountsInOtherSpace.length, 0);
  assert.equal(cardsInOtherSpace, 0);
});
