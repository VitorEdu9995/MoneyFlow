import http from 'node:http';
import path from 'node:path';
import fs from 'node:fs';
import { randomUUID } from 'node:crypto';

// Carrega variáveis do arquivo .env automaticamente se existir
if (fs.existsSync(path.join(process.cwd(), '.env'))) {
  try {
    process.loadEnvFile(path.join(process.cwd(), '.env'));
  } catch {
    // Continua sem falhar
  }
}

import { createDatabase, runMigrations } from './db/index.js';
import { SpaceIsolationService } from './services/spaceIsolationService.js';
import { InstitutionCatalogService } from './services/institutionCatalogService.js';
import { AttachmentService } from './services/attachmentService.js';
import { LgpdService } from './services/lgpdService.js';
import { SettingsService } from './services/settingsService.js';
import { EvolutionApiService } from './services/evolutionApiService.js';
import { GeminiAudioService } from './services/geminiAudioService.js';
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
const MAX_PAYLOAD_BYTES = 28 * 1024 * 1024; // 28MB conforme especificação de anexos
const FRONTEND_DIST = path.join(process.cwd(), 'frontend', 'dist');

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml; charset=utf-8',
  '.ico': 'image/x-icon',
  '.webp': 'image/webp',
  '.wav': 'audio/wav',
  '.mp3': 'audio/mpeg',
  '.ogg': 'audio/ogg',
};

if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

// 1. Inicializa SQLite, WAL e Busy Timeout
logger.info('Iniciando banco de dados SQLite...', { dbPath: DB_PATH });
const db = createDatabase(DB_PATH);
db.exec('PRAGMA busy_timeout = 5000;'); // Espera até 5s em concorrência para evitar SQLITE_BUSY

const appliedMigrations = runMigrations(db);
if (appliedMigrations.length > 0) {
  logger.info('Migrações aplicadas com sucesso:', { count: appliedMigrations.length, migrations: appliedMigrations });
}

// 2. Inicializa Serviços de Domínio e Integrações
const metrics = new OperationalMetrics();
const service = new SpaceIsolationService(db, { metrics });
const attachmentService = new AttachmentService(db, service, { metrics });
const lgpdService = new LgpdService(db, service, attachmentService);
const catalogService = new InstitutionCatalogService(db);
const settingsService = new SettingsService(db);
const evolutionService = new EvolutionApiService(db, settingsService);
const geminiAudioService = new GeminiAudioService(db, settingsService);

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
  settingsService,
  evolutionService,
  geminiAudioService,
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

const rateLimiter = createRateLimiter({ userIpLimit: 200, windowMs: 60000 });

