import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createDatabase, runMigrations } from '../../src/db/index.js';
import { SpaceIsolationService } from '../../src/services/spaceIsolationService.js';
import { InstitutionCatalogService } from '../../src/services/institutionCatalogService.js';
import { CatalogImporter } from '../../src/ops/catalogImporter.js';
import { McpGateway } from '../../src/gateway/mcpGateway.js';
import { executeMcpHttpRequest } from '../../src/gateway/mcpHttpTransport.js';

async function setupAdversarialEnvironment() {
  const db = createDatabase(':memory:');
  runMigrations(db);

  const catalogService = new InstitutionCatalogService(db);
  const service = new SpaceIsolationService(db);
  const gateway = new McpGateway({ service, catalogService });

  const importer = new CatalogImporter(db);
  await importer.importCatalog();

  const userA = service.createUser({ name: 'User A', email: `adv-a-${randomUUID()}@flow.local` });
  const spaceA = service.createSpace({ name: 'Space A', ownerUserId: userA.id });
  const authA = service.resolveAuthContext({ userId: userA.id, spaceId: spaceA.id });

  const userB = service.createUser({ name: 'User B', email: `adv-b-${randomUUID()}@flow.local` });
  const spaceB = service.createSpace({ name: 'Space B', ownerUserId: userB.id });
  const authB = service.resolveAuthContext({ userId: userB.id, spaceId: spaceB.id });

  return { db, catalogService, service, gateway, authA, authB, spaceA, spaceB };
}

test('Adversarial: injeção SQL e caracteres especiais em query de busca de catálogo', async () => {
  const env = await setupAdversarialEnvironment();

  const injectionQueries = [
    "' OR '1'='1",
    "'; DROP TABLE institutions; --",
    "' UNION SELECT id, name, NULL, NULL, NULL, NULL, NULL FROM users --",
    "%27%20OR%201=1",
    '"><script>alert(1)</script>',
    '\x00\x1f\x7f',
  ];

  for (const q of injectionQueries) {
    const res = env.catalogService.searchInstitutions({ query: q, spaceId: env.spaceA.id });
    assert.ok(Array.isArray(res.institutions));
    // As tabelas continuam intactas
    const count = env.db.prepare('SELECT COUNT(*) as c FROM institutions').get().c;
    assert.equal(count, 150);
  }
});

test('Adversarial: tentativa de path traversal ao solicitar asset de logo', async () => {
  const env = await setupAdversarialEnvironment();

  const traversalPayloads = [
    '../../../package.json',
    '..%2F..%2Fpackage.json',
    'C:\\Windows\\win.ini',
    '/etc/passwd',
  ];

  for (const maliciousId of traversalPayloads) {
    const res = await executeMcpHttpRequest(env.gateway, {
      method: 'GET',
      path: `/api/v1/catalog/logos/${encodeURIComponent(maliciousId)}`,
      authContext: env.authA,
    });
    // Deve retornar 404 pois o ID não existe na tabela logo_assets (anti path-traversal por chave estrita)
    assert.equal(res.status, 404);
  }
});

test('Adversarial: favoritar e selecionar sem autenticação retorna erro 401', async () => {
  const env = await setupAdversarialEnvironment();
  const inst = env.catalogService.searchInstitutions({ query: 'Nubank' }).institutions[0];

  const favRes = await executeMcpHttpRequest(env.gateway, {
    method: 'POST',
    path: `/api/v1/catalog/institutions/${inst.id}/favorite`,
    body: { favorite: true },
    authContext: null, // sem autenticação
  });
  assert.equal(favRes.status, 401);

  const selectRes = await executeMcpHttpRequest(env.gateway, {
    method: 'POST',
    path: `/api/v1/catalog/institutions/${inst.id}/select`,
    authContext: {}, // sem spaceId
  });
  assert.equal(selectRes.status, 401);
});

test('Adversarial: isolamento estrito — preferências não vazam entre tenants', async () => {
  const env = await setupAdversarialEnvironment();
  const institutions = env.catalogService.searchInstitutions({ limit: 10 }).institutions;
  const targetInst = institutions[0];

  // Tenant A favorita a instituição
  await executeMcpHttpRequest(env.gateway, {
    method: 'POST',
    path: `/api/v1/catalog/institutions/${targetInst.id}/favorite`,
    body: { favorite: true },
    authContext: env.authA,
  });

  // Tenant B consulta a mesma instituição: favorite deve ser false
  const getB = await executeMcpHttpRequest(env.gateway, {
    method: 'GET',
    path: `/api/v1/catalog/institutions/${targetInst.id}`,
    authContext: env.authB,
  });
  assert.equal(getB.status, 200);
  assert.equal(getB.body.data.isFavorite, false);
  assert.equal(getB.body.data.selectionCount, 0);
});
