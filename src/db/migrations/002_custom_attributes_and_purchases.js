/**
 * Migration 002 - Extensão da Fase 1: Atributos Tipados Versionados,
 * Locais de Compra, Produtos Normalizados/Código de Barras, Compra-Pai com Itens-Filhos,
 * Devoluções/Estornos Vinculados e Histórico Auditável de Preços.
 *
 * Princípios aplicados (ECO-61 Extensão):
 * 1. Isolamento Multi-espaço estrito: space_id com FK ON DELETE CASCADE e índices em todas as tabelas.
 * 2. Atributos tipados por espaço/categoria (texto, número, moeda, data, booleano, seleção, código de barras),
 *    com suporte a valor único ou múltiplo, obrigatoriedade e versionamento (mudança de tipo cria versão,
 *    arquivamento impede novos usos).
 * 3. Purchase locations (rede/marca e filial opcional).
 * 4. Produtos identificados por código de barras (único por espaço) ou chave normalizada (nome + marca + unidade).
 * 5. Compra-pai com itens-filhos, quantidades decimais e unidades (un, kg, g, l, ml, m, cx, pacote).
 * 6. Devoluções/estornos vinculados ao item original preservando histórico (bruto, devolvido, líquido).
 * 7. Histórico de preços com desconto real pago, quantidade, unidade, moeda e auditoria.
 * 8. Reversível explicitamente (up / down).
 */

