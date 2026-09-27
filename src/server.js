import http from 'node:http';
import path from 'node:path';
import fs from 'node:fs';
import { randomUUID } from 'node:crypto';
import { createDatabase, runMigrations } from './db/index.js';
import { SpaceIsolationService } from './services/spaceIsolationService.js';
import { InstitutionCatalogService } from './services/institutionCatalogService.js';
import { AttachmentService } from './services/attachmentService.js';
import { LgpdService } from './services/lgpdService.js';
import { CatalogImporter } from './ops/catalogImporter.js';
import { McpGateway } from './gateway/mcpGateway.js';
import { executeMcpHttpRequest } from './gateway/mcpHttpTransport.js';
import { createRateLimiter } from './gateway/httpRateLimiter.js';
import { OperationalMetrics } from './observability/operationalMetrics.js';
import { Roles } from './domain/authorization.js';
import { logger } from './utils/logger.js';

const PORT = Number(process.env.PORT) || 3001;
const DATA_DIR = path.join(process.cwd(), '.data');
const DB_PATH = process.env.DB_PATH || path.join(DATA_DIR, 'moneyflow.db');

if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

// 1. Inicializa SQLite e Migrações
logger.info('Iniciando banco de dados SQLite...', { dbPath: DB_PATH });
const db = createDatabase(DB_PATH);
const appliedMigrations = runMigrations(db);
if (appliedMigrations.length > 0) {
  logger.info('Migrações aplicadas com sucesso:', { count: appliedMigrations.length, migrations: appliedMigrations });
}

// 2. Inicializa Serviços de Domínio
const metrics = new OperationalMetrics();
const service = new SpaceIsolationService(db, { metrics });
const attachmentService = new AttachmentService(db, service, { metrics });
const lgpdService = new LgpdService(db, service, attachmentService);
const catalogService = new InstitutionCatalogService(db);

// 3. Importa Catálogo de Logos se estiver vazio
const existingInstitutions = db.prepare('SELECT COUNT(*) as count FROM institutions').get();
if (!existingInstitutions || existingInstitutions.count === 0) {
  logger.info('Importando catálogo canônico de 150 instituições bancárias...');
  const importer = new CatalogImporter(db);
  await importer.importCatalog();
  logger.info('Catálogo canônico importado com sucesso.');
}

// 4. Cria ou Recupera Usuário Padrão
let defaultUser = db.prepare("SELECT * FROM users WHERE email = 'vitor@moneyflow.local'").get();
if (!defaultUser) {
  defaultUser = service.createUser({
    name: 'Vitor',
    email: 'vitor@moneyflow.local',
  });
  logger.info('Usuário padrão criado:', { id: defaultUser.id, name: defaultUser.name });
}

// 5. Cria ou Recupera Espaços Padrão (Pessoal e Empresarial)
let spaces = db.prepare('SELECT s.* FROM spaces s JOIN space_members m ON m.space_id = s.id WHERE m.user_id = ?').all(defaultUser.id);
let personalSpace = spaces.find((s) => s.name === 'Pessoal');
let businessSpace = spaces.find((s) => s.name === 'Empresa');

if (!personalSpace) {
  personalSpace = service.createSpace({
    name: 'Pessoal',
    ownerUserId: defaultUser.id,
  });
  logger.info('Espaço Pessoal criado:', { id: personalSpace.id });
}

if (!businessSpace) {
  businessSpace = service.createSpace({
    name: 'Empresa',
    ownerUserId: defaultUser.id,
  });
  logger.info('Espaço Empresarial criado:', { id: businessSpace.id });
}

// 6. Inicializa McpGateway com todos os serviços acoplados
const gateway = new McpGateway({
  service,
  catalogService,
  attachmentService,
  lgpdService,
  metrics,
});

// 7. Popula Dados Demonstrativos no Espaço Pessoal se estiver vazio
const personalContext = {
  userId: defaultUser.id,
  spaceId: personalSpace.id,
  role: Roles.OWNER,
  membership: { status: 'active', role: Roles.OWNER },
};

