# MoneyFlow

Aplicativo de gestão financeira pessoal e empresarial, com **espaços isolados** (ex.: "Pessoal" e
"Empresa"), núcleo financeiro completo (contas, cartões, faturas, parcelas, recorrências,
orçamentos, metas/cofrinhos) e uma **API no formato de ferramentas MCP**, pensada para ser
operada tanto pela interface web quanto por agentes de IA.

> **Versão:** `0.1.0` · **Última atualização deste README:** 21/10/2026 · **Branch principal:** `master`

---

## Sumário

1. [Em que pé está o projeto](#1-em-que-pé-está-o-projeto)
2. [Visão geral da arquitetura](#2-visão-geral-da-arquitetura)
3. [Stack](#3-stack)
4. [Como rodar](#4-como-rodar)
5. [Variáveis de ambiente](#5-variáveis-de-ambiente)
6. [API HTTP](#6-api-http)
7. [Catálogo de ferramentas MCP](#7-catálogo-de-ferramentas-mcp)
8. [Banco de dados e migrations](#8-banco-de-dados-e-migrations)
9. [Frontend](#9-frontend)
10. [Segurança, LGPD e operação](#10-segurança-lgpd-e-operação)
11. [Testes](#11-testes)
12. [Deploy](#12-deploy)
13. [Estrutura de pastas](#13-estrutura-de-pastas)
14. [Documentação de referência](#14-documentação-de-referência)
15. [Limitações conhecidas e próximos passos](#15-limitações-conhecidas-e-próximos-passos)
16. [Fluxo de trabalho e governança](#16-fluxo-de-trabalho-e-governança)

---

## 1. Em que pé está o projeto

**Resumo:** o backend e o frontend estão **funcionais de ponta a ponta para um único usuário**
e o projeto já tem empacotamento Docker para EasyPanel. **Ainda não está pronto para produção
multiusuário**, porque não existe autenticação de verdade (detalhes na
[seção 15](#15-limitações-conhecidas-e-próximos-passos)).

### Situação verificada em 21/10/2026

| Verificação | Resultado |
|---|---|
| `npm test` no último commit (`7027dba`) | ✅ **153 testes, 153 passando**, 0 falhas |
| `npm run build` (validação de sintaxe e migrations do backend) | ✅ OK |
| `npm run build` do frontend (`tsc -b && vite build`) | ✅ OK (aviso de bundle > 500 kB, sem erro) |
| Runtime | Node.js 22 (`node:sqlite` nativo, ainda marcado como experimental pelo Node) |

### Fases entregues

| Fase / entrega | Issue | Status |
|---|---|---|
| Contratos MCP congelados (62 tools no formato Organizze) e gateway | — | ✅ Concluído |
| Fase 1 — Extensões de domínio: atributos personalizados, locais de compra, produtos, compra-pai com itens, devoluções, histórico de preços, matriz de autorização | ECO-61 | ✅ Concluído |
| Fase 2 — Núcleo financeiro persistido: transferências pareadas, ciclo de fatura, parcelamentos, recorrências, caixa × competência, arquivamento, importação idempotente do MVP local, recálculo atômico de saldo | ECO-62 | ✅ Concluído |
| Fase 4 — Relatórios, incluindo fluxo de caixa em Sankey | — | ✅ Concluído |
| Log de auditoria append-only | — | ✅ Concluído |
| Anexos: upload, download, URLs temporárias, exclusão, retenção e purge, endurecimento | ECO-66 S4b/S5 | ✅ Concluído |
| Metas financeiras e cofrinhos, com proteção contra movimentação direta e adulteração de saldo | ECO-66 S4.1 | ✅ Concluído |
| Métricas e alertas operacionais isolados por tenant | ECO-66 S6 | ✅ Concluído |
| LGPD (exportação e exclusão por titular), backup criptografado, runbooks e testes adversariais | ECO-66 S7 | ✅ Concluído |
| Catálogo de 150 instituições bancárias, bandeiras e logos (ADR-0002) | — | ✅ Concluído |
| Frontend completo (todas as telas) integrado ao gateway MCP | — | ✅ Concluído |
| Alinhamento com o Manual de Marca e landing page institucional | — | ✅ Concluído |
| Servidor HTTP nativo com bootstrap de usuário, espaços e dados de demonstração | — | ✅ Concluído |
| Auditoria do servidor: graceful shutdown, `busy_timeout`, path traversal, health check | — | ✅ Concluído |
| Docker multi-stage, docker-compose e guia EasyPanel | — | ✅ Concluído |
| Integrações WhatsApp (Evolution API) e Gemini TTS, com segredos cifrados em AES-256-GCM | — | ✅ Concluído |
| Endurecimento anti-IDOR, zero-storage para WhatsApp e áudio, redação de dados em logs | — | ✅ Concluído |

### Em andamento (não commitado)

Há trabalho local **ainda fora do histórico**: **destinatários de notificação por espaço**.

- Nova migration `012_notification_recipients.js`, com as tabelas `notification_recipients` e
  `notification_recipient_spaces`. Um usuário cadastra vários telefones e cada telefone fica
  autorizado para um ou mais espaços.
- O gateway passa a recusar `whatsapp_send_message` para um número não autorizado no espaço
  atual (403).
- Alterações em `settingsService.js`, `mcpGateway.js`, `integration_tool_schemas.json` e na tela
  `Settings.tsx`, além do teste `test/unit/notification_recipients.test.js`.
- Com essas mudanças, a suíte roda 155 testes. Numa das execuções, **1 teste falhou** e não
  falhou de novo quando os arquivos foram rodados isoladamente. Pode ser instabilidade, e vale
  investigar antes de commitar.

### O que ainda não existe

- **Autenticação real** (login, senha, sessão e emissão de token).
- **Open Finance**: as tools `get_latest_imports`, `get_bank_connections` e
  `get_open_finance_status` estão no contrato, mas são desativadas de propósito
  (`OPEN_FINANCE_DISABLED_TOOLS`). Nenhum agregador foi escolhido.
- **Aplicativo mobile**: hoje só existe a SPA web.
- **CI**: os testes rodam só localmente.

---

## 2. Visão geral da arquitetura

```
┌──────────────────────────┐         ┌──────────────────────────────────────────────┐
│ Frontend (React + Vite)  │  HTTP   │ src/server.js  (http nativo do Node, porta 3001)│
│ SPA servida pelo próprio ├────────►│  • CORS, rate limit, limite de payload (28 MB) │
│ servidor em produção     │         │  • resolve usuário (Bearer) e espaço (X-Space-Id)│
└──────────────────────────┘         │  • serve frontend/dist com proteção de path   │
                                     └───────────────┬──────────────────────────────┘
 Agente de IA / cliente MCP ──── POST /api/v1/mcp/execute
                                                     ▼
                                     ┌──────────────────────────────────────────────┐
                                     │ gateway/mcpHttpTransport.js                  │
                                     │  rotas REST auxiliares + endpoint MCP único  │
                                     └───────────────┬──────────────────────────────┘
                                                     ▼
                                     ┌──────────────────────────────────────────────┐
                                     │ gateway/mcpGateway.js                        │
                                     │  validação de schema → autorização por papel │
                                     │  → limites de lote → handler → auditoria     │
                                     └───────────────┬──────────────────────────────┘
                                                     ▼
            ┌───────────────────────── services/ ─────────────────────────────┐
            │ spaceIsolationService  attachmentService  lgpdService           │
            │ institutionCatalogService  settingsService                      │
            │ evolutionApiService (WhatsApp)  geminiAudioService (TTS)        │
            └───────────────────────────────┬─────────────────────────────────┘
                                            ▼
                          SQLite (node:sqlite, WAL) em .data/moneyflow.db
```

**Princípios que guiam o código:**

- **Isolamento por espaço (tenant).** Todo dado pertence a um `space_id`, e as consultas sempre
  filtram por ele. Referências entre espaços são recusadas com `CROSS_SPACE_REFERENCE_DENIED`,
  que conta como tentativa de IDOR nas métricas.
- **O contexto vem do servidor, nunca do corpo da requisição.** O `authContext` (usuário,
  espaço, papel) é resolvido no servidor e injetado no gateway.
- **Contrato primeiro.** Cada tool tem schema JSON versionado em `src/contracts/`, e testes de
  contrato garantem que os schemas congelados não mudem sem querer.
- **Dinheiro sem ponto flutuante.** Valores em decimal exato ou centavos inteiros, como manda a
  especificação.
- **Arquivar antes de excluir.** A exclusão é lógica sempre que possível, e a auditoria é
  append-only.
- **Zero-storage em integrações.** Mensagens de WhatsApp e áudios do Gemini não são guardados,
  e os segredos ficam cifrados no banco.

---

## 3. Stack

| Camada | Tecnologia |
|---|---|
| Backend | Node.js 22 (ESM), `http` nativo, **sem dependências npm em runtime** |
| Banco | SQLite via `node:sqlite` (`DatabaseSync`), modo WAL, `busy_timeout` de 5 s |
| Criptografia | AES-256-GCM com chave derivada por `scrypt` a partir de `APP_SECRET` |
| Frontend | React 19, React Router 7, Vite 8, Tailwind CSS 4, TypeScript 6 |
| Gráficos | Recharts e Nivo (Sankey) |
| Ícones | lucide-react |
| Lint do frontend | oxlint |
| Testes | `node:test` (runner nativo) |
| Integrações | Evolution API v2 (WhatsApp) e Google Gemini (TTS) |
| Deploy | Docker multi-stage (`node:22-alpine`), docker-compose, EasyPanel |

---

## 4. Como rodar

### Pré-requisitos

- **Node.js 22 ou mais novo** (por causa de `node:sqlite` e `process.loadEnvFile`)
- npm

### Desenvolvimento (backend e frontend separados)

```bash
# 1. Variáveis de ambiente
cp env.example .env              # Linux/macOS
Copy-Item env.example .env       # Windows PowerShell
# Edite o .env. Para dev, use NODE_ENV=development e DB_PATH=.data/moneyflow.db

# 2. Backend (porta 3001). Não há dependências para instalar na raiz.
npm start

# 3. Frontend (Vite com proxy de /api para localhost:3001)
cd frontend
npm install
npm run dev
```

Na primeira inicialização, o servidor:

1. cria o banco SQLite e aplica todas as migrations;
2. importa o catálogo canônico de 150 instituições bancárias;
3. cria o usuário padrão `vitor@moneyflow.local` e os espaços **Pessoal** e **Empresa**;
4. popula o espaço Pessoal com **dados de demonstração**, se ainda não houver contas.

### Produção local (servidor único)

```bash
cd frontend && npm install && npm run build && cd ..
npm start      # serve a API e a SPA em http://localhost:3001
```

### Docker

```bash
docker compose up -d --build
# http://localhost:3001  ·  health: http://localhost:3001/api/v1/health
```

O volume `moneyflow_data` guarda `/app/.data`, onde ficam o banco, os logos e os anexos.

### Scripts

| Onde | Script | O que faz |
|---|---|---|
| raiz | `npm start` / `npm run server` | Sobe o servidor HTTP (`src/server.js`) |
| raiz | `npm test` | Roda a suíte de testes unitários e adversariais |
| raiz | `npm run build` | Valida sintaxe, migrations e registries importando os módulos principais |
| frontend | `npm run dev` | Vite em modo desenvolvimento |
| frontend | `npm run build` | Checagem de tipos e build de produção em `frontend/dist` |
| frontend | `npm run lint` | oxlint |
| frontend | `npm run preview` | Pré-visualiza o build |

---

## 5. Variáveis de ambiente

A referência completa, com comentários, está em [`env.example`](env.example) (com cópia em
`.env.example`). O servidor carrega o `.env` da raiz sozinho, se ele existir.

| Variável | Padrão | Descrição |
|---|---|---|
| `NODE_ENV` | — | `production` ou `development` |
| `PORT` | `3001` | Porta do servidor unificado (API e SPA) |
| `DB_PATH` | `.data/moneyflow.db` | Caminho do arquivo SQLite. Em Docker: `/app/.data/moneyflow.db` |
| `APP_SECRET` | — | Chave mestra (32+ caracteres) para cifrar segredos no banco. **Obrigatória em produção** |
| `GEMINI_API_KEY` | — | Chave do Google AI Studio. Também pode ser definida na tela `/settings` |
| `GEMINI_DEFAULT_VOICE` | `Charon` | Voz do TTS (Charon, Aoede, Puck, Fenrir, Kore) |
| `GEMINI_DEFAULT_MODEL` | `gemini-2.5-flash` | Modelo Gemini |
| `EVOLUTION_API_URL` | — | URL base da Evolution API v2, sem barra no final |
| `EVOLUTION_API_KEY` | — | Global API Key da Evolution |
| `EVOLUTION_INSTANCE_NAME` | `moneyflow` | Instância do WhatsApp na Evolution |

> O `.env` está no `.gitignore`. Nunca commite segredos.

---

## 6. API HTTP

Todas as rotas da API ficam sob `/api/`. As demais rotas servem a SPA, com fallback para
`index.html`.

**Cabeçalhos de contexto:**

- `Authorization: Bearer <id-ou-email-do-usuário>`. Hoje **não é um token de verdade**, veja a
  [seção 15](#15-limitações-conhecidas-e-próximos-passos). Sem esse cabeçalho, ou com
  `dummy-token`, a requisição usa o usuário padrão.
- `X-Space-Id: <id-ou-nome-do-espaço>`. Sem ele, a requisição usa o espaço **Pessoal**.

| Método | Rota | Descrição |
|---|---|---|
| `GET` | `/api/v1/health`, `/healthz` | Health check, sem depender de autenticação |
| `GET` | `/api/v1/auth/me` | Usuário atual e espaços ativos dele |
| `POST` | **`/api/v1/mcp/execute`** | **Endpoint único das tools MCP.** Corpo: `{ "toolName": "...", "args": { ... } }` |
| `GET` | `/api/v1/operations/status` | Status e métricas operacionais |
| `GET` | `/api/v1/attachments/:id/download` | Download temporário de anexo (`?raw=1` devolve o binário) |
| `GET` | `/api/v1/media/audio/:id` | Áudio gerado pelo Gemini |
| `GET` | `/api/v1/spaces/:id/lgpd/export` | Exportação LGPD dos dados do espaço |
| `POST` | `/api/v1/spaces/:id/lgpd/delete` | Exclusão LGPD |
| `GET` | `/api/v1/catalog/institutions` | Catálogo de instituições bancárias |
| `GET` | `/api/v1/catalog/institutions/:id` | Detalhe de uma instituição |
| `POST` | `/api/v1/catalog/institutions/:id/favorite` | Marcar instituição como favorita |
| `POST` | `/api/v1/catalog/institutions/:id/select` | Registrar seleção (ordena por uso) |
| `GET` | `/api/v1/catalog/brands` | Bandeiras de cartão |
| `GET` | `/api/v1/catalog/logos/:id` | Logo (imagem, ou JSON com `Accept: application/json`), com cache |

**Exemplo:**

```bash
curl -X POST http://localhost:3001/api/v1/mcp/execute \
  -H "Content-Type: application/json" \
  -H "X-Space-Id: Pessoal" \
  -d '{"toolName":"get_financial_summary","args":{}}'
```

As respostas seguem um envelope padrão (`src/domain/envelope.js`): sucesso com `data` e `meta`
(incluindo `requestId`), erro com `error.code`, `error.message` e status HTTP correspondente.

---

## 7. Catálogo de ferramentas MCP

**93 tools** ao todo, em três registries.

### 7.1 Contrato congelado: 62 tools (`frozen_tool_schemas.json`)

Compatível com o catálogo MCP da Organizze (`Documentação/catalogo-mcp-organizze.md`).

| Grupo | Tools |
|---|---|
| Contexto e consulta | `get_account_context`, `list_accounts`, `list_credit_cards`, `list_categories`, `list_transactions`, `list_transferences`, `list_budgets`, `list_recurrences`, `list_institutions`, `get_transaction`, `search_transactions`, `resolve_entity`, `load_skill` |
| Faturas | `get_credit_card_invoices`, `get_credit_card_invoice`, `get_invoices_matrix`, `inform_invoice_payment`, `register_invoice_payment`, `uninform_invoice_payment` |
| Relatórios e análises | `get_financial_summary`, `transactions_list_results`, `get_income_vs_expenses`, `get_monthly_overview`, `get_categories_report`, `get_categories_evolution`, `get_tags_report`, `get_budget_summary`, `get_upcoming_bills`, `get_balances`, `get_cashflow_forecast` |
| Inteligência | `find_duplicates`, `find_installments`, `find_subscriptions`, `suggest_categories` |
| Transações | `create_transaction`, `update_transaction`, `delete_transaction`, `set_transaction_paid`, `create_transfer` |
| Lote | `mass_create_transactions` (máx. 100), `mass_update_transactions` (200), `mass_delete_transactions` (500), `add_transactions_tags`, `update_transactions_categories`, `update_transactions_descriptions` (200 cada), `mass_manage_categories` |
| Cadastros | `create/update/delete_account`, `create/update/delete_credit_card`, `create/update/delete_category`, `create/update/delete_budget`, `clone_budgets` |
| Open Finance (desativadas) | `get_latest_imports`, `get_bank_connections`, `get_open_finance_status` |

### 7.2 Extensões: 25 tools (`extension_tool_schemas.json`)

| Grupo | Tools |
|---|---|
| Atributos personalizados | `create_attribute_definition`, `update_attribute_definition`, `archive_attribute_definition`, `set_attribute_values` |
| Compras detalhadas | `create_purchase_location`, `list_purchase_locations`, `create_product`, `merge_products`, `create_purchase_with_items`, `get_purchase`, `create_item_refund`, `get_price_history` |
| Anexos | `anexos_upload`, `anexos_download`, `anexos_download_url`, `anexos_delete`, `anexos_purge_expired` |
| Metas e cofrinhos | `metas_create`, `metas_update`, `metas_delete`, `list_metas`, `get_goal_progress`, `cofrinho_deposit`, `cofrinho_withdraw` |
| Relatórios | `get_cashflow_sankey` |

### 7.3 Integrações: 6 tools (`integration_tool_schemas.json`)

`whatsapp_send_message`, `gemini_generate_audio`, `get_integration_settings`,
`update_integration_settings`, `test_whatsapp_connection`, `test_gemini_connection`

### Pipeline de execução no gateway

1. A tool precisa existir em algum registry e não pode estar desativada.
2. Os `args` são validados contra o JSON Schema.
3. O papel do usuário no espaço é checado (`domain/authorization.js`).
4. Os limites de lote são aplicados (`BATCH_LIMITS`).
5. O handler roda. Tool sem handler devolve `501 NOT_IMPLEMENTED`.
6. A operação vai para a auditoria, e as falhas de segurança viram métrica.

---

## 8. Banco de dados e migrations

SQLite em arquivo único (`.data/moneyflow.db`, fora do git). As migrations ficam em
`src/db/migrations/`, rodam em ordem na inicialização e são idempotentes.

| # | Migration | Conteúdo |
|---|---|---|
| 001 | `initial_schema` | Usuários, espaços, membros, contas, cartões, categorias, transações etc. |
| 002 | `custom_attributes_and_purchases` | Atributos personalizados, locais de compra, produtos, itens e devoluções |
| 003 | `financial_core_phase2` | Transferências pareadas, faturas, parcelamentos e recorrências |
| 004 | `import_real_mvp_format` | Importação idempotente do formato real do MVP (localStorage) |
| 005 | `audit_log_append_only` | Log de auditoria imutável |
| 006 | `attachments` | Anexos |
| 007 | `financial_goals` | Metas e contas-cofrinho |
| 008 | `protect_piggy_bank_internal_transactions` | Proteção das transações internas de cofrinho |
| 009 | `attachment_lifecycle` | Retenção, expiração e purge de anexos |
| 010 | `institution_logo_catalog` | Catálogo de instituições, bandeiras e logos |
| 011 | `system_settings_and_integrations` | Configurações e segredos de integrações (cifrados) |
| 012 | `notification_recipients` | ⚠️ **Não commitada:** destinatários de notificação por espaço |

> Regra do projeto: **nenhuma alteração de schema sem migration**.

---

## 9. Frontend

SPA em `frontend/`, criada com Vite. Em desenvolvimento, o proxy do Vite manda `/api` para
`http://localhost:3001`. Em produção, o próprio backend serve `frontend/dist`.

| Rota | Tela |
|---|---|
| `/` | Dashboard |
| `/accounts` | Contas |
| `/credit-cards` | Cartões de crédito e faturas |
| `/transactions` | Transações |
| `/categories` | Categorias |
| `/budgets` | Orçamentos |
| `/goals` | Metas e cofrinhos |
| `/reports` | Relatórios, incluindo o Sankey de fluxo de caixa |
| `/settings` | Configurações e integrações (WhatsApp, Gemini) |
| `/landing`, `/sobre` | Landing page institucional |

- O cliente de API (`src/api.ts`) chama `POST /api/v1/mcp/execute` e guarda o espaço ativo em
  `localStorage` (`active_space_id`).
- Componentes de destaque: `BrandPicker` e `InstitutionLogoPicker`, que usam o catálogo de logos.
- A identidade visual segue o [Manual de Marca](Documentação/Guia%20de%20Marca/Manual%20de%20marca%20—%20MoneyFlow.md).

---

## 10. Segurança, LGPD e operação

**Já implementado:**

- Isolamento estrito por espaço, com testes adversariais de IDOR e de referências entre espaços.
- Matriz de autorização por papel (`OWNER` e demais papéis em `domain/authorization.js`).
- Rate limiting por cliente (`gateway/httpRateLimiter.js`).
- Limite de payload de 28 MB no servidor, além de um limite próprio para o corpo MCP.
- Proteção contra path traversal ao servir arquivos estáticos.
- Segredos de integração cifrados com AES-256-GCM (chave derivada de `APP_SECRET` via scrypt).
- Redação automática de dados sensíveis nos logs (`utils/logger.js`).
- Zero-storage para mensagens de WhatsApp e áudios gerados.
- Auditoria append-only.
- URLs temporárias protegidas para download de anexos.
- LGPD: exportação e exclusão de dados por espaço (`services/lgpdService.js`).
- Backup criptografado e restauração (`ops/backupRestoreService.js`).
- Métricas operacionais e alertas por tenant (`observability/operationalMetrics.js`).
- Graceful shutdown (SIGTERM e SIGINT) e health check sem dependência de autenticação.

**Runbooks** em `docs/runbooks/`:

- [Backup e restauração](docs/runbooks/backup-and-restore.md)
- [Importação e manutenção do catálogo](docs/runbooks/catalog-import-and-maintenance.md)
- [Atendimento a titulares (LGPD)](docs/runbooks/lgpd-data-subject-requests.md)
- [Monitoramento operacional e alertas](docs/runbooks/operational-monitoring-and-alerts.md)

---

## 11. Testes

```bash
npm test                                              # suíte completa
node --test test/unit/financial_goals.test.js         # um arquivo só
```

- **`test/unit/`** (18 arquivos commitados): migrations, contrato do gateway, registry de tools, núcleo
  financeiro, recálculo de saldo, importação do MVP, relatórios e Sankey, metas, anexos,
  catálogo, LGPD e backup, rate limiter, métricas, redação de logs e integrações.
- **`test/adversarial/`** (7 arquivos): ataques ao gateway MCP, isolamento de espaços, anexos,
  catálogo, núcleo financeiro e auditoria completa de segurança.

Último resultado no commit `7027dba`: **153 de 153 passando**.

---

## 12. Deploy

O guia completo está em [`docs/deploy-easypanel.md`](docs/deploy-easypanel.md). Resumo:

- `Dockerfile` multi-stage: o estágio 1 gera o build do frontend, e o estágio 2 é o runtime
  `node:22-alpine` com `curl` para o healthcheck.
- A imagem inclui `Documentação/`, porque o catálogo canônico de instituições é lido de lá.
  Também é criado um symlink sem acento (`/app/Documentacao`) para evitar problemas de locale.
- Volume persistente em `/app/.data`, porta `3001` e healthcheck em `/api/v1/health`.
- No EasyPanel, configure **`APP_SECRET`** e as chaves das integrações como variáveis de ambiente.

---

## 13. Estrutura de pastas

```
MoneyFlow/
├── src/
│   ├── server.js                 # Entrypoint HTTP: bootstrap, auth/contexto, SPA
│   ├── contracts/                # Schemas JSON das tools e registries
│   ├── db/                       # Conexão SQLite e migrations 001–012
│   ├── domain/                   # Autorização (papéis) e envelope de resposta/erros
│   ├── gateway/                  # Gateway MCP, transporte HTTP e rate limiter
│   ├── services/                 # Regras de negócio e integrações
│   ├── ops/                      # Backup/restore e importador do catálogo
│   ├── observability/            # Métricas operacionais
│   └── utils/                    # Logger com redação
├── frontend/                     # SPA React + Vite + Tailwind
├── test/
│   ├── unit/
│   └── adversarial/
├── docs/
│   ├── adr/                      # Decisões de arquitetura (ADR-0002: catálogo de logos)
│   ├── runbooks/                 # Procedimentos operacionais
│   └── deploy-easypanel.md
├── Documentação/                 # Especificação, decisões de fase, marca e catálogo de bancos
├── Dockerfile
├── docker-compose.yml
├── env.example / .env.example
└── CLAUDE.md                     # Regras para agentes (coordenação via Hefesto)
```

---

## 14. Documentação de referência

| Documento | Conteúdo |
|---|---|
| [Especificação técnica](Documentação/Especificação%20técnica%20—%20Aplicativo%20de%20gestão%20financeira%20pessoal.md) | Requisitos funcionais e regras de negócio (v1.0, 25/09/2026) |
| [Decisões da Fase 1](Documentação/decisoes-fase-1-extensoes.md) | Extensões de domínio (ECO-61) |
| [Decisões da Fase 2](Documentação/decisoes-fase-2-nucleo-financeiro.md) | Núcleo financeiro persistido (ECO-62) |
| [Catálogo MCP Organizze](Documentação/catalogo-mcp-organizze.md) | Origem do contrato congelado de tools |
| [ADR-0002](docs/adr/0002-catalogo-de-logos-de-instituicoes-e-cartoes.md) | Catálogo de instituições, bandeiras e logos |
| [Manual de Marca](Documentação/Guia%20de%20Marca/Manual%20de%20marca%20—%20MoneyFlow.md) | Identidade visual |
| [Deploy EasyPanel](docs/deploy-easypanel.md) | Guia de implantação |

> Decisões, incidentes e lições do projeto também ficam no vault do Hefesto, em
> `Projetos/moneyflow/`.

---

## 15. Limitações conhecidas e próximos passos

### ⚠️ Bloqueadores para produção multiusuário

1. **Não há autenticação.** O header `Authorization: Bearer <valor>` aceita **o ID ou o e-mail**
   do usuário como se fosse um token, sem senha e sem assinatura. Sem header, ou com
   `dummy-token`, o servidor assume o usuário padrão. Qualquer pessoa que alcance a porta 3001
   consegue agir como qualquer usuário.
2. **Quando não há membership, o papel vira `OWNER`.** Em `src/server.js`, se o usuário não é
   membro do espaço indicado em `X-Space-Id`, o contexto recebe papel `OWNER` mesmo assim. Com o
   item 1, isso permite acessar espaços de outras pessoas. As proteções anti-IDOR do gateway
   barram referências entre espaços **dentro de uma requisição**, mas não corrigem um contexto
   que já chega errado.
3. **CORS reflete qualquer `Origin`.**

> Enquanto isso não for resolvido, rode o MoneyFlow só em **uso pessoal**, atrás de uma camada
> de acesso (VPN, autenticação no proxy reverso do EasyPanel etc.).

### Outras limitações

- `node:sqlite` ainda é experimental no Node 22 e gera um warning na inicialização.
- O bundle do frontend passa de 500 kB, e ainda não há code-splitting.
- Open Finance não está implementado.
- Não há pipeline de CI.
- O bootstrap cria um usuário fixo (`vitor@moneyflow.local`) e dados de demonstração.
- Há arquivos duplicados ou legados na raiz: `env.example` e `.env.example` têm praticamente o mesmo
  conteúdo, e `doc_all.txt` é um dump antigo de documentação.

### Próximos passos sugeridos

1. Terminar e commitar os **destinatários de notificação** (migration 012) e investigar o teste
   que falhou uma vez.
2. Implementar **autenticação real** (login, hash de senha, sessão ou JWT) e **negar acesso
   quando não há membership**, em vez de cair em `OWNER`.
3. Restringir o CORS a origens configuradas.
4. Criar CI com `npm test` e o build do frontend.
5. Escolher o provedor de Open Finance (questão em aberto na seção 14 da especificação).
6. Fazer code-splitting do frontend.

---

## 16. Fluxo de trabalho e governança

- Este repositório é coordenado pelo **Hefesto**. Leia o [`CLAUDE.md`](CLAUDE.md) antes de operar.
- As issues ficam no **Linear**, time `ECO`, projeto `MoneyFlow`.
- Cada tarefa ganha uma branch `local/<data>-<slug>`, e o trabalho termina num PR. **O merge é
  decisão humana.**
- Commits, PRs e textos para humanos são escritos em **português do Brasil**, no padrão
  Conventional Commits (`feat`, `fix`, `docs`, `chore`...).
- Proibido: `git push --force`, `git reset --hard`, commitar segredos, mudar schema sem
  migration ou apagar dados de produção.

---

<p align="center"><sub>MoneyFlow · projeto privado</sub></p>