// 8. Cria o Servidor HTTP
const server = http.createServer((req, res) => {
  // Cabeçalhos Globais de Segurança e CORS
  res.setHeader('Access-Control-Allow-Origin', req.headers.origin || '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Space-Id, Cache-Control, Accept');
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');

  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    res.end();
    return;
  }

  // Safe URL Parsing independente de cabeçalho Host
  const url = new URL(req.url || '/', 'http://127.0.0.1');

  // 8.1 Health check endpoints (isento de rate limiting para não bloquear liveness probes)
  if (req.method === 'GET' && (url.pathname === '/api/v1/health' || url.pathname === '/healthz')) {
    const healthData = JSON.stringify({
      status: 'ok',
      uptime: Math.floor(process.uptime()),
      timestamp: new Date().toISOString(),
      db: 'connected',
      version: '0.1.0',
    });
    res.statusCode = 200;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Content-Length', Buffer.byteLength(healthData, 'utf8'));
    res.end(healthData);
    return;
  }

  // Rate Limiting para endpoints de negócio e API
  rateLimiter(req, res, async () => {
    try {
      // 8.2 Resolução Dinâmica de Usuário
      let currentUser = defaultUser;
      const authHeader = req.headers['authorization'];
      if (authHeader && authHeader.startsWith('Bearer ')) {
        const tokenVal = authHeader.substring(7).trim();
        if (tokenVal && tokenVal !== 'dummy-token') {
          const userFromDb = db.prepare('SELECT * FROM users WHERE id = ? OR email = ?').get(tokenVal, tokenVal);
          if (userFromDb) {
            currentUser = userFromDb;
          }
        }
      }

      // 8.3 Resolução Dinâmica de Espaço (Por ID ou Nome)
      const headerSpace = req.headers['x-space-id'];
      let targetSpaceId = personalSpace.id;

      if (headerSpace) {
        const found = db.prepare('SELECT id FROM spaces WHERE id = ? OR LOWER(name) = LOWER(?)').get(headerSpace, headerSpace);
        if (found) {
          targetSpaceId = found.id;
        }
      }

      // Busca membership ou define owner
      const membership = service.getMembership(targetSpaceId, currentUser.id) || {
        id: `mem_${currentUser.id}_${targetSpaceId}`,
        spaceId: targetSpaceId,
        userId: currentUser.id,
        role: Roles.OWNER,
        status: 'active',
      };

      const authContext = {
        userId: currentUser.id,
        spaceId: targetSpaceId,
        requestId: randomUUID(),
        role: membership.role || Roles.OWNER,
        membership,
      };

      // 8.4 Rota de Autenticação / Espaços Ativos
      if (req.method === 'GET' && url.pathname === '/api/v1/auth/me') {
        const userSpaces = db
          .prepare(
            `SELECT s.id, s.name, s.currency, s.timezone, m.role
             FROM spaces s
             JOIN space_members m ON m.space_id = s.id
             WHERE m.user_id = ? AND m.status = 'active'`,
          )
          .all(currentUser.id);

        const authBody = JSON.stringify({
          ok: true,
          data: {
            user: {
              id: currentUser.id,
              name: currentUser.name,
              email: currentUser.email,
            },
            spaces: userSpaces.length > 0 ? userSpaces : [{ id: personalSpace.id, name: 'Pessoal' }],
            activeSpaceId: targetSpaceId,
          },
        });

        res.statusCode = 200;
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.setHeader('Content-Length', Buffer.byteLength(authBody, 'utf8'));
        res.end(authBody);
        return;
      }

      // 8.5 Entrega Direta de Logos em Binário para Tags <img>
      const logoMatch = url.pathname.match(/^\/api\/v1\/catalog\/logos\/([^/]+)$/);
      const isJsonPreferred = req.headers['accept']?.includes('application/json');
      if (req.method === 'GET' && logoMatch && !isJsonPreferred) {
        const assetId = decodeURIComponent(logoMatch[1]);
        try {
          const logoAsset = await catalogService.getLogoAssetContent(assetId);
          res.statusCode = 200;
          const mime = logoAsset.format === 'svg' ? 'image/svg+xml; charset=utf-8' : logoAsset.mimeType;
          res.setHeader('Content-Type', mime);
          res.setHeader('Content-Length', logoAsset.buffer.length);
          res.setHeader('ETag', `"${logoAsset.sha256}"`);
          res.setHeader('Cache-Control', 'public, max-age=86400, immutable');
          res.end(logoAsset.buffer);
          return;
        } catch {
          const asset = catalogService.getLogoAsset(assetId);
          if (asset && asset.source_url) {
            try {
              const fetchRes = await fetch(asset.source_url);
              if (fetchRes.ok) {
                const arrayBuffer = await fetchRes.arrayBuffer();
                const buffer = Buffer.from(arrayBuffer);
                const fullPath = path.join(process.cwd(), '.data', asset.storage_key);
                const parentDir = path.dirname(fullPath);
                if (!fs.existsSync(parentDir)) {
                  fs.mkdirSync(parentDir, { recursive: true });
                }
                fs.writeFileSync(fullPath, buffer);
                res.statusCode = 200;
                const mime = asset.format === 'svg' ? 'image/svg+xml; charset=utf-8' : asset.mime_type;
                res.setHeader('Content-Type', mime);
                res.setHeader('Content-Length', buffer.length);
                res.setHeader('Cache-Control', 'public, max-age=86400, immutable');
                res.end(buffer);
                return;
              }
            } catch {}
          }
          res.statusCode = 404;
          const errBody = JSON.stringify({ ok: false, error: { code: 'NOT_FOUND', message: 'Logo não encontrado.' } });
          res.setHeader('Content-Type', 'application/json; charset=utf-8');
          res.setHeader('Content-Length', Buffer.byteLength(errBody, 'utf8'));
          res.end(errBody);
          return;
        }
      }

      // 8.6 Processamento de Requisições da API
      if (url.pathname.startsWith('/api/')) {
        let body = null;
        if (req.method === 'POST' || req.method === 'PUT') {
          const buffers = [];
          let totalBytes = 0;

          for await (const chunk of req) {
            totalBytes += chunk.length;
            if (totalBytes > MAX_PAYLOAD_BYTES) {
              res.statusCode = 413;
              const errPayload = JSON.stringify({
                ok: false,
                error: { code: 'PAYLOAD_TOO_LARGE', message: 'Payload excede o limite máximo permitido de 28MB.' },
              });
              res.setHeader('Content-Type', 'application/json; charset=utf-8');
              res.setHeader('Content-Length', Buffer.byteLength(errPayload, 'utf8'));
              res.end(errPayload);
              req.destroy();
              return;
            }
            buffers.push(chunk);
          }

          const rawBody = Buffer.concat(buffers).toString('utf8');
          if (rawBody.trim()) {
            try {
              body = JSON.parse(rawBody);
            } catch {
              res.statusCode = 400;
              const errJson = JSON.stringify({ ok: false, error: { code: 'INVALID_JSON', message: 'JSON malformado.' } });
              res.setHeader('Content-Type', 'application/json; charset=utf-8');
              res.setHeader('Content-Length', Buffer.byteLength(errJson, 'utf8'));
              res.end(errJson);
              return;
            }
          }
        }

        const result = await executeMcpHttpRequest(gateway, {
          method: req.method,
          path: url.pathname + url.search,
          body,
          authContext,
        });

        // Suporte a download de anexos binários via ?raw=1
        const attachmentDownloadMatch = url.pathname.match(/^\/api\/v1\/attachments\/([^/]+)\/download$/);
        if (req.method === 'GET' && attachmentDownloadMatch && url.searchParams.get('raw') === '1' && result.status === 200 && result.body?.data?.content_base64) {
          const attBuffer = Buffer.from(result.body.data.content_base64, 'base64');
          res.statusCode = 200;
          res.setHeader('Content-Type', result.body.data.mime_type || 'application/octet-stream');
          res.setHeader('Content-Length', attBuffer.length);
          res.setHeader('Content-Disposition', `attachment; filename="${result.body.data.file_name}"`);
          res.end(attBuffer);
          return;
        }

        // Suporte a streaming/download de áudio gerado pelo Gemini TTS
        const audioDownloadMatch = url.pathname.match(/^\/api\/v1\/media\/audio\/([^/]+)$/);
        if (req.method === 'GET' && audioDownloadMatch) {
          try {
            const audioId = decodeURIComponent(audioDownloadMatch[1]);
            const audioData = await geminiAudioService.getAudioFile(audioId);
            res.statusCode = 200;
            res.setHeader('Content-Type', audioData.mimeType || 'audio/wav');
            res.setHeader('Content-Length', audioData.buffer.length);
            res.setHeader('Accept-Ranges', 'bytes');
            res.setHeader('Cache-Control', 'public, max-age=86400');
            res.end(audioData.buffer);
            return;
          } catch (err) {
            res.statusCode = 404;
            res.setHeader('Content-Type', 'application/json; charset=utf-8');
            res.end(JSON.stringify({ ok: false, error: { code: 'NOT_FOUND', message: 'Áudio não encontrado.' } }));
            return;
          }
        }

        res.statusCode = result.status;
        if (result.headers) {
          for (const [k, v] of Object.entries(result.headers)) {
            res.setHeader(k, v);
          }
        }
        if (!res.getHeader('Content-Type')) {
          res.setHeader('Content-Type', 'application/json; charset=utf-8');
        }

        const responsePayload = typeof result.body === 'string' ? result.body : JSON.stringify(result.body);
        res.setHeader('Content-Length', Buffer.byteLength(responsePayload, 'utf8'));
        res.end(responsePayload);
        return;
      }

      // 8.7 Servir Frontend Estático se buildado (dist) com Defesa contra Path Traversal
      if (fs.existsSync(FRONTEND_DIST)) {
        const sanitizedRelPath = (url.pathname === '/' ? '/index.html' : url.pathname).replace(/\0/g, '');
        const targetPath = path.resolve(FRONTEND_DIST, '.' + sanitizedRelPath);

        // Previne path traversal verificando se targetPath permanece dentro de FRONTEND_DIST
        if (!targetPath.startsWith(FRONTEND_DIST)) {
          res.statusCode = 403;
          res.setHeader('Content-Type', 'text/plain; charset=utf-8');
          res.end('Acesso proibido.');
          return;
        }

        let fileToServe = targetPath;
        if (!fs.existsSync(fileToServe) || fs.statSync(fileToServe).isDirectory()) {
          fileToServe = path.join(FRONTEND_DIST, 'index.html');
        }

        if (fs.existsSync(fileToServe)) {
          const ext = path.extname(fileToServe).toLowerCase();
          const contentType = MIME_TYPES[ext] || 'application/octet-stream';
          res.statusCode = 200;
          res.setHeader('Content-Type', contentType);
          const stream = fs.createReadStream(fileToServe);
          stream.pipe(res);
          return;
        }
      }

      // 8.8 Fallback Rota Não Encontrada
      res.statusCode = 404;
      const notFoundBody = JSON.stringify({
        ok: false,
        error: {
          code: 'NOT_FOUND',
          message: 'Endpoint não encontrado. Acesse /api/v1/health para verificar a saúde do servidor.',
        },
      });
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.setHeader('Content-Length', Buffer.byteLength(notFoundBody, 'utf8'));
      res.end(notFoundBody);
    } catch (err) {
      logger.error('Erro ao processar requisição HTTP:', err);
      res.statusCode = 500;
      const errBody = JSON.stringify({ ok: false, error: { code: 'INTERNAL_ERROR', message: err.message } });
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.setHeader('Content-Length', Buffer.byteLength(errBody, 'utf8'));
      res.end(errBody);
    }
  });
});

