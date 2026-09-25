import test from 'node:test';
import assert from 'node:assert/strict';

import { createDatabase, runMigrations, rollbackMigration } from '../../src/db/index.js';

test('Migration 001 sobe em banco vazio com integridade e sem dados automáticos', () => {
  const db = createDatabase(':memory:');
  const applied = runMigrations(db);

  assert.deepEqual(applied, ['001_initial_schema']);

  // Nenhuma tabela possui dados inseridos automaticamente
  const users = db.prepare('SELECT COUNT(*) as count FROM users').get().count;
  const spaces = db.prepare('SELECT COUNT(*) as count FROM spaces').get().count;
  const transactions = db.prepare('SELECT COUNT(*) as count FROM transactions').get().count;
  const auditLogs = db.prepare('SELECT COUNT(*) as count FROM audit_logs').get().count;

  assert.equal(users, 0);
  assert.equal(spaces, 0);
  assert.equal(transactions, 0);
  assert.equal(auditLogs, 0);

  // Executar novamente não reaplica (idempotente)
  const reapplied = runMigrations(db);
  assert.deepEqual(reapplied, []);
});

test('Migration 001 é reversível via rollback explícito', () => {
  const db = createDatabase(':memory:');
  runMigrations(db);

  // Reversão explícita
  rollbackMigration(db, '001_initial_schema');

  // Tabelas foram removidas
  const tables = db
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")
    .all()
    .map((t) => t.name);

  assert.equal(tables.includes('spaces'), false);
  assert.equal(tables.includes('transactions'), false);
  assert.equal(tables.includes('users'), false);
});
