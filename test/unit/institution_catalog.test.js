import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { randomUUID } from 'node:crypto';
import { createDatabase, runMigrations } from '../../src/db/index.js';
import { SpaceIsolationService } from '../../src/services/spaceIsolationService.js';
import { InstitutionCatalogService } from '../../src/services/institutionCatalogService.js';
import { CatalogImporter } from '../../src/ops/catalogImporter.js';
import { McpGateway } from '../../src/gateway/mcpGateway.js';
import { executeMcpHttpRequest } from '../../src/gateway/mcpHttpTransport.js';
import { Roles } from '../../src/domain/authorization.js';

async function setupCatalogEnvironment() {
  const db = createDatabase(':memory:');
  runMigrations(db);

  const tmpStorage = await fs.mkdtemp(path.join(os.tmpdir(), 'moneyflow-logos-test-'));
  const catalogService = new InstitutionCatalogService(db, { storageDir: tmpStorage });
  const service = new SpaceIsolationService(db);
  const gateway = new McpGateway({ service, catalogService });

  const importer = new CatalogImporter(db);
  await importer.importCatalog();

  const ownerA = service.createUser({ name: 'Tenant A Owner', email: `tenant-a-${randomUUID()}@flow.local` });
  const spaceA = service.createSpace({ name: 'Espaço Tenant A', ownerUserId: ownerA.id });
  const authContextA = service.resolveAuthContext({ userId: ownerA.id, spaceId: spaceA.id });

  const ownerB = service.createUser({ name: 'Tenant B Owner', email: `tenant-b-${randomUUID()}@flow.local` });
  const spaceB = service.createSpace({ name: 'Espaço Tenant B', ownerUserId: ownerB.id });
  const authContextB = service.resolveAuthContext({ userId: ownerB.id, spaceId: spaceB.id });

  return {
    db,
    catalogService,
    service,
    gateway,
    tmpStorage,
    authContextA,
    authContextB,
    spaceA,
    spaceB,
  };
}

test('CatalogImporter: importa 150 instituições e bandeiras padrão com idempotência', async () => {
  const db = createDatabase(':memory:');
  runMigrations(db);
  const importer = new CatalogImporter(db);

  const res1 = await importer.importCatalog();
  assert.equal(res1.status, 'completed');
  assert.equal(res1.totalRows, 150);
  assert.equal(res1.insertedCount, 150);
  assert.equal(res1.updatedCount, 0);
  assert.equal(res1.brandsCount, 6);

  const countInst = db.prepare('SELECT COUNT(*) as c FROM institutions').get().c;
  assert.equal(countInst, 150);

  const countBrands = db.prepare('SELECT COUNT(*) as c FROM card_brands').get().c;
  assert.equal(countBrands, 6);

  // Segunda execução deve ser idempotente (0 inserções novas, 150 atualizações)
  const res2 = await importer.importCatalog();
  assert.equal(res2.status, 'completed');
  assert.equal(res2.totalRows, 150);
  assert.equal(res2.insertedCount, 0);
  assert.equal(res2.updatedCount, 150);
});

test('InstitutionCatalogService: busca por nome popular, aliases e ISPB', async () => {
  const env = await setupCatalogEnvironment();

  // 1. Busca por nome popular exato e parcial
  const nuRes = env.catalogService.searchInstitutions({ query: 'Nubank' });
  assert.ok(nuRes.institutions.length > 0);
  assert.equal(nuRes.institutions[0].popularName, 'Nubank');
  assert.ok(nuRes.institutions[0].logo);
  assert.equal(nuRes.institutions[0].logo.format, 'svg');

  // 2. Busca por alias conhecido ("nu pagamentos")
  const aliasRes = env.catalogService.searchInstitutions({ query: 'nu pagamentos' });
  assert.ok(aliasRes.institutions.length > 0);
  assert.equal(aliasRes.institutions[0].popularName, 'Nubank');

  // 3. Busca por "Inter"
  const interRes = env.catalogService.searchInstitutions({ query: 'Inter' });
  assert.ok(interRes.institutions.some((i) => i.popularName === 'Inter'));

  // 4. Busca por ISPB do Banco do Brasil ("00000000")
  const bbRes = env.catalogService.searchInstitutions({ query: '00000000' });
  assert.ok(bbRes.institutions.length > 0);
  assert.equal(bbRes.institutions[0].popularName, 'Banco do Brasil');
  assert.equal(bbRes.institutions[0].ispb, '00000000');

  // Limpa pasta temporária
  await fs.rm(env.tmpStorage, { recursive: true, force: true });
});

