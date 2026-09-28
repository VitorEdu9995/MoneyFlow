# 🚀 Guia de Deploy do MoneyFlow no EasyPanel (VPS)

Este documento descreve passo a passo como realizar o deploy do **MoneyFlow** em qualquer VPS utilizando o **EasyPanel**.

---

## 📌 1. Visão Geral da Arquitetura em Produção

O MoneyFlow foi preparado como um **Monolito Elegante em Container Único**:
- **Frontend SPA (React 19 + Vite + Tailwind):** Compilado em HTML/JS/CSS estáticos otimizados.
- **Backend HTTP Nativo (Node.js 22):** Serve a API REST, o protocolo MCP (Model Context Protocol), o streaming de logos/anexos e os arquivos estáticos do frontend na mesma porta (`3001`).
- **Banco de Dados (SQLite com WAL):** Armazenado no diretório `/app/.data/moneyflow.db`.
- **Zero Dependências Pesadas:** Não requer containers separados para Nginx, Redis ou PostgreSQL. Toda a aplicação sobe em uma única instância com consumo médio de apenas **~100MB a 180MB de RAM**.

---

## 🛠️ 2. Passo a Passo no EasyPanel

### Passo 1: Criar um Projeto e Serviço
1. Acesse o seu painel **EasyPanel** na VPS (geralmente em `https://seu-ip:3000` ou seu subdomínio configurado).
2. Clique no seu Projeto (ex: `Financeiro` ou crie um novo).
3. Clique em **+ Service** e selecione o tipo **App** (Standard App).
4. Defina o nome do serviço como: `moneyflow`.

---

### Passo 2: Conectar ao Repositório GitHub
Na aba **Source** (Origem do Código):
1. **Source Type:** Selecione `GitHub` (ou `Git Repository`).
2. **Repository:** Informe o repositório do MoneyFlow (ex: `seu-usuario/MoneyFlow` ou a URL do Git).
3. **Branch:** Defina como `master` (ou `main`).
4. **Auto Deploy:** Ative caso queira que novos commits na branch realizem deploy automático.

---

### Passo 3: Configurar o Método de Build (Dockerfile)
Na aba **Build**:
1. **Build Type:** Selecione obrigatoriamente **`Dockerfile`**.
   > ⚠️ **Importante:** O EasyPanel suporta *Nixpacks*, porém o MoneyFlow utiliza `node:sqlite` nativo que requer **Node.js >= 22.5.0**. Ao escolher `Dockerfile`, o EasyPanel executará o `Dockerfile` multi-stage do repositório baseado em `node:22-alpine`, garantindo a versão exata do Node e todas as dependências.
2. **Dockerfile Path:** Deixe o padrão (`Dockerfile` na raiz).

---

### Passo 4: Mapear a Porta da Aplicação
Na aba **Ports**:
1. O servidor nativo do MoneyFlow escuta por padrão na porta **`3001`**.
2. No EasyPanel, configure:
   - **Container Port:** `3001`
   - O EasyPanel conectará o Traefik à porta `3001` automaticamente.

---

### Passo 5: Mapear o Volume Persistente (ESSENCIAL PARA SQLITE)
> 🚨 **Atenção Máxima:** Como o MoneyFlow utiliza SQLite e armazenamento local de logos e comprovantes, é **indispensável** configurar um volume persistente. Sem isso, a cada redeploy ou atualização o banco de dados voltará ao estado inicial.

Na aba **Mounts** (ou **Volumes**):
1. Clique em **+ Add Mount**.
2. **Type:** `Volume`.
3. **Mount Path (dentro do container):** `/app/.data`
4. **Volume Name:** `moneyflow-data` (ou o nome gerado pelo EasyPanel).
5. Salve as alterações.

---

### Passo 6: Variáveis de Ambiente (Opcional)
Na aba **Environment**:
As variáveis possuem valores padrão inteligentes, mas você pode definir explicitamente:
```env
NODE_ENV=production
PORT=3001
DB_PATH=/app/.data/moneyflow.db
```

---

### Passo 7: Configurar Domínio e SSL
Na aba **Domains**:
1. Adicione o seu domínio ou subdomínio (ex: `moneyflow.suaempresa.com.br`).
2. Certifique-se de que os registros DNS (tipo `A`) do seu domínio apontam para o IP da VPS.
3. O EasyPanel emitirá o certificado **SSL Let's Encrypt (HTTPS)** de forma 100% automatizada.

---

### Passo 8: Deploy Inicial
1. Clique no botão **Deploy** no canto superior direito.
2. Acompanhe a aba **Deployments / Logs**.
3. O build executará:
   - Instalação e compilação do frontend Vite;
   - Montagem do runtime leve Node 22 Alpine;
   - Inicialização do servidor unificado com migrações SQLite automáticas;
   - Carga do catálogo de 150 logos bancários canônicos.

---

## 🔍 3. Verificação de Saúde e Monitoramento

Uma vez publicado, você pode verificar o funcionamento via navegador ou `curl`:

1. **Healthcheck da API:**
   ```bash
   GET https://moneyflow.seu-dominio.com.br/api/v1/health
   ```
   Retorno esperado:
   ```json
   {
     "status": "healthy",
     "timestamp": "2026-09-28T...",
     "database": "connected",
     "spacesCount": 2,
     "institutionsCatalogCount": 150,
     "uptimeSeconds": 42
   }
   ```

2. **Acesso à Interface Web:**
   - Acesse `https://moneyflow.seu-dominio.com.br/`
   - O dashboard carregará imediatamente com o usuário padrão **Vitor** e os espaços **Pessoal** e **Empresa** criados.
   - A Landing page explicativa e institucional estará disponível em `/landing` ou `/sobre`.

---

## 💾 4. Rotina de Backup do Banco de Dados

Para efetuar backup do banco de dados em produção:
1. No EasyPanel ou via SSH na VPS, o arquivo reside no volume Docker mapeado (ex: `/var/lib/docker/volumes/.../_data/moneyflow.db`).
2. Como o banco opera em modo WAL (`PRAGMA journal_mode = WAL;`), é seguro copiar o arquivo `moneyflow.db` mesmo com o servidor ativo.
3. Para um backup atômico via comando dentro do container:
   ```bash
   docker exec -it <container_id> node -e "const { DatabaseSync } = require('node:sqlite'); const db = new DatabaseSync('/app/.data/moneyflow.db'); db.exec('VACUUM INTO \"/app/.data/backup.db\";');"
   ```
