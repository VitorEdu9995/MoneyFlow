import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import { createDatabase, runMigrations } from '../../src/db/index.js';
import { SpaceIsolationService } from '../../src/services/spaceIsolationService.js';
import { randomUUID } from 'node:crypto';

describe('Auditoria via Interceptor (ECO-66)', () => {
  let db;
  let service;
  let authContext;
  let spaceId;

  beforeEach(() => {
    db = createDatabase(':memory:');
    runMigrations(db);
    service = new SpaceIsolationService(db);
    
    const owner = service.createUser({ email: 'audit@test.dev', name: 'Audit' });
    const space = service.createSpace({ name: 'Audit Test Space', ownerUserId: owner.id });
    
    spaceId = space.id;
    authContext = service.resolveAuthContext({ userId: owner.id, spaceId });
  });

  afterEach(() => {
    db.close();
  });

  it('deve garantir que a tabela audit_logs é append-only (bloqueia UPDATE)', () => {
    const id = randomUUID();
    db.prepare(`
      INSERT INTO audit_logs (id, space_id, actor_user_id, action, entity_type, entity_id, new_data)
      VALUES (?, ?, ?, 'test', 'test', 'test', '{}')
    `).run(id, spaceId, authContext.userId);

    assert.throws(() => {
      db.prepare("UPDATE audit_logs SET action = 'hacked' WHERE id = ?").run(id);
    }, /audit_logs is append-only/);
  });

  it('deve garantir que a tabela audit_logs é append-only (bloqueia DELETE)', () => {
    const id = randomUUID();
    db.prepare(`
      INSERT INTO audit_logs (id, space_id, actor_user_id, action, entity_type, entity_id, new_data)
      VALUES (?, ?, ?, 'test', 'test', 'test', '{}')
    `).run(id, spaceId, authContext.userId);

    assert.throws(() => {
      db.prepare('DELETE FROM audit_logs WHERE id = ?').run(id);
    }, /audit_logs is append-only/);
  });

  it('deve gerar log com campos corretos ao criar uma conta via interceptor', () => {
    const payload = {
      name: 'Conta Teste',
      openingBalance: 100,
      accountType: 'checking',
      currency: 'BRL'
    };

    const account = service.createAccount(authContext, payload);

    const log = db.prepare('SELECT * FROM audit_logs WHERE space_id = ? AND action = ?').get(spaceId, 'account.create');
    assert.ok(log, 'Deve ter gerado um log de auditoria');
    assert.strictEqual(log.action, 'account.create');
    assert.strictEqual(log.entity_type, 'accounts');
    assert.strictEqual(log.entity_id, account.id);
    assert.strictEqual(log.actor_user_id, authContext.userId);
    
    const newData = JSON.parse(log.new_data);
    assert.strictEqual(newData.name, 'Conta Teste');
  });

  it("deve gerar log com dados censurados se houver campos sensíveis", async () => {
    const { redact } = await import("../../src/utils/logger.js");
    const data = { name: "Conta", password: "123", token: "abc" };
    const redacted = redact(data);
    assert.strictEqual(redacted.name, "Conta");
    assert.strictEqual(redacted.password, "[REDACTED]");
    assert.strictEqual(redacted.token, "[REDACTED]");
  });
});