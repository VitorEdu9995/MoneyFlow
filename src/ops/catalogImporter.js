import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { normalizeTerm } from '../services/institutionCatalogService.js';

const DEFAULT_XLSX_PATH = path.join(process.cwd(), 'Documentação', 'Bancos e Logos', 'instituicoes_bancarias_com_logo.xlsx');
const DEFAULT_JSON_PATH = path.join(process.cwd(), 'Documentação', 'Bancos e Logos', 'instituicoes_catalogo.json');

const KNOWN_SPECIAL_ALIASES = {
  'Nubank': ['nu pagamentos', 'nu', 'nubank', 'nu bank'],
  'PagBank': ['pagseguro', 'pagbank', 'pagseguro internet'],
  'Inter': ['banco inter', 'inter'],
  'Santander': ['bco santander', 'santander', 'banco santander'],
  'Bradesco': ['bco bradesco', 'bradesco', 'banco bradesco'],
  'Itaú': ['itau', 'itau unibanco', 'banco itau'],
  'Caixa': ['caixa economica', 'caixa economica federal', 'cef'],
  'C6 Bank': ['c6', 'c6 bank', 'banco c6'],
  'BTG Pactual': ['btg', 'btg pactual', 'banco btg'],
  'XP': ['xp investimentos', 'banco xp', 'xp'],
  'Original': ['banco original', 'original'],
  'Mercado Pago': ['mercado livre', 'mercado pago', 'mercadopago'],
  'PicPay': ['picpay', 'pic pay', 'banco picpay'],
  'Neon': ['neon', 'banco neon', 'neon pagamentos'],
  'Pan': ['banco pan', 'pan'],
  'Safra': ['banco safra', 'safra'],
  'Sicoob': ['sicoob', 'banco sicoob'],
  'Sicredi': ['sicredi', 'banco sicredi'],
};

const STANDARD_CARD_BRANDS = [
  { displayName: 'Mastercard', normalizedName: 'mastercard' },
  { displayName: 'Visa', normalizedName: 'visa' },
  { displayName: 'Elo', normalizedName: 'elo' },
  { displayName: 'Hipercard', normalizedName: 'hipercard' },
  { displayName: 'American Express', normalizedName: 'american_express' },
  { displayName: 'Diners Club', normalizedName: 'diners_club' },
];

export class CatalogImporter {
  constructor(db, { xlsxPath = DEFAULT_XLSX_PATH, jsonPath = DEFAULT_JSON_PATH } = {}) {
    this.db = db;
    this.xlsxPath = xlsxPath;
    this.jsonPath = jsonPath;
  }

  async loadCatalogItems() {
    try {
      const data = await fs.readFile(this.jsonPath, 'utf8');
      return JSON.parse(data);
    } catch {
      throw new Error(`Arquivo de catálogo JSON não encontrado em ${this.jsonPath}.`);
    }
  }

  async computeXlsxSha256() {
    try {
      const buf = await fs.readFile(this.xlsxPath);
      return createHash('sha256').update(buf).digest('hex');
    } catch {
      return createHash('sha256').update(Buffer.from('fallback-catalog')).digest('hex');
    }
  }