const existingAccounts = service.listAccounts(personalContext);
if (existingAccounts.length === 0) {
  logger.info('Populando dados demonstrativos no Espaço Pessoal...');

  try {
    const nubank = catalogService.searchInstitutions({ query: 'Nubank', limit: 1 })?.institutions?.[0];
    const itau = catalogService.searchInstitutions({ query: 'Itaú', limit: 1 })?.institutions?.[0];
    const inter = catalogService.searchInstitutions({ query: 'Inter', limit: 1 })?.institutions?.[0];

    const accNubankRes = await gateway.executeTool('create_account', {
      name: 'Nubank Conta',
      account_type: 'checking',
      opening_balance: 11230,
      institution_id: nubank?.id,
    }, personalContext);
    const accNubankId = accNubankRes.data?.id || accNubankRes.id;

    const accItauRes = await gateway.executeTool('create_account', {
      name: 'Itaú Personnalité',
      account_type: 'checking',
      opening_balance: 5920.20,
      institution_id: itau?.id,
    }, personalContext);
    const accItauId = accItauRes.data?.id || accItauRes.id;

    await gateway.executeTool('create_account', {
      name: 'Banco Inter Investimentos',
      account_type: 'investment',
      opening_balance: 1300,
      institution_id: inter?.id,
    }, personalContext);

    const catSalarioRes = await gateway.executeTool('create_category', {
      name: 'Salário & Proventos',
      color: '#138A63',
      is_income: true,
    }, personalContext);
    const catSalarioId = catSalarioRes.data?.id || catSalarioRes.id;

    const catMercadoRes = await gateway.executeTool('create_category', {
      name: 'Supermercado & Alimentação',
      color: '#D99019',
      is_income: false,
    }, personalContext);
    const catMercadoId = catMercadoRes.data?.id || catMercadoRes.id;

    const catMoradiaRes = await gateway.executeTool('create_category', {
      name: 'Moradia & Contas Fixas',
      color: '#123047',
      is_income: false,
    }, personalContext);
    const catMoradiaId = catMoradiaRes.data?.id || catMoradiaRes.id;

    await gateway.executeTool('create_category', {
      name: 'Lazer & Restaurantes',
      color: '#820AD1',
      is_income: false,
    }, personalContext);

    await gateway.executeTool('create_budget', {
      category_name: 'Supermercado & Alimentação',
      amount: 2000,
    }, personalContext);

    await gateway.executeTool('metas_create', {
      name: 'Reserva de Emergência',
      goal_type: 'savings',
      target_amount: 20000,
      start_date: '2026-01-01',
      deadline: '2026-12-31',
    }, personalContext);

    const today = new Date().toISOString().split('T')[0];
    await gateway.executeTool('create_transaction', {
      account_id: accItauId,
      category_id: catSalarioId,
      amount: 9800,
      is_income: true,
      paid: true,
      date: today,
      description: 'Salário Mensal Vitor',
    }, personalContext);

    await gateway.executeTool('create_transaction', {
      account_id: accNubankId,
      category_id: catMercadoId,
      amount: 450,
      is_income: false,
      paid: true,
      date: today,
      description: 'Compras Supermercado',
    }, personalContext);

    await gateway.executeTool('create_transaction', {
      account_id: accNubankId,
      category_id: catMoradiaId,
      amount: 2800,
      is_income: false,
      paid: true,
      date: today,
      description: 'Aluguel e Condomínio',
    }, personalContext);

    logger.info('Dados demonstrativos populados com sucesso no Espaço Pessoal.');
  } catch (seedErr) {
    logger.error('Aviso: Erro ao popular dados demonstrativos:', seedErr);
  }
}

const rateLimiter = createRateLimiter({ userIpLimit: 120, windowMs: 60000 });

