/**
 * Migration 004 - Ajuste do contrato de importação para o formato REAL do slice
 * local (MVP em `localStorage`, chave `moneyflow-state-v1`).
 *
 * A Fase 2 original (ECO-62) havia definido um contrato de import hipotético
 * (`accounts/categories/transactions` com `localId`) sem checar o slice local de
 * verdade. Ao ler o worktree do MVP (`src/main.js` + `src/domain/finance.js`)
 * descobriu-se o formato real: `accounts/cards/transactions/payments`, sem lista
 * de categorias (categoria é texto livre por transação) e sem `localId` (o `id`
 * de cada entidade já É a identidade local). Esta migration ajusta apenas a
 * estrutura de suporte à importação — nenhuma tabela do núcleo financeiro muda.
 *
 * Mudanças:
 * 1. `import_batches` ganha `imported_cards` e `imported_payments` (contadores
 *    específicos, distintos de `imported_accounts/categories/transactions`).
 * 2. `import_entities.entity_type` passa a aceitar também `'credit_cards'`
 *    (cartões importados também precisam ser rastreáveis para reversão).
 *
 * Reversível: down remove as colunas novas e restaura o CHECK original de
 * `import_entities` (sem `credit_cards`), descartando entidades desse tipo.
 */

export const up = `
ALTER TABLE import_batches ADD COLUMN imported_cards INTEGER NOT NULL DEFAULT 0;
ALTER TABLE import_batches ADD COLUMN imported_payments INTEGER NOT NULL DEFAULT 0;

ALTER TABLE import_entities RENAME TO import_entities_004_old;

CREATE TABLE import_entities (
  id TEXT PRIMARY KEY,
  space_id TEXT NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
  batch_id TEXT NOT NULL REFERENCES import_batches(id) ON DELETE CASCADE,
  entity_type TEXT NOT NULL CHECK (entity_type IN ('accounts', 'categories', 'transactions', 'credit_cards')),
  entity_id TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

INSERT INTO import_entities (id, space_id, batch_id, entity_type, entity_id, created_at)
  SELECT id, space_id, batch_id, entity_type, entity_id, created_at FROM import_entities_004_old;

DROP TABLE import_entities_004_old;

CREATE INDEX IF NOT EXISTS idx_import_entities_batch ON import_entities(space_id, batch_id);
`;

export const down = `
ALTER TABLE import_batches DROP COLUMN imported_payments;
ALTER TABLE import_batches DROP COLUMN imported_cards;

ALTER TABLE import_entities RENAME TO import_entities_004_widened;

CREATE TABLE import_entities (
  id TEXT PRIMARY KEY,
  space_id TEXT NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
  batch_id TEXT NOT NULL REFERENCES import_batches(id) ON DELETE CASCADE,
  entity_type TEXT NOT NULL CHECK (entity_type IN ('accounts', 'categories', 'transactions')),
  entity_id TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

INSERT INTO import_entities (id, space_id, batch_id, entity_type, entity_id, created_at)
  SELECT id, space_id, batch_id, entity_type, entity_id, created_at
  FROM import_entities_004_widened
  WHERE entity_type != 'credit_cards';

DROP TABLE import_entities_004_widened;

CREATE INDEX IF NOT EXISTS idx_import_entities_batch ON import_entities(space_id, batch_id);
`;