test('InstitutionCatalogService: preferências e favoritos por espaço isolado (Multi-Tenant)', async () => {
  const env = await setupCatalogEnvironment();

  // Busca Nubank e Inter
  const nu = env.catalogService.searchInstitutions({ query: 'Nubank' }).institutions[0];
  const inter = env.catalogService.searchInstitutions({ query: 'Inter' }).institutions.find((i) => i.popularName === 'Inter');

  // Tenant A marca 'Inter' como favorito
  env.catalogService.toggleFavoriteInstitution(env.spaceA.id, inter.id, true);

  // Tenant A lista: Inter deve vir como isFavorite: true
  const listA = env.catalogService.searchInstitutions({ spaceId: env.spaceA.id, limit: 10 });
  assert.equal(listA.institutions[0].id, inter.id);
  assert.equal(listA.institutions[0].isFavorite, true);

  // Tenant B lista: Inter NÃO deve ser favorito para o Tenant B (Isolamento)
  const listB = env.catalogService.searchInstitutions({ spaceId: env.spaceB.id, limit: 10 });
  const interInB = listB.institutions.find((i) => i.id === inter.id);
  assert.equal(interInB?.isFavorite || false, false);

  // Incrementa contagem de seleção de Nubank no Tenant B
  env.catalogService.recordInstitutionSelection(env.spaceB.id, nu.id);
  env.catalogService.recordInstitutionSelection(env.spaceB.id, nu.id);

  const getNuB = env.catalogService.getInstitution(nu.id, { spaceId: env.spaceB.id });
  assert.equal(getNuB.selectionCount, 2);

  const getNuA = env.catalogService.getInstitution(nu.id, { spaceId: env.spaceA.id });
  assert.equal(getNuA.selectionCount, 0);

  await fs.rm(env.tmpStorage, { recursive: true, force: true });
});

test('InstitutionCatalogService: listagem de bandeiras de cartão', async () => {
  const env = await setupCatalogEnvironment();

  const brands = env.catalogService.listCardBrands();
  assert.equal(brands.length, 6);
  const names = brands.map((b) => b.displayName);
  assert.ok(names.includes('Mastercard'));
  assert.ok(names.includes('Visa'));
  assert.ok(names.includes('Elo'));
  assert.ok(names.includes('Hipercard'));
  assert.ok(names.includes('American Express'));
  assert.ok(names.includes('Diners Club'));

  await fs.rm(env.tmpStorage, { recursive: true, force: true });
});

test('McpGateway: list_institutions, create_account e create_credit_card com catálogo', async () => {
  const env = await setupCatalogEnvironment();

  // 1. Tool list_institutions
  const listResponse = await env.gateway.executeTool('list_institutions', { query: 'Nubank' }, env.authContextA);
  assert.equal(listResponse.status, 'ok');
  const listResult = listResponse.data;
  assert.ok(Array.isArray(listResult));
  assert.ok(listResult.length > 0);
  assert.equal(listResult[0].name, 'Nubank');
  assert.ok(listResult[0].logo_url);

  const nubankId = listResult[0].id;

  // 2. Tool create_account com institution_id
  const accountResponse = await env.gateway.executeTool(
    'create_account',
    {
      name: 'Conta Nu Principal',
      opening_balance: 1500,
      account_type: 'checking',
      institution_id: nubankId,
    },
    env.authContextA,
  );
  assert.equal(accountResponse.status, 'ok');
  const account = accountResponse.data;
  assert.equal(account.name, 'Conta Nu Principal');
  assert.equal(account.institution_id, nubankId);

  // Verifica se a seleção de Nubank foi registrada para Tenant A
  const nuA = env.catalogService.getInstitution(nubankId, { spaceId: env.spaceA.id });
  assert.equal(nuA.selectionCount, 1);

  // 3. Tool create_credit_card com institution_id e brand
  const brands = env.catalogService.listCardBrands();
  const mastercard = brands.find((b) => b.displayName === 'Mastercard');

  const cardResponse = await env.gateway.executeTool(
    'create_credit_card',
    {
      name: 'Cartão Nubank Ultravioleta',
      closing_day: 5,
      due_day: 12,
      credit_limit: 10000,
      brand: 'Mastercard',
    },
    env.authContextA,
  );
  assert.equal(cardResponse.status, 'ok');
  const card = cardResponse.data;
  assert.equal(card.name, 'Cartão Nubank Ultravioleta');
  assert.equal(card.brand, 'Mastercard');

  await fs.rm(env.tmpStorage, { recursive: true, force: true });
});

