/** Metas financeiras e cofrinhos (ECO-66 S4.1). Dados existentes não são alterados. */

/**
 * up aceita db como argumento para executar o ALTER TABLE condicionalmente,
 * pois SQLite não suporta ADD COLUMN IF NOT EXISTS.
 * @param {import('node:sqlite').DatabaseSync} db
 */
export function up(db) {
  // Adiciona is_piggy_bank apenas se a coluna ainda não existir (idempotente)
  const cols = db.prepare('PRAGMA table_info(accounts)').all();
  const hasPiggy = cols.some((c) => c.name === 'is_piggy_bank');
  if (!hasPiggy) {
    db.exec(`ALTER TABLE accounts ADD COLUMN is_piggy_bank INTEGER NOT NULL DEFAULT 0 CHECK (is_piggy_bank IN (0, 1));`);
  }

  db.exec(`
  CREATE TABLE IF NOT EXISTS goals (
    id TEXT PRIMARY KEY,
    space_id TEXT NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    goal_type TEXT NOT NULL CHECK (goal_type IN ('savings', 'spending')),
    target_amount INTEGER NOT NULL CHECK (target_amount > 0),
    category_id TEXT REFERENCES categories(id) ON DELETE RESTRICT,
    start_date TEXT NOT NULL,
    deadline TEXT NOT NULL,
    recurrence_rule TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    deleted_at TEXT,
    CHECK ((goal_type = 'spending' AND category_id IS NOT NULL) OR goal_type = 'savings')
  );
  CREATE INDEX IF NOT EXISTS idx_goals_space_active ON goals(space_id, deleted_at, deadline);
  CREATE INDEX IF NOT EXISTS idx_goals_space_category ON goals(space_id, category_id);

  CREATE TABLE IF NOT EXISTS piggy_banks (
    id TEXT PRIMARY KEY,
    space_id TEXT NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
    goal_id TEXT NOT NULL UNIQUE REFERENCES goals(id) ON DELETE CASCADE,
    account_id TEXT NOT NULL UNIQUE REFERENCES accounts(id) ON DELETE RESTRICT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_piggy_banks_space_goal ON piggy_banks(space_id, goal_id);
  `);
}

export const down = `
  DROP TABLE IF EXISTS piggy_banks;
  DROP TABLE IF EXISTS goals;
  -- is_piggy_bank preservada (SQLite não suporta DROP COLUMN portável);
  -- re-aplicar é seguro via PRAGMA table_info check no up().
`;
