/**
 * Migration 003 - Fase 2 (ECO-62): Persistência do Núcleo Financeiro.
 *
 * Adiciona as tabelas necessárias para completar o núcleo financeiro sobre a
 * fundação da Fase 1 (contas, cartões, categorias e transações já existiam
 * desde a migration 001): tags, transferências pareadas, pagamentos de fatura,
 * parcelamentos, recorrências/previsões e importação idempotente do slice
 * local (MVP em localStorage).
 *
 * Princípios aplicados (ECO-62):
 * 1. Isolamento Multi-espaço estrito: space_id com FK ON DELETE CASCADE e índices.
 * 2. Nenhuma coluna nova em `transactions` é necessária: `recurrence_id`,
 *    `installment_plan_id`, `installment_number` e `total_installments` já
 *    existem desde a migration 001 e passam a ser preenchidos por esta fase.
 * 3. Idempotência de pagamento de fatura via índice único (space_id, idempotency_key).
 * 4. Importação idempotente via índice único (space_id, checksum) e rastreamento
 *    reversível de entidades criadas (import_entities) sem apagar o payload original.
 * 5. Reversível explicitamente (up / down).
 */

export const up = `
-- 1. Tags nomeadas por espaço
CREATE TABLE IF NOT EXISTS tags (
  id TEXT PRIMARY KEY,
  space_id TEXT NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  color TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(space_id, name)
);

CREATE INDEX IF NOT EXISTS idx_tags_space ON tags(space_id, id);

-- 2. Associação Transação <-> Tags
CREATE TABLE IF NOT EXISTS transaction_tags (
  space_id TEXT NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
  transaction_id TEXT NOT NULL REFERENCES transactions(id) ON DELETE CASCADE,
  tag_id TEXT NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (transaction_id, tag_id)
);

CREATE INDEX IF NOT EXISTS idx_transaction_tags_space ON transaction_tags(space_id, tag_id);

-- 3. Transferências pareadas entre contas (nunca contabilizadas como receita/despesa)
CREATE TABLE IF NOT EXISTS transfers (
  id TEXT PRIMARY KEY,
  space_id TEXT NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
  source_account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE RESTRICT,
  destination_account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE RESTRICT,
  source_transaction_id TEXT NOT NULL UNIQUE REFERENCES transactions(id) ON DELETE CASCADE,
  destination_transaction_id TEXT NOT NULL UNIQUE REFERENCES transactions(id) ON DELETE CASCADE,
  amount INTEGER NOT NULL CHECK (amount > 0),
  currency TEXT NOT NULL DEFAULT 'BRL',
  transfer_date TEXT NOT NULL,
  description TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_transfers_space ON transfers(space_id, id);

-- 4. Pagamentos de Fatura (parcial, integral, excedente) com idempotência
CREATE TABLE IF NOT EXISTS invoice_payments (
  id TEXT PRIMARY KEY,
  space_id TEXT NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
  credit_card_invoice_id TEXT NOT NULL REFERENCES credit_card_invoices(id) ON DELETE CASCADE,
  transaction_id TEXT REFERENCES transactions(id) ON DELETE SET NULL,
  amount INTEGER NOT NULL CHECK (amount > 0),
  payment_date TEXT NOT NULL,
  idempotency_key TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  reversed_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_invoice_payments_invoice ON invoice_payments(space_id, credit_card_invoice_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_invoice_payments_idem ON invoice_payments(space_id, idempotency_key) WHERE idempotency_key IS NOT NULL;

-- 5. Planos de Parcelamento (soma exata em centavos: resto distribuído nas primeiras parcelas)
CREATE TABLE IF NOT EXISTS installment_plans (
  id TEXT PRIMARY KEY,
  space_id TEXT NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
  description TEXT NOT NULL,
  total_amount INTEGER NOT NULL CHECK (total_amount > 0),
  installments_count INTEGER NOT NULL CHECK (installments_count >= 2),
  account_id TEXT REFERENCES accounts(id) ON DELETE RESTRICT,
  credit_card_id TEXT REFERENCES credit_cards(id) ON DELETE RESTRICT,
  category_id TEXT REFERENCES categories(id) ON DELETE SET NULL,
  first_due_date TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_installment_plans_space ON installment_plans(space_id, id);

-- 6. Recorrências (modelos de lançamentos futuros)
CREATE TABLE IF NOT EXISTS recurrences (
  id TEXT PRIMARY KEY,
  space_id TEXT NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
  description TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('income', 'expense')),
  amount INTEGER NOT NULL CHECK (amount > 0),
  account_id TEXT REFERENCES accounts(id) ON DELETE RESTRICT,
  credit_card_id TEXT REFERENCES credit_cards(id) ON DELETE RESTRICT,
  category_id TEXT REFERENCES categories(id) ON DELETE SET NULL,
  frequency TEXT NOT NULL DEFAULT 'monthly' CHECK (frequency IN ('monthly', 'weekly', 'yearly')),
  day_of_month INTEGER CHECK (day_of_month BETWEEN 1 AND 31),
  start_date TEXT NOT NULL,
  end_date TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'paused', 'finished')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_recurrences_space ON recurrences(space_id, id);

-- 7. Ocorrências / Previsões geradas a partir de uma recorrência
CREATE TABLE IF NOT EXISTS recurrence_occurrences (
  id TEXT PRIMARY KEY,
  space_id TEXT NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
  recurrence_id TEXT NOT NULL REFERENCES recurrences(id) ON DELETE CASCADE,
  occurrence_date TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'forecast' CHECK (status IN ('forecast', 'promoted', 'skipped')),
  transaction_id TEXT REFERENCES transactions(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(recurrence_id, occurrence_date)
);

CREATE INDEX IF NOT EXISTS idx_recurrence_occ_space ON recurrence_occurrences(space_id, recurrence_id, occurrence_date);

-- 8. Lotes de Importação do slice local (MVP em localStorage) - idempotentes por checksum
CREATE TABLE IF NOT EXISTS import_batches (
  id TEXT PRIMARY KEY,
  space_id TEXT NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
  source TEXT NOT NULL DEFAULT 'localstorage_mvp',
  checksum TEXT NOT NULL,
  raw_payload TEXT NOT NULL, -- preserva o export original completo, nunca mutado
  status TEXT NOT NULL DEFAULT 'completed' CHECK (status IN ('completed', 'reversed')),
  imported_accounts INTEGER NOT NULL DEFAULT 0,
  imported_categories INTEGER NOT NULL DEFAULT 0,
  imported_transactions INTEGER NOT NULL DEFAULT 0,
  skipped_count INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  reversed_at TEXT,
  UNIQUE(space_id, checksum)
);

CREATE INDEX IF NOT EXISTS idx_import_batches_space ON import_batches(space_id, id);

-- 9. Entidades criadas por um lote de importação (permite reversão sem apagar histórico de outros dados)
CREATE TABLE IF NOT EXISTS import_entities (
  id TEXT PRIMARY KEY,
  space_id TEXT NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
  batch_id TEXT NOT NULL REFERENCES import_batches(id) ON DELETE CASCADE,
  entity_type TEXT NOT NULL CHECK (entity_type IN ('accounts', 'categories', 'transactions')),
  entity_id TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_import_entities_batch ON import_entities(space_id, batch_id);
`;

export const down = `
DROP TABLE IF EXISTS import_entities;
DROP TABLE IF EXISTS import_batches;
DROP TABLE IF EXISTS recurrence_occurrences;
DROP TABLE IF EXISTS recurrences;
DROP TABLE IF EXISTS installment_plans;
DROP TABLE IF EXISTS invoice_payments;
DROP TABLE IF EXISTS transfers;
DROP TABLE IF EXISTS transaction_tags;
DROP TABLE IF EXISTS tags;
`;
