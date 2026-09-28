# ==============================================================================
# MoneyFlow - Dockerfile Multi-Stage de Produção (Node.js 22 + SQLite Nativo)
# Compatível com VPS, EasyPanel, Coolify, Docker Compose e Kubernetes
# ==============================================================================

# ------------------------------------------------------------------------------
# Estágio 1: Build do Frontend (Vite + React + Tailwind + Nivo/Recharts)
# ------------------------------------------------------------------------------
FROM node:22-alpine AS frontend-builder

WORKDIR /app/frontend

# Copia manifestos de dependência do frontend para cache eficiente de camadas
COPY frontend/package*.json ./
RUN npm ci || npm install

# Copia código-fonte do frontend e executa build de produção
COPY frontend/ ./
RUN npm run build

# ------------------------------------------------------------------------------
# Estágio 2: Imagem Final de Execução (Runtime Leve & Seguro)
# ------------------------------------------------------------------------------
FROM node:22-alpine AS runner

# Instala curl para healthcheck do Docker / EasyPanel
RUN apk add --no-cache curl

WORKDIR /app

ENV NODE_ENV=production \
    PORT=3001 \
    DB_PATH=/app/.data/moneyflow.db

# Copia manifesto raiz
COPY package.json ./

# Copia código-fonte do backend
COPY src/ ./src/

# Copia documentação e catálogo canônico de 150 instituições bancárias
# Cria link simbólico sem acento para garantir resolução 100% resiliente em qualquer locale Linux
COPY Documentação/ ./Documentação/
RUN ln -s "/app/Documentação" "/app/Documentacao" 2>/dev/null || true

# Copia os artefatos compilados do frontend gerados no Estágio 1
COPY --from=frontend-builder /app/frontend/dist ./frontend/dist

# Cria diretório de dados persistentes para SQLite (.data)
RUN mkdir -p /app/.data && chmod 777 /app/.data

# Declara volume persistente para banco SQLite, logos e anexos
VOLUME ["/app/.data"]

# Expõe a porta do servidor unificado (API + SPA)
EXPOSE 3001

# Healthcheck do container integrado à rota /api/v1/health
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD curl -f http://localhost:3001/api/v1/health || exit 1

# Inicializa o servidor HTTP nativo
CMD ["node", "src/server.js"]
