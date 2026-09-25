/**
 * Gerenciador de migrações e banco de dados SQLite para MoneyFlow.
 *
 * Garante:
 * 1. Inicialização em banco vazio sem inserção automática de dados.
 * 2. Tabela de controle `_migrations` para registrar migrações executadas.
 * 3. Execução reversível explícita (up / down).
 */

import { DatabaseSync } from 'node:sqlite';
import * as initialSchema from './migrations/001_initial_schema.js';
import * as customAttributesAndPurchases from './migrations/002_custom_attributes_and_purchases.js';
import * as financialCorePhase2 from './migrations/003_financial_core_phase2.js';
import * as importRealMvpFormat from './migrations/004_import_real_mvp_format.js';

export const MIGRATIONS = [
  { id: '001_initial_schema', module: initialSchema },
  { id: '002_custom_attributes_and_purchases', module: customAttributesAndPurchases },
  { id: '003_financial_core_phase2', module: financialCorePhase2 },
  { id: '004_import_real_mvp_format', module: importRealMvpFormat },
];

/**
 * Cria ou abre uma conexão com banco SQLite configurado com Foreign Keys ativas.
 * @param {string} [dbPath=':memory:']
 * @returns {DatabaseSync}
 */
export function createDatabase(dbPath = ':memory:') {
  const db = new DatabaseSync(dbPath);
  db.exec('PRAGMA foreign_keys = ON;');
  db.exec('PRAGMA journal_mode = WAL;');
  return db;
}

/**
 * Executa as migrações estruturais pendentes.
 * NUNCA executa migração automática de dados.
 * @param {DatabaseSync} db
 * @returns {string[]} Lista de migrações aplicadas
 */
export function runMigrations(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS _migrations (
      id TEXT PRIMARY KEY,
      applied_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  const appliedRows = db.prepare('SELECT id FROM _migrations').all();
  const appliedSet = new Set(appliedRows.map((r) => r.id));
  const newlyApplied = [];

  for (const mig of MIGRATIONS) {
    if (!appliedSet.has(mig.id)) {
      db.exec('BEGIN TRANSACTION;');
      try {
        db.exec(mig.module.up);
        db.prepare('INSERT INTO _migrations (id) VALUES (?)').run(mig.id);
        db.exec('COMMIT;');
        newlyApplied.push(mig.id);
      } catch (err) {
        db.exec('ROLLBACK;');
        throw new Error(`Falha ao aplicar migration ${mig.id}: ${err.message}`);
      }
    }
  }

  return newlyApplied;
}

/**
 * Reverte uma migração específica de forma explícita.
 * @param {DatabaseSync} db
 * @param {string} migrationId
 */
export function rollbackMigration(db, migrationId) {
  const mig = MIGRATIONS.find((m) => m.id === migrationId);
  if (!mig) {
    throw new Error(`Migration '${migrationId}' não encontrada no catálogo.`);
  }

  db.exec('BEGIN TRANSACTION;');
  try {
    db.exec(mig.module.down);
    db.prepare('DELETE FROM _migrations WHERE id = ?').run(migrationId);
    db.exec('COMMIT;');
  } catch (err) {
    db.exec('ROLLBACK;');
    throw new Error(`Falha ao reverter migration ${migrationId}: ${err.message}`);
  }
}
