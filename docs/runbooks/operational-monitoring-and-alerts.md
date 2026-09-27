# Runbook: Monitoramento Operacional e Alertas (Fase 6 / ECO-66)

## 1. Visão Geral
O subsistema de observabilidade operacional do MoneyFlow coleta telemetria agregada em memória, sem persistir nem expor informações pessoais, segredos, tokens ou dados de transações.

---

## 2. Endpoint de Status Operacional

- **Rota:** `GET /api/v1/operations/status`
- **Autenticação:** Requer permissão `audit:read` (`admin` ou `owner`).
- **Isolamento de Tenant:** O volume de armazenamento (`storage`) exibido reflete estritamente o espaço autenticado do requisitante. Tentativas não autorizadas retornam `403 FORBIDDEN` sem vazar identificadores (`spaceId`, `userId`, `requestId`).

### Exemplo de Resposta
```json
{
  "ok": true,
  "data": {
    "health": { "status": "ok" },
    "metrics": {
      "uptimeMs": 3600000,
      "api": {
        "requests": 1542,
        "errors4xx": 12,
        "errors5xx": 0,
        "errorRate": 0.0078,
        "latencyMs": { "count": 1542, "average": 14.2, "max": 185 }
      },
      "rateLimits": { "global": 0, "userIp": 1, "attachmentDownloadUrl": 0 },
      "security": { "authorization": 3, "idor": 0 },
      "auditEvents": 420,
      "redactions": 15,
      "storage": { "attachments": 24, "bytes": 15482910, "failures": 0 },
      "operations": {
        "migrationFailures": 0,
        "queueFailures": 0,
        "highLatencies": 0
      },
      "alerts": []
    }
  }
}
```

---

## 3. Catálogo de Alertas e Gatilhos (Thresholds)

| Tipo de Alerta | Severidade | Threshold Padrão | Descrição do Disparo |
|---|---|---|---|
| `idor` | **High** | 1 ocorrência | Tentativa de acesso cross-space ou IDOR detectada. |
| `storage_failure` | **High** | 1 ocorrência | Falha física ao persistir ou remover arquivos de anexos. |
| `migration_failure` | **High** | 1 ocorrência | Falha na execução ou rollback de migrações SQLite. |
| `queue_failure` | **High** | 1 ocorrência | Falha em jobs ou filas de processamento assíncrono. |
| `server_error` | **Warning** | 10 ocorrências | Acúmulo de respostas HTTP 5xx na API. |
| `rate_limit` | **Warning** | 20 ocorrências | Pico de bloqueios de rate limit por IP ou usuário. |
| `authorization` | **Warning** | 10 ocorrências | Rejeições por falta de permissão ou credencial inválida. |
| `redaction` | **Warning** | 20 ocorrências | Alto volume de dados sensíveis redigidos antes do log. |
| `high_latency` | **Warning** | 10 ocorrências | Requisições com latência superior ao limite (ex: 2000ms). |

---

## 4. Procedimento de Ação Diante de Alertas Críticos

1. **Alerta de IDOR / Cross-Space:**
   - Verificar IP e User-Agent nos logs estruturados.
   - Avaliar se a conta de usuário associada foi comprometida.
   - Bloquear a sessão via `revokeSession(tokenHash)` se houver indício de exploração intencional.

2. **Alerta de Falha de Migração (`migration_failure`):**
   - Não tentar subir novas instâncias.
   - Inspecionar a tabela de controle `_migrations`.
   - Executar os testes automatizados (`npm test`) em cópia local do banco para validar idempotência da migration.

3. **Alerta de Storage (`storage_failure`):**
   - Verificar espaço em disco e permissões de escrita em `.data/attachments/`.
   - Limpar arquivos temporários ou expandir o volume de armazenamento.