export const up = `
-- 1. Definições de Atributos Personalizados por Espaço
CREATE TABLE IF NOT EXISTS attribute_definitions (
  id TEXT PRIMARY KEY,
  space_id TEXT NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
  target_type TEXT NOT NULL CHECK (target_type IN ('transaction', 'recurrence', 'item')),
  category_id TEXT REFERENCES categories(id) ON DELETE SET NULL, -- Opcional: restrito a uma categoria
  name TEXT NOT NULL,
  slug TEXT NOT NULL,
  data_type TEXT NOT NULL CHECK (data_type IN ('text', 'number', 'currency', 'date', 'boolean', 'select', 'barcode')),
  is_multiple INTEGER NOT NULL DEFAULT 0, -- 0 = valor único, 1 = múltiplo
  is_required INTEGER NOT NULL DEFAULT 0, -- 0 = opcional, 1 = obrigatório
  allowed_options TEXT, -- JSON array de opções para data_type='select'
  version INTEGER NOT NULL DEFAULT 1,
  previous_version_id TEXT REFERENCES attribute_definitions(id) ON DELETE SET NULL,
  archived_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(space_id, slug, version)
);

CREATE INDEX IF NOT EXISTS idx_attr_def_space ON attribute_definitions(space_id, id);
CREATE INDEX IF NOT EXISTS idx_attr_def_target ON attribute_definitions(space_id, target_type, category_id);

-- 2. Valores de Atributos Persistidos (Lançamentos, Recorrências, Itens)
CREATE TABLE IF NOT EXISTS attribute_values (
  id TEXT PRIMARY KEY,
  space_id TEXT NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
  attribute_definition_id TEXT NOT NULL REFERENCES attribute_definitions(id) ON DELETE RESTRICT,
  entity_type TEXT NOT NULL CHECK (entity_type IN ('transaction', 'recurrence', 'item', 'recurrence_instance')),
  entity_id TEXT NOT NULL,
  value_text TEXT,
  value_number REAL,
  value_integer INTEGER, -- Para moedas em centavos ou inteiros
  value_boolean INTEGER,
  value_date TEXT,
  value_json TEXT, -- Para listas em atributos de seleção múltipla ou tags
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_attr_val_space_entity ON attribute_values(space_id, entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_attr_val_def ON attribute_values(space_id, attribute_definition_id);

-- 3. Locais de Compra (Purchase Locations: Rede/Marca e Filial Opcional)
CREATE TABLE IF NOT EXISTS purchase_locations (
  id TEXT PRIMARY KEY,
  space_id TEXT NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
  brand_name TEXT NOT NULL, -- Ex: "Pão de Açúcar", "Posto Ipiranga", "Amazon"
  branch_name TEXT,        -- Ex: "Filial Moema", "Av. Paulista", "Online"
  address TEXT,
  city TEXT,
  state TEXT,
  postal_code TEXT,
  country TEXT NOT NULL DEFAULT 'BR',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  archived_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_purchase_locations_space ON purchase_locations(space_id, id);
CREATE INDEX IF NOT EXISTS idx_purchase_locations_brand ON purchase_locations(space_id, brand_name);

-- 4. Produtos de Catálogo (Identificados por Barcode ou Chave Normalizada)
CREATE TABLE IF NOT EXISTS products (
  id TEXT PRIMARY KEY,
  space_id TEXT NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
  barcode TEXT, -- Código de barras EAN/GTIN/UPC quando houver
  name TEXT NOT NULL,
  normalized_name TEXT NOT NULL, -- Minúsculo sem acento para busca/dedup
  brand TEXT,
  default_unit TEXT NOT NULL DEFAULT 'un' CHECK (default_unit IN ('un', 'kg', 'g', 'l', 'ml', 'm', 'cx', 'pacote')),
  default_category_id TEXT REFERENCES categories(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_products_barcode ON products(space_id, barcode) WHERE barcode IS NOT NULL AND barcode != '';
CREATE INDEX IF NOT EXISTS idx_products_normalized ON products(space_id, normalized_name, brand, default_unit);

-- 5. Compras-Pai (Parent Purchases)
CREATE TABLE IF NOT EXISTS purchases (
  id TEXT PRIMARY KEY,
  space_id TEXT NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
  transaction_id TEXT NOT NULL UNIQUE REFERENCES transactions(id) ON DELETE CASCADE,
  location_id TEXT REFERENCES purchase_locations(id) ON DELETE SET NULL,
  notes TEXT,
  subtotal_amount INTEGER NOT NULL DEFAULT 0, -- centavos brutos dos itens
  discount_amount INTEGER NOT NULL DEFAULT 0, -- desconto no total da compra
  addition_amount INTEGER NOT NULL DEFAULT 0, -- acréscimo / frete / taxa
  net_amount INTEGER NOT NULL DEFAULT 0,      -- subtotal - discount + addition (deve bater com transaction.amount)
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_purchases_space ON purchases(space_id, id);
CREATE INDEX IF NOT EXISTS idx_purchases_location ON purchases(space_id, location_id);

-- 6. Itens-Filhos da Compra (Purchase Items)
CREATE TABLE IF NOT EXISTS purchase_items (
  id TEXT PRIMARY KEY,
  space_id TEXT NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
  purchase_id TEXT NOT NULL REFERENCES purchases(id) ON DELETE CASCADE,
  product_id TEXT REFERENCES products(id) ON DELETE SET NULL,
  category_id TEXT REFERENCES categories(id) ON DELETE RESTRICT, -- Cada item tem sua própria categoria
  description TEXT NOT NULL,
  barcode TEXT,
  quantity REAL NOT NULL CHECK (quantity > 0), -- Quantidade decimal (ex: 1.542 kg)
  unit TEXT NOT NULL CHECK (unit IN ('un', 'kg', 'g', 'l', 'ml', 'm', 'cx', 'pacote')),
  unit_price INTEGER NOT NULL CHECK (unit_price >= 0), -- Centavos do preço unitário tabelado
  discount_amount INTEGER NOT NULL DEFAULT 0 CHECK (discount_amount >= 0), -- Desconto específico do item
  total_gross_amount INTEGER NOT NULL CHECK (total_gross_amount >= 0),     -- Preço bruto (arredondado em centavos)
  total_net_amount INTEGER NOT NULL CHECK (total_net_amount >= 0),         -- Preço líquido final do item
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_purchase_items_space ON purchase_items(space_id, id);
CREATE INDEX IF NOT EXISTS idx_purchase_items_purchase ON purchase_items(space_id, purchase_id);
CREATE INDEX IF NOT EXISTS idx_purchase_items_product ON purchase_items(space_id, product_id);
CREATE INDEX IF NOT EXISTS idx_purchase_items_category ON purchase_items(space_id, category_id);

-- 7. Devoluções e Estornos de Itens Vinculados (Refunds)
CREATE TABLE IF NOT EXISTS item_refunds (
  id TEXT PRIMARY KEY,
  space_id TEXT NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
  purchase_item_id TEXT NOT NULL REFERENCES purchase_items(id) ON DELETE CASCADE,
  refund_transaction_id TEXT REFERENCES transactions(id) ON DELETE SET NULL, -- Transação financeira de estorno
  refund_quantity REAL NOT NULL CHECK (refund_quantity > 0),
  refund_amount INTEGER NOT NULL CHECK (refund_amount > 0), -- Valor devolvido em centavos
  reason TEXT,
  refund_date TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_item_refunds_space ON item_refunds(space_id, id);
CREATE INDEX IF NOT EXISTS idx_item_refunds_item ON item_refunds(space_id, purchase_item_id);

-- 8. Histórico de Preços Efetivamente Pagos (Auditável e Rastreável por Local/Data)
CREATE TABLE IF NOT EXISTS price_history (
  id TEXT PRIMARY KEY,
  space_id TEXT NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
  product_id TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  purchase_item_id TEXT REFERENCES purchase_items(id) ON DELETE CASCADE,
  location_id TEXT REFERENCES purchase_locations(id) ON DELETE SET NULL,
  date TEXT NOT NULL,
  quantity REAL NOT NULL,
  unit TEXT NOT NULL,
  unit_price_effective INTEGER NOT NULL, -- Valor unitário líquido efetivamente pago (centavos)
  currency TEXT NOT NULL DEFAULT 'BRL',
  source TEXT NOT NULL DEFAULT 'purchase' CHECK (source IN ('purchase', 'manual', 'import')),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_price_history_product_date ON price_history(space_id, product_id, date DESC);
CREATE INDEX IF NOT EXISTS idx_price_history_location ON price_history(space_id, location_id);
`;

export const down = `
DROP TABLE IF EXISTS price_history;
DROP TABLE IF EXISTS item_refunds;
DROP TABLE IF EXISTS purchase_items;
DROP TABLE IF EXISTS purchases;
DROP TABLE IF EXISTS products;
DROP TABLE IF EXISTS purchase_locations;
DROP TABLE IF EXISTS attribute_values;
DROP TABLE IF EXISTS attribute_definitions;
`;