// Tratamento amigável de erro na porta (EADDRINUSE)
server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`\n❌ ERRO: A porta ${PORT} já está em uso por outro processo.`);
    console.error(`   Você pode executar em outra porta definindo a variável PORT:\n   PORT=${PORT + 1} npm start\n`);
  } else {
    console.error('❌ Erro no servidor HTTP:', err);
  }
  process.exit(1);
});

// Captura de Exceções Globais Não Tratadas
process.on('uncaughtException', (err) => {
  logger.error('Exceção não tratada capturada no processo:', err);
});

process.on('unhandledRejection', (reason) => {
  logger.error('Rejeição de Promise não tratada:', reason);
});

// Graceful Shutdown
function shutdown(signal) {
  logger.info(`Recebido ${signal}. Encerrando servidor de forma segura...`);
  server.close(() => {
    try {
      db.exec('PRAGMA wal_checkpoint(TRUNCATE);');
      db.close();
      logger.info('Banco de dados SQLite fechado com segurança.');
    } catch (dbErr) {
      logger.error('Erro ao fechar banco de dados:', dbErr);
    }
    process.exit(0);
  });

  setTimeout(() => {
    logger.warn('Forçando encerramento após timeout de shutdown.');
    process.exit(1);
  }, 5000).unref();
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

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
  console.log(`  🛡️  Segurança:        Rate Limiter, Sniffing Defense e Payload Cap`);
  console.log(`======================================================\n`);
});