test('HTTP API: rotas REST do catálogo (/api/v1/catalog/*)', async () => {
  const env = await setupCatalogEnvironment();

  // 1. GET /api/v1/catalog/institutions
  const searchHttp = await executeMcpHttpRequest(env.gateway, {
    method: 'GET',
    path: '/api/v1/catalog/institutions?query=Nubank',
    authContext: env.authContextA,
  });
  assert.equal(searchHttp.status, 200);
  assert.ok(searchHttp.body.ok);
  assert.ok(searchHttp.body.data.institutions.length > 0);
  const nubankId = searchHttp.body.data.institutions[0].id;
  const assetId = searchHttp.body.data.institutions[0].logo.assetId;

  // 2. GET /api/v1/catalog/institutions/:id
  const getHttp = await executeMcpHttpRequest(env.gateway, {
    method: 'GET',
    path: `/api/v1/catalog/institutions/${nubankId}`,
    authContext: env.authContextA,
  });
  assert.equal(getHttp.status, 200);
  assert.equal(getHttp.body.data.popularName, 'Nubank');
  assert.ok(Array.isArray(getHttp.body.data.aliases));

  // 3. GET /api/v1/catalog/brands
  const brandsHttp = await executeMcpHttpRequest(env.gateway, {
    method: 'GET',
    path: '/api/v1/catalog/brands',
    authContext: env.authContextA,
  });
  assert.equal(brandsHttp.status, 200);
  assert.equal(brandsHttp.body.data.length, 6);

  // 4. POST /api/v1/catalog/institutions/:id/favorite
  const favHttp = await executeMcpHttpRequest(env.gateway, {
    method: 'POST',
    path: `/api/v1/catalog/institutions/${nubankId}/favorite`,
    body: { favorite: true },
    authContext: env.authContextA,
  });
  assert.equal(favHttp.status, 200);
  assert.equal(favHttp.body.data.favorite, true);

  // 5. POST /api/v1/catalog/institutions/:id/select
  const selectHttp = await executeMcpHttpRequest(env.gateway, {
    method: 'POST',
    path: `/api/v1/catalog/institutions/${nubankId}/select`,
    authContext: env.authContextA,
  });
  assert.equal(selectHttp.status, 200);
  assert.equal(selectHttp.body.data.success, true);

  // 6. GET /api/v1/catalog/logos/:assetId com arquivo simulado
  const asset = env.catalogService.getLogoAsset(assetId);
  const fakeLogoPath = path.join(env.tmpStorage, asset.storage_key);
  await fs.mkdir(path.dirname(fakeLogoPath), { recursive: true });
  await fs.writeFile(fakeLogoPath, '<svg><circle cx="5" cy="5" r="5"/></svg>');

  const logoHttp = await executeMcpHttpRequest(env.gateway, {
    method: 'GET',
    path: `/api/v1/catalog/logos/${assetId}`,
    authContext: env.authContextA,
  });
  assert.equal(logoHttp.status, 200);
  assert.equal(logoHttp.headers['Content-Type'], 'image/svg+xml');
  assert.equal(logoHttp.headers['X-Content-Type-Options'], 'nosniff');
  assert.ok(logoHttp.headers['Cache-Control'].includes('public'));
  assert.ok(logoHttp.body.data.content_base64);

  await fs.rm(env.tmpStorage, { recursive: true, force: true });
});