  generateDeterministicId(prefix, key) {
    const hash = createHash('sha256').update(`${prefix}:${key}`).digest('hex');
    return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-${hash.slice(12, 16)}-${hash.slice(16, 20)}-${hash.slice(20, 32)}`;
  }

  async importCatalog() {
    const items = await this.loadCatalogItems();
    const sourceSha256 = await this.computeXlsxSha256();
    const importId = randomUUID();
    const now = new Date().toISOString();

    let insertedCount = 0;
    let updatedCount = 0;

    // Registra importação
    this.db.prepare(`
      INSERT INTO catalog_imports (id, source_name, source_sha256, imported_at, status, row_count)
      VALUES (?, 'instituicoes_bancarias_com_logo.xlsx', ?, ?, 'in_progress', ?)
      ON CONFLICT(source_sha256) DO UPDATE SET
        imported_at = excluded.imported_at,
        status = 'in_progress'
    `).run(importId, sourceSha256, now, items.length);

    const activeImport = this.db.prepare('SELECT id FROM catalog_imports WHERE source_sha256 = ?').get(sourceSha256);
    const resolvedImportId = activeImport ? activeImport.id : importId;

    const insertInstStmt = this.db.prepare(`
      INSERT INTO institutions (id, popular_name, ispb, source_key, active, created_at, updated_at)
      VALUES (?, ?, ?, ?, 1, ?, ?)
      ON CONFLICT(source_key) DO UPDATE SET
        popular_name = excluded.popular_name,
        ispb = excluded.ispb,
        active = 1,
        updated_at = excluded.updated_at
    `);

    const insertAliasStmt = this.db.prepare(`
      INSERT INTO institution_aliases (id, institution_id, normalized_alias, display_alias, source)
      VALUES (?, ?, ?, ?, 'catalog')
      ON CONFLICT(institution_id, normalized_alias) DO UPDATE SET
        display_alias = excluded.display_alias
    `);

    const insertAssetStmt = this.db.prepare(`
      INSERT INTO logo_assets (id, storage_key, mime_type, format, source_url, validation_status, created_at)
      VALUES (?, ?, ?, ?, ?, 'registered', ?)
      ON CONFLICT(storage_key) DO UPDATE SET
        source_url = excluded.source_url,
        mime_type = excluded.mime_type,
        format = excluded.format
    `);

    const insertLogoLinkStmt = this.db.prepare(`
      INSERT INTO institution_logos (id, institution_id, logo_asset_id, source_url, is_primary, imported_at)
      VALUES (?, ?, ?, ?, 1, ?)
      ON CONFLICT(id) DO UPDATE SET
        logo_asset_id = excluded.logo_asset_id,
        source_url = excluded.source_url
    `);

    const insertRowStmt = this.db.prepare(`
      INSERT INTO catalog_import_rows (import_id, row_number, source_key, row_sha256, institution_id, logo_asset_id, outcome)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(import_id, row_number) DO UPDATE SET
        outcome = excluded.outcome
    `);

    for (const item of items) {
      const sourceKey = `ispb:${item.ispb}`;
      const instId = this.generateDeterministicId('inst', item.ispb);
      const assetId = this.generateDeterministicId('asset', item.ispb);
      const logoLinkId = this.generateDeterministicId('inst_logo', item.ispb);
      const storageKey = `logos/${item.ispb}.${item.extension}`;
      const mimeType = item.extension === 'svg' ? 'image/svg+xml' : 'image/png';

      const existing = this.db.prepare('SELECT id FROM institutions WHERE source_key = ?').get(sourceKey);
      const outcome = existing ? 'updated' : 'inserted';

      if (existing) {
        updatedCount += 1;
      } else {
        insertedCount += 1;
      }

      // 1. Instituição
      insertInstStmt.run(instId, item.popular_name, item.ispb, sourceKey, now, now);

      // 2. Aliases
      const normPop = normalizeTerm(item.popular_name);
      insertAliasStmt.run(randomUUID(), instId, normPop, item.popular_name);

      // Aliases adicionais para nomes que começam com "Banco "
      if (item.popular_name.toLowerCase().startsWith('banco ')) {
        const withoutBanco = item.popular_name.slice(6).trim();
        const normWithout = normalizeTerm(withoutBanco);
        if (normWithout) {
          insertAliasStmt.run(randomUUID(), instId, normWithout, withoutBanco);
        }
      }

      // Aliases conhecidos para grandes bancos
      const special = KNOWN_SPECIAL_ALIASES[item.popular_name];
      if (special && Array.isArray(special)) {
        for (const alias of special) {
          const normA = normalizeTerm(alias);
          if (normA) {
            insertAliasStmt.run(randomUUID(), instId, normA, alias);
          }
        }
      }

      // 3. Asset de logo
      insertAssetStmt.run(assetId, storageKey, mimeType, item.extension, item.logo_url, now);

      // 4. Link de logo
      insertLogoLinkStmt.run(logoLinkId, instId, assetId, item.logo_url, now);

      // 5. Linha de importação
      const rowSha = createHash('sha256').update(JSON.stringify(item)).digest('hex');
      insertRowStmt.run(resolvedImportId, item.row, sourceKey, rowSha, instId, assetId, outcome);
    }

    // 6. Semeia bandeiras padrão de cartão
    const insertBrandStmt = this.db.prepare(`
      INSERT INTO card_brands (id, display_name, normalized_name, active, created_at, updated_at)
      VALUES (?, ?, ?, 1, ?, ?)
      ON CONFLICT(normalized_name) DO UPDATE SET
        display_name = excluded.display_name,
        active = 1,
        updated_at = excluded.updated_at
    `);

    for (const b of STANDARD_CARD_BRANDS) {
      const brandId = this.generateDeterministicId('brand', b.normalizedName);
      insertBrandStmt.run(brandId, b.displayName, b.normalizedName, now, now);
    }

    // Finaliza importação
    this.db.prepare(`
      UPDATE catalog_imports
      SET status = 'completed',
          inserted_count = ?,
          updated_count = ?
      WHERE id = ?
    `).run(insertedCount, updatedCount, resolvedImportId);

    return {
      importId: resolvedImportId,
      sourceSha256,
      totalRows: items.length,
      insertedCount,
      updatedCount,
      brandsCount: STANDARD_CARD_BRANDS.length,
      status: 'completed',
    };
  }
}
