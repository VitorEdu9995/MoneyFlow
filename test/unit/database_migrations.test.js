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
    '004_import_real_mvp_format',
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

  // Reversão explícita na ordem de dependência (004, 003, depois 002 e depois 001)
  rollbackMigration(db, '004_import_real_mvp_format');
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

test('Migration 004 amplia import_batches (imported_cards/imported_payments) e import_entities (entity_type credit_cards)', () => {
  const db = createDatabase(':memory:');
  runMigrations(db);

  const columns = db.prepare('PRAGMA table_info(import_batches)').all().map((c) => c.name);
  assert.ok(columns.includes('imported_cards'));
  assert.ok(columns.includes('imported_payments'));

  db.exec("INSERT INTO users (id, email, name) VALUES ('u-1', 'u@x.dev', 'U')");
  db.exec("INSERT INTO spaces (id, name, owner_user_id) VALUES ('sp-1', 'Espaço', 'u-1')");
  db.exec(
    "INSERT INTO import_batches (id, space_id, checksum, raw_payload) VALUES ('b-1', 'sp-1', 'checksum-1', '{}')",
  );

  // entity_type 'credit_cards' não existia antes da migration 004; não deve violar o CHECK.
  db.exec(
    "INSERT INTO import_entities (id, space_id, batch_id, entity_type, entity_id) VALUES ('e-1', 'sp-1', 'b-1', 'credit_cards', 'card-1')",
  );

  const row = db.prepare('SELECT entity_type FROM import_entities WHERE id = ?').get('e-1');
  assert.equal(row.entity_type, 'credit_cards');
});
