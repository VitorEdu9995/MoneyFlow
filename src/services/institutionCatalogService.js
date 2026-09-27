import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { AppError, ErrorCodes } from '../domain/envelope.js';

export const LOGO_STORAGE_DIR = path.join(process.cwd(), '.data', 'logos');

export function normalizeTerm(text) {
  if (!text || typeof text !== 'string') return '';
  return text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

export class InstitutionCatalogService {
  /**
   * @param {import('node:sqlite').DatabaseSync} db
   * @param {object} [options]
   * @param {string} [options.storageDir]
   */
  constructor(db, { storageDir = LOGO_STORAGE_DIR } = {}) {
    this.db = db;
    this.storageDir = storageDir;
  }

  async _ensureStorageDir() {
    await fs.mkdir(this.storageDir, { recursive: true });
  }

  /**
   * Busca instituições com suporte a nome popular, aliases, código bancário e ISPB.
   * Se spaceId for informado, prioriza favoritos e mais selecionados pelo tenant.
   */
  searchInstitutions({ query = '', limit = 50, offset = 0, activeOnly = true, spaceId = null } = {}) {
    const lim = Math.max(1, Math.min(200, Number(limit) || 50));
    const off = Math.max(0, Number(offset) || 0);
    const normalizedQuery = normalizeTerm(query);

    let whereClause = activeOnly ? 'i.active = 1' : '1=1';
    const params = [];

    if (spaceId) {
      params.push(spaceId);
    }

    if (normalizedQuery.length > 0) {
      whereClause += ` AND (
        LOWER(i.popular_name) LIKE ? OR
        LOWER(COALESCE(i.legal_name, '')) LIKE ? OR
        i.bank_code = ? OR
        i.ispb = ? OR
        EXISTS (
          SELECT 1 FROM institution_aliases ia
          WHERE ia.institution_id = i.id AND ia.normalized_alias LIKE ?
        )
      )`;
      const wild = `%${normalizedQuery}%`;
      params.push(wild, wild, normalizedQuery, normalizedQuery, wild);
    }

    const selectSql = `
      SELECT
        i.id,
        i.popular_name,
        i.legal_name,
        i.bank_code,
        i.ispb,
        i.kind,
        i.active,
        la.id AS logo_asset_id,
        la.format AS logo_format,
        la.mime_type AS logo_mime_type,
        la.source_url AS logo_source_url,
        ${spaceId ? 'COALESCE(ip.favorite, 0) AS is_favorite, COALESCE(ip.selection_count, 0) AS selection_count' : '0 AS is_favorite, 0 AS selection_count'}
      FROM institutions i
      ${spaceId ? 'LEFT JOIN institution_preferences ip ON ip.institution_id = i.id AND ip.space_id = ?' : ''}
      LEFT JOIN institution_logos il ON il.institution_id = i.id AND il.is_primary = 1
      LEFT JOIN logo_assets la ON la.id = il.logo_asset_id
      WHERE ${whereClause}
      ORDER BY
        ${spaceId ? 'is_favorite DESC, selection_count DESC,' : ''}
        i.popular_name ASC
      LIMIT ? OFFSET ?
    `;

    const countSql = `
      SELECT COUNT(DISTINCT i.id) AS total
      FROM institutions i
      WHERE ${whereClause}
    `;

    // Parâmetros para contagem (sem spaceId inicial se count não usa join de preferences)
    const countParams = normalizedQuery.length > 0
      ? [
          `%${normalizedQuery}%`,
          `%${normalizedQuery}%`,
          normalizedQuery,
          normalizedQuery,
          `%${normalizedQuery}%`,
        ]
      : [];

    const totalRow = this.db.prepare(countSql).get(...countParams);
    const totalCount = totalRow ? Number(totalRow.total) : 0;

    const rows = this.db.prepare(selectSql).all(...params, lim, off);

    const institutions = rows.map((row) => ({
      id: row.id,
      popularName: row.popular_name,
      legalName: row.legal_name,
      bankCode: row.bank_code,
      ispb: row.ispb,
      kind: row.kind,
      active: Boolean(row.active),
      isFavorite: Boolean(row.is_favorite),
      selectionCount: Number(row.selection_count) || 0,
      logo: row.logo_asset_id
        ? {
            assetId: row.logo_asset_id,
            format: row.logo_format,
            mimeType: row.logo_mime_type,
            sourceUrl: row.logo_source_url,
            localUrl: `/api/v1/catalog/logos/${row.logo_asset_id}`,
          }
        : null,
    }));

    return {
      institutions,
      totalCount,
      limit: lim,
      offset: off,
    };
  }

  getInstitution(id, { spaceId = null } = {}) {
    if (!id || typeof id !== 'string') {
      throw new AppError(ErrorCodes.VALIDATION_ERROR, 'ID da instituição é obrigatório.', 400);
    }

    const selectSql = `
      SELECT
        i.id, i.popular_name, i.legal_name, i.bank_code, i.ispb, i.kind, i.active,
        la.id AS logo_asset_id, la.format AS logo_format, la.mime_type AS logo_mime_type, la.source_url AS logo_source_url,
        ${spaceId ? 'COALESCE(ip.favorite, 0) AS is_favorite, COALESCE(ip.selection_count, 0) AS selection_count' : '0 AS is_favorite, 0 AS selection_count'}
      FROM institutions i
      ${spaceId ? 'LEFT JOIN institution_preferences ip ON ip.institution_id = i.id AND ip.space_id = ?' : ''}
      LEFT JOIN institution_logos il ON il.institution_id = i.id AND il.is_primary = 1
      LEFT JOIN logo_assets la ON la.id = il.logo_asset_id
      WHERE i.id = ?
    `;

    const params = spaceId ? [spaceId, id] : [id];
    const row = this.db.prepare(selectSql).get(...params);
    if (!row) {
      throw new AppError(ErrorCodes.NOT_FOUND, 'Instituição não encontrada no catálogo.', 404);
    }

    const aliases = this.db
      .prepare('SELECT display_alias FROM institution_aliases WHERE institution_id = ? ORDER BY display_alias ASC')
      .all(id)
      .map((a) => a.display_alias);

    return {
      id: row.id,
      popularName: row.popular_name,
      legalName: row.legal_name,
      bankCode: row.bank_code,
      ispb: row.ispb,
      kind: row.kind,
      active: Boolean(row.active),
      isFavorite: Boolean(row.is_favorite),
      selectionCount: Number(row.selection_count) || 0,
      aliases,
      logo: row.logo_asset_id
        ? {
            assetId: row.logo_asset_id,
            format: row.logo_format,
            mimeType: row.logo_mime_type,
            sourceUrl: row.logo_source_url,
            localUrl: `/api/v1/catalog/logos/${row.logo_asset_id}`,
          }
        : null,
    };
  }

  listCardBrands({ activeOnly = true } = {}) {
    const where = activeOnly ? 'WHERE cb.active = 1' : '';
    const sql = `
      SELECT
        cb.id, cb.display_name, cb.normalized_name, cb.active,
        la.id AS logo_asset_id, la.format AS logo_format, la.mime_type AS logo_mime_type
      FROM card_brands cb
      LEFT JOIN logo_assets la ON la.id = cb.logo_asset_id
      ${where}
      ORDER BY cb.display_name ASC
    `;
    const rows = this.db.prepare(sql).all();
    return rows.map((r) => ({
      id: r.id,
      displayName: r.display_name,
      normalizedName: r.normalized_name,
      active: Boolean(r.active),
      logo: r.logo_asset_id
        ? {
            assetId: r.logo_asset_id,
            format: r.logo_format,
            mimeType: r.logo_mime_type,
            localUrl: `/api/v1/catalog/logos/${r.logo_asset_id}`,
          }
        : null,
    }));
  }

  recordInstitutionSelection(spaceId, institutionId) {
    if (!spaceId || !institutionId) return;
    const now = new Date().toISOString();
    this.db.prepare(`
      INSERT INTO institution_preferences (space_id, institution_id, favorite, selection_count, last_selected_at)
      VALUES (?, ?, 0, 1, ?)
      ON CONFLICT(space_id, institution_id) DO UPDATE SET
        selection_count = selection_count + 1,
        last_selected_at = excluded.last_selected_at
    `).run(spaceId, institutionId, now);
  }

  toggleFavoriteInstitution(spaceId, institutionId, favorite = true) {
    if (!spaceId || !institutionId) return;
    const favVal = favorite ? 1 : 0;
    const now = new Date().toISOString();
    this.db.prepare(`
      INSERT INTO institution_preferences (space_id, institution_id, favorite, selection_count, last_selected_at)
      VALUES (?, ?, ?, 0, ?)
      ON CONFLICT(space_id, institution_id) DO UPDATE SET
        favorite = excluded.favorite
    `).run(spaceId, institutionId, favVal, now);
  }

  getLogoAsset(assetId) {
    if (!assetId || typeof assetId !== 'string') return null;
    return this.db.prepare('SELECT * FROM logo_assets WHERE id = ?').get(assetId) || null;
  }

  async getLogoAssetContent(assetId) {
    const asset = this.getLogoAsset(assetId);
    if (!asset) {
      throw new AppError(ErrorCodes.NOT_FOUND, 'Asset de logo não encontrado.', 404);
    }

    const filePath = path.join(this.storageDir, asset.storage_key);
    try {
      const buffer = await fs.readFile(filePath);
      return {
        buffer,
        mimeType: asset.mime_type,
        format: asset.format,
        sha256: asset.sha256,
        sourceUrl: asset.source_url,
      };
    } catch {
      throw new AppError(ErrorCodes.NOT_FOUND, 'Arquivo de logo não encontrado no storage local.', 404);
    }
  }
}
