/**
 * Migration 001 - Fundação de Espaços, Membros, Sessões, Auditoria e Estratégia de Isolamento Multi-espaço.
 *
 * Princípios aplicados (ECO-61):
 * 1. Isolamento Multi-espaço: Todas as tabelas têm `space_id` com FOREIGN KEY ON DELETE CASCADE e índice composto.
 * 2. Suporte aos 4 papéis: owner, admin, editor, viewer.
 * 3. Matriz com restrição CHECK para papéis e estados.
 * 4. Trilha de auditoria append-only para todas as operações críticas.
 * 5. Reversível de forma explícita (up / down). Nenhuma migração de dados automática.
 */

export const up = `
-- Habilitar integridade referencial estrita
PRAGMA foreign_keys = ON;

-- 1. Usuários
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);

-- 2. Sessões de autenticação
CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT UNIQUE NOT NULL,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  revoked_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_sessions_token_hash ON sessions(token_hash);
CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON sessions(user_id);

-- 3. Espaços de Trabalho (Spaces)
CREATE TABLE IF NOT EXISTS spaces (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  owner_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  currency TEXT NOT NULL DEFAULT 'BRL',
  timezone TEXT NOT NULL DEFAULT 'America/Sao_Paulo',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  archived_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_spaces_owner ON spaces(owner_user_id);

-- 4. Membros do Espaço (Space Members com matriz de papéis)
CREATE TABLE IF NOT EXISTS space_members (
  id TEXT PRIMARY KEY,
  space_id TEXT NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('owner', 'admin', 'editor', 'viewer')),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended', 'revoked')),
  invited_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(space_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_space_members_lookup ON space_members(space_id, user_id, status);
CREATE INDEX IF NOT EXISTS idx_space_members_user ON space_members(user_id);

-- 5. Registro de Auditoria Append-Only
CREATE TABLE IF NOT EXISTS audit_logs (
  id TEXT PRIMARY KEY,
  space_id TEXT NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
  actor_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  action TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT,
  old_data TEXT, -- JSON estruturado do estado anterior
  new_data TEXT, -- JSON estruturado do novo estado
  ip_address TEXT,
  user_agent TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_audit_logs_space ON audit_logs(space_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_logs_actor ON audit_logs(actor_user_id);

-- =========================================================================
-- ESTRATÉGIA FUNDACIONAL PARA TODAS AS ENTIDADES FINANCEIRAS FUTURAS:
-- space_id NOT NULL com FK ON DELETE CASCADE e índice composto (space_id, id).
-- =========================================================================

-- 6. Contas Bancárias
CREATE TABLE IF NOT EXISTS accounts (
  id TEXT PRIMARY KEY,
  space_id TEXT NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  account_type TEXT NOT NULL DEFAULT 'checking',
  currency TEXT NOT NULL DEFAULT 'BRL',
  opening_balance INTEGER NOT NULL DEFAULT 0, -- centavos
  current_balance INTEGER NOT NULL DEFAULT 0, -- centavos
  source TEXT NOT NULL DEFAULT 'manual' CHECK (source IN ('manual', 'open_finance')),
  institution_id TEXT,
  archived_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_accounts_space ON accounts(space_id, id);
CREATE INDEX IF NOT EXISTS idx_accounts_space_archived ON accounts(space_id, archived_at);

-- 7. Cartões de Crédito
CREATE TABLE IF NOT EXISTS credit_cards (
  id TEXT PRIMARY KEY,
  space_id TEXT NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  brand TEXT,
  closing_day INTEGER NOT NULL CHECK (closing_day >= 1 AND closing_day <= 31),
  due_day INTEGER NOT NULL CHECK (due_day >= 1 AND due_day <= 31),
  credit_limit INTEGER, -- centavos
  payment_account_id TEXT REFERENCES accounts(id) ON DELETE SET NULL,
  source TEXT NOT NULL DEFAULT 'manual' CHECK (source IN ('manual', 'open_finance')),
  archived_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_credit_cards_space ON credit_cards(space_id, id);

-- 8. Faturas de Cartão
CREATE TABLE IF NOT EXISTS credit_card_invoices (
  id TEXT PRIMARY KEY,
  space_id TEXT NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
  credit_card_id TEXT NOT NULL REFERENCES credit_cards(id) ON DELETE CASCADE,
  cycle_start TEXT NOT NULL,
  cycle_end TEXT NOT NULL,
  closing_date TEXT NOT NULL,
  due_date TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed', 'partially_paid', 'paid', 'reopened')),
  total_charges INTEGER NOT NULL DEFAULT 0,
  total_credits INTEGER NOT NULL DEFAULT 0,
  total_paid INTEGER NOT NULL DEFAULT 0,
  open_amount INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_invoices_space ON credit_card_invoices(space_id, id);
CREATE INDEX IF NOT EXISTS idx_invoices_card_cycle ON credit_card_invoices(space_id, credit_card_id, cycle_start);

-- 9. Categorias
CREATE TABLE IF NOT EXISTS categories (
  id TEXT PRIMARY KEY,
  space_id TEXT NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('expense', 'income')),
  parent_id TEXT REFERENCES categories(id) ON DELETE RESTRICT,
  color TEXT,
  is_system INTEGER NOT NULL DEFAULT 0,
  archived_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_categories_space ON categories(space_id, id);
CREATE INDEX IF NOT EXISTS idx_categories_parent ON categories(space_id, parent_id);

-- 10. Transações Financeiras
CREATE TABLE IF NOT EXISTS transactions (
  id TEXT PRIMARY KEY,
  space_id TEXT NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (type IN ('income', 'expense', 'transfer', 'card_purchase', 'card_payment', 'refund')),
  description TEXT NOT NULL,
  amount INTEGER NOT NULL CHECK (amount >= 0), -- centavos, sempre positivo com sentido em type
  currency TEXT NOT NULL DEFAULT 'BRL',
  account_id TEXT REFERENCES accounts(id) ON DELETE RESTRICT,
  credit_card_id TEXT REFERENCES credit_cards(id) ON DELETE RESTRICT,
  credit_card_invoice_id TEXT REFERENCES credit_card_invoices(id) ON DELETE SET NULL,
  category_id TEXT REFERENCES categories(id) ON DELETE SET NULL,
  observation TEXT,
  tags TEXT, -- JSON array de tags
  transaction_date TEXT NOT NULL,
  due_date TEXT,
  effective_date TEXT,
  paid_status TEXT NOT NULL DEFAULT 'unpaid' CHECK (paid_status IN ('paid', 'unpaid', 'confirmed')),
  source TEXT NOT NULL DEFAULT 'manual' CHECK (source IN ('manual', 'open_finance', 'import', 'system')),
  external_id TEXT,
  recurrence_id TEXT,
  installment_plan_id TEXT,
  installment_number INTEGER,
  total_installments INTEGER,
  destination_account_id TEXT REFERENCES accounts(id) ON DELETE RESTRICT, -- para transferências entre contas
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  deleted_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_transactions_space ON transactions(space_id, id);
CREATE INDEX IF NOT EXISTS idx_transactions_space_date ON transactions(space_id, transaction_date);
CREATE INDEX IF NOT EXISTS idx_transactions_space_account ON transactions(space_id, account_id);
CREATE INDEX IF NOT EXISTS idx_transactions_space_card ON transactions(space_id, credit_card_id);
CREATE INDEX IF NOT EXISTS idx_transactions_space_category ON transactions(space_id, category_id);

-- 11. Orçamentos (Budgets)
CREATE TABLE IF NOT EXISTS budgets (
  id TEXT PRIMARY KEY,
  space_id TEXT NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
  category_id TEXT NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
  period_year INTEGER NOT NULL,
  period_month INTEGER NOT NULL,
  amount INTEGER NOT NULL CHECK (amount >= 0), -- centavos
  activity_type TEXT NOT NULL DEFAULT 'spending' CHECK (activity_type IN ('spending', 'earning')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(space_id, category_id, period_year, period_month)
);

CREATE INDEX IF NOT EXISTS idx_budgets_space ON budgets(space_id, period_year, period_month);
`;

export const down = `
DROP TABLE IF EXISTS budgets;
DROP TABLE IF EXISTS transactions;
DROP TABLE IF EXISTS categories;
DROP TABLE IF EXISTS credit_card_invoices;
DROP TABLE IF EXISTS credit_cards;
DROP TABLE IF EXISTS accounts;
DROP TABLE IF EXISTS audit_logs;
DROP TABLE IF EXISTS space_members;
DROP TABLE IF EXISTS spaces;
DROP TABLE IF EXISTS sessions;
DROP TABLE IF EXISTS users;
`;
