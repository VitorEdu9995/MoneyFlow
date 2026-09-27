/**
 * Migration 010 — Catálogo global de instituições bancárias, marcas de cartões e assets de logos (ADR-0002).
 */

export function up(db) {
  db.exec(`
  -- 1. Instituições globais (compartilhadas entre espaços)
  CREATE TABLE IF NOT EXISTS institutions (
    id TEXT PRIMARY KEY,
    popular_name TEXT NOT NULL,
    legal_name TEXT,
    bank_code TEXT,
    ispb TEXT,
    kind TEXT NOT NULL DEFAULT 'bank',
    active INTEGER NOT NULL DEFAULT 1,
    source_key TEXT UNIQUE,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    deactivated_at TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_institutions_popular_name ON institutions(popular_name);
  CREATE INDEX IF NOT EXISTS idx_institutions_bank_code ON institutions(bank_code) WHERE bank_code IS NOT NULL;
  CREATE INDEX IF NOT EXISTS idx_institutions_ispb ON institutions(ispb) WHERE ispb IS NOT NULL;

  -- 2. Aliases para busca resiliente
  CREATE TABLE IF NOT EXISTS institution_aliases (
    id TEXT PRIMARY KEY,
    institution_id TEXT NOT NULL REFERENCES institutions(id) ON DELETE CASCADE,
    normalized_alias TEXT NOT NULL,
    display_alias TEXT NOT NULL,
    source TEXT NOT NULL DEFAULT 'catalog',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(institution_id, normalized_alias)
  );
  CREATE INDEX IF NOT EXISTS idx_institution_aliases_norm ON institution_aliases(normalized_alias);

  -- 3. Assets de logos (imutáveis e protegidos contra indisponibilidade externa)
  CREATE TABLE IF NOT EXISTS logo_assets (
    id TEXT PRIMARY KEY,
    storage_key TEXT UNIQUE NOT NULL,
    sha256 TEXT UNIQUE,
    mime_type TEXT NOT NULL,
    format TEXT NOT NULL,
    byte_size INTEGER,
    source_url TEXT,
    fetched_at TEXT,
    validation_status TEXT NOT NULL DEFAULT 'pending',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  -- 4. Associação de logos a instituições
  CREATE TABLE IF NOT EXISTS institution_logos (
    id TEXT PRIMARY KEY,
    institution_id TEXT NOT NULL REFERENCES institutions(id) ON DELETE CASCADE,
    logo_asset_id TEXT NOT NULL REFERENCES logo_assets(id) ON DELETE RESTRICT,
    source_url TEXT,
    is_primary INTEGER NOT NULL DEFAULT 1,
    imported_at TEXT NOT NULL DEFAULT (datetime('now')),
    retired_at TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_inst_logos_inst ON institution_logos(institution_id);

  -- 5. Bandeiras de cartão
  CREATE TABLE IF NOT EXISTS card_brands (
    id TEXT PRIMARY KEY,
    display_name TEXT NOT NULL,
    normalized_name TEXT UNIQUE NOT NULL,
    logo_asset_id TEXT REFERENCES logo_assets(id) ON DELETE SET NULL,
    active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  -- 6. Histórico auditável de importações do catálogo
  CREATE TABLE IF NOT EXISTS catalog_imports (
    id TEXT PRIMARY KEY,
    source_name TEXT NOT NULL,
    source_sha256 TEXT UNIQUE,
    source_url TEXT,
    imported_at TEXT NOT NULL DEFAULT (datetime('now')),
    status TEXT NOT NULL DEFAULT 'completed',
    row_count INTEGER NOT NULL DEFAULT 0,
    inserted_count INTEGER NOT NULL DEFAULT 0,
    updated_count INTEGER NOT NULL DEFAULT 0,
    skipped_count INTEGER NOT NULL DEFAULT 0,
    error_summary TEXT
  );

  CREATE TABLE IF NOT EXISTS catalog_import_rows (
    import_id TEXT NOT NULL REFERENCES catalog_imports(id) ON DELETE CASCADE,
    row_number INTEGER NOT NULL,
    source_key TEXT NOT NULL,
    row_sha256 TEXT,
    institution_id TEXT REFERENCES institutions(id) ON DELETE SET NULL,
    logo_asset_id TEXT REFERENCES logo_assets(id) ON DELETE SET NULL,
    outcome TEXT NOT NULL,
    PRIMARY KEY(import_id, row_number)
  );

  -- 7. Preferências de instituições escopadas por espaço (favoritos e contagem de uso)
  CREATE TABLE IF NOT EXISTS institution_preferences (
    space_id TEXT NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
    institution_id TEXT NOT NULL REFERENCES institutions(id) ON DELETE CASCADE,
    favorite INTEGER NOT NULL DEFAULT 0,
    selection_count INTEGER NOT NULL DEFAULT 0,
    last_selected_at TEXT,
    PRIMARY KEY(space_id, institution_id)
  );
  `);

  // 8. Colunas adicionais em accounts e credit_cards
  const accountCols = db.prepare('PRAGMA table_info(accounts)').all();
  if (!accountCols.some((c) => c.name === 'custom_logo_asset_id')) {
    db.exec('ALTER TABLE accounts ADD COLUMN custom_logo_asset_id TEXT REFERENCES logo_assets(id) ON DELETE SET NULL;');
  }
  if (!accountCols.some((c) => c.name === 'use_institution_logo')) {
    db.exec('ALTER TABLE accounts ADD COLUMN use_institution_logo INTEGER DEFAULT 1;');
  }

  const cardCols = db.prepare('PRAGMA table_info(credit_cards)').all();
  if (!cardCols.some((c) => c.name === 'institution_id')) {
    db.exec('ALTER TABLE credit_cards ADD COLUMN institution_id TEXT REFERENCES institutions(id) ON DELETE SET NULL;');
  }
  if (!cardCols.some((c) => c.name === 'card_brand_id')) {
    db.exec('ALTER TABLE credit_cards ADD COLUMN card_brand_id TEXT REFERENCES card_brands(id) ON DELETE SET NULL;');
  }
  if (!cardCols.some((c) => c.name === 'custom_logo_asset_id')) {
    db.exec('ALTER TABLE credit_cards ADD COLUMN custom_logo_asset_id TEXT REFERENCES logo_assets(id) ON DELETE SET NULL;');
  }
  if (!cardCols.some((c) => c.name === 'use_institution_logo')) {
    db.exec('ALTER TABLE credit_cards ADD COLUMN use_institution_logo INTEGER DEFAULT 1;');
  }
  if (!cardCols.some((c) => c.name === 'primary_color')) {
    db.exec('ALTER TABLE credit_cards ADD COLUMN primary_color TEXT;');
  }
}

export const down = `
  DROP TABLE IF EXISTS institution_preferences;
  DROP TABLE IF EXISTS catalog_import_rows;
  DROP TABLE IF EXISTS catalog_imports;
  DROP TABLE IF EXISTS card_brands;
  DROP TABLE IF EXISTS institution_logos;
  DROP TABLE IF EXISTS logo_assets;
  DROP TABLE IF EXISTS institution_aliases;
  DROP TABLE IF EXISTS institutions;
`;
