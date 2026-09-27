# Runbook: Importação e Manutenção do Catálogo de Instituições e Logos

## Visão Geral
Este runbook documenta os procedimentos para importar, auditar e atualizar o catálogo canônico de instituições financeiras, bandeiras de cartões e logos no MoneyFlow.

## Fontes de Dados
- Planilha de origem: `Documentação/Bancos e Logos/instituicoes_bancarias_com_logo.xlsx`
- Extrator canônico: `Documentação/Bancos e Logos/instituicoes_catalogo.json`
- Importer: `src/ops/catalogImporter.js`
- Serviço: `src/services/institutionCatalogService.js`

## Executando a Importação

### Via Código / Script Node:
```javascript
import { createDatabase, runMigrations } from './src/db/index.js';
import { CatalogImporter } from './src/ops/catalogImporter.js';

const db = createDatabase('moneyflow.db');
runMigrations(db);

const importer = new CatalogImporter(db);
const result = await importer.importCatalog();
console.log('Importação concluída:', result);
```

### Verificação da Idempotência:
Execuções repetidas detectam registros existentes por `source_key` (`ispb:<ISPB>`) e realizam `UPDATE` sem duplicar dados nem alterar IDs determinísticos.

## Rotas de API e MCP

- **MCP Tool:**
  `list_institutions { query?: string }`
- **HTTP REST:**
  - `GET /api/v1/catalog/institutions?query=...&limit=50&offset=0`
  - `GET /api/v1/catalog/institutions/:id`
  - `GET /api/v1/catalog/brands`
  - `GET /api/v1/catalog/logos/:assetId`
  - `POST /api/v1/catalog/institutions/:id/favorite` (body: `{ favorite: boolean }`)
  - `POST /api/v1/catalog/institutions/:id/select`

## Verificação e Testes
Para rodar a suíte completa de testes do catálogo:
```powershell
node --test test/unit/institution_catalog.test.js
node --test test/adversarial/institution_catalog_adversarial.test.js
npm test
```