// 8. Cria o Servidor HTTP
const server = http.createServer((req, res) => {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', req.headers.origin || '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Space-Id, Cache-Control, Accept');
  res.setHeader('Access-Control-Allow-Credentials', 'true');

  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    res.end();
    return;
  }

  // Rate Limiting
  rateLimiter(req, res, async () => {
    try {
      const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);

      // Resolução de Espaço e Autenticação
      const headerSpace = req.headers['x-space-id'];
      let targetSpaceId = personalSpace.id;

      if (headerSpace === 'Empresa' || headerSpace === businessSpace.id) {
        targetSpaceId = businessSpace.id;
      } else if (headerSpace && headerSpace !== 'Pessoal') {
        const found = db.prepare('SELECT id FROM spaces WHERE id = ?').get(headerSpace);
        if (found) {
          targetSpaceId = found.id;
        }
      }

      const authContext = {
        userId: defaultUser.id,
        spaceId: targetSpaceId,
        requestId: randomUUID(),
        role: Roles.OWNER,
        membership: {
          id: `mem_${defaultUser.id}_${targetSpaceId}`,
          spaceId: targetSpaceId,
          userId: defaultUser.id,
          role: Roles.OWNER,
          status: 'active',
        },
      };

      // Rota de Informações de Autenticação / Espaços
      if (req.method === 'GET' && url.pathname === '/api/v1/auth/me') {
        res.setHeader('Content-Type', 'application/json');
        res.statusCode = 200;
        res.end(
          JSON.stringify({
            ok: true,
            data: {
              user: {
                id: defaultUser.id,
                name: defaultUser.name,
                email: defaultUser.email,
              },
              spaces: [
                { id: personalSpace.id, name: 'Pessoal' },
                { id: businessSpace.id, name: 'Empresa' },
              ],
              activeSpaceId: targetSpaceId,
            },
          }),
        );
        return;
      }

      // Leitura de Body para POST/PUT
      let body = null;
      if (req.method === 'POST' || req.method === 'PUT') {
        const buffers = [];
        for await (const chunk of req) {
          buffers.push(chunk);
        }
        const rawBody = Buffer.concat(buffers).toString('utf8');
        if (rawBody.trim()) {
          try {
            body = JSON.parse(rawBody);
          } catch {
            res.statusCode = 400;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ ok: false, error: { code: 'INVALID_JSON', message: 'JSON malformado.' } }));
            return;
          }
        }
      }

      // Execução via McpHttpTransport
      const result = await executeMcpHttpRequest(gateway, {
        method: req.method,
        path: url.pathname + url.search,
        body,
        authContext,
      });

      res.statusCode = result.status;
      if (result.headers) {
        for (const [k, v] of Object.entries(result.headers)) {
          res.setHeader(k, v);
        }
      }
      if (!res.getHeader('Content-Type')) {
        res.setHeader('Content-Type', 'application/json');
      }

      res.end(typeof result.body === 'string' ? result.body : JSON.stringify(result.body));
    } catch (err) {
      logger.error('Erro ao processar requisição HTTP:', err);
      res.statusCode = 500;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ ok: false, error: { code: 'INTERNAL_ERROR', message: err.message } }));
    }
  });
});

server.listen(PORT, () => {
  console.log(`\n======================================================`);
  console.log(`  🌊 MoneyFlow Gateway & Servidor API Ativo!`);
  console.log(`======================================================`);
  console.log(`  🌐 URL da API:        http://localhost:${PORT}`);
  console.log(`  📦 Banco SQLite:      ${DB_PATH}`);
  console.log(`  👤 Usuário Padrão:    ${defaultUser.name} (${defaultUser.email})`);
  console.log(`  🏢 Espaço Pessoal:    ${personalSpace.id} (Nome: Pessoal)`);
  console.log(`  🏢 Espaço Empresa:    ${businessSpace.id} (Nome: Empresa)`);
  console.log(`  🛠️  Ferramentas MCP:   ${gateway.getToolNames().length} disponíveis`);
  console.log(`======================================================\n`);
});
