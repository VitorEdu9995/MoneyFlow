import test from 'node:test';
import assert from 'node:assert/strict';

import { createDatabase, runMigrations, rollbackMigration } from '../../src/db/index.js';

test('Migrations estruturais sobem em banco vazio com integridade e sem dados automáticos', () => {
  const db = createDatabase(':memory:');
  const applied = runMigrations(db);

  assert.deepEqual(applied, [
    '001_initial_schema',
    '002_custom_attributes_and_purchases',
    '003_financial_core_phase2',
  ]);

  // Nenhuma tabela possui dados inseridos automaticamente
  const users = db.prepare('SELECT COUNT(*) as count FROM users').get().count;
  const spaces = db.prepare('SELECT COUNT(*) as count FROM spaces').get().count;
  const transactions = db.prepare('SELECT COUNT(*) as count FROM transactions').get().count;
  const purchases = db.prepare('SELECT COUNT(*) as count FROM purchases').get().count;
  const auditLogs = db.prepare('SELECT COUNT(*) as count FROM audit_logs').get().count;
  const tags = db.prepare('SELECT COUNT(*) as count FROM tags').get().count;
  const transfers = db.prepare('SELECT COUNT(*) as count FROM transfers').get().count;
  const importBatches = db.prepare('SELECT COUNT(*) as count FROM import_batches').get().count;

  assert.equal(users, 0);
  assert.equal(spaces, 0);
  assert.equal(transactions, 0);
  assert.equal(purchases, 0);
  assert.equal(auditLogs, 0);
  assert.equal(tags, 0);
  assert.equal(transfers, 0);
  assert.equal(importBatches, 0);

  // Executar novamente não reaplica (idempotente)
  const reapplied = runMigrations(db);
  assert.deepEqual(reapplied, []);
});

test('Migrations são reversíveis via rollback explícito', () => {
  const db = createDatabase(':memory:');
  runMigrations(db);

  // Reversão explícita na ordem de dependência (003, depois 002 e depois 001)
  rollbackMigration(db, '003_financial_core_phase2');
  rollbackMigration(db, '002_custom_attributes_and_purchases');
  rollbackMigration(db, '001_initial_schema');

  // Tabelas foram removidas
  const tables = db
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")
    .all()
    .map((t) => t.name);

  assert.equal(tables.includes('spaces'), false);
  assert.equal(tables.includes('transactions'), false);
  assert.equal(tables.includes('purchases'), false);
  assert.equal(tables.includes('users'), false);
  assert.equal(tables.includes('tags'), false);
  assert.equal(tables.includes('transfers'), false);
  assert.equal(tables.includes('import_batches'), false);
});
