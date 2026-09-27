# Runbook: Atendimento às Solicitações de Titulares (LGPD / Privacidade)

## 1. Visão Geral
Em conformidade com a Lei Geral de Proteção de Dados (Lei nº 13.709/2018), em especial os Artigos 18 (direitos do titular), o MoneyFlow provê fluxos autenticados e auditáveis para:
1. **Direito de Acesso e Portabilidade (Art. 18, II e V):** Exportação estruturada e interoperável dos dados do espaço do titular.
2. **Direito de Eliminação e Anonimização (Art. 18, IV e VI):** Exclusão lógica/física ou anonimização irreversível dos dados e anexos, mantendo recibo de evidência em auditoria append-only.

---

## 2. Fluxo 1: Exportação de Dados do Titular (Portabilidade)

### Permissão Requerida
- Papel `admin` ou `owner` (`space:update`).
- Usuários com papéis `viewer` ou `editor` não possuem autorização para exportar o conjunto total de dados do espaço.

### Execução via API HTTP
```bash
curl -X GET "http://localhost:3000/api/v1/spaces/{spaceId}/lgpd/export" \
  -H "Authorization: Bearer <TOKEN_ADMIN_OU_OWNER>"
```

### Dados Exportados no Payload
- Metadados do Espaço (`spaces`)
- Membros e usuários vinculados (`space_members`, `users`)
- Contas bancárias e saldos (`accounts`)
- Cartões de crédito e faturas (`credit_cards`, `credit_card_invoices`)
- Categorias e tags (`categories`, `tags`)
- Transações financeiras (`transactions`)
- Metas e cofrinhos (`goals`, `piggy_banks`)
- Metadados de anexos privados (`attachments`)
- Trilha de auditoria append-only (`audit_logs`)

### Evidência de Auditoria
A execução gera automaticamente um evento append-only:
- `action`: `lgpd.export`
- `entityType`: `spaces`
- `entityId`: `{spaceId}`
- `newData`: `{ exportId, exportedAt, totalRecords }`

---

## 3. Fluxo 2: Eliminação e Anonimização de Dados (Direito ao Esquecimento)

### Permissão Requerida
- Restrito exclusivamente ao **proprietário (`owner`)** do espaço (`space:delete`).
- Exige texto de confirmação explícito: `"CONFIRMO_EXCLUSAO_DEFINITIVA"`.

### Modos Disponíveis
1. **`anonymize` (padrão):**
   - Substitui descrições de lançamentos por `'DADO_PESSOAL_ANONIMIZADO_LGPD'`.
   - Limpa anotações e nomes de recebedores/pagadores (`payee = NULL, notes = NULL`).
   - Renomeia contas para nomes genéricos (`Conta Anonimizada <hash>`).
   - Apaga arquivos físicos de anexos no disco e marca `deleted_at`.
   - Marca o espaço como arquivado e anonimizado.
   - Gera evento de auditoria `lgpd.anonymize`.

2. **`hard_delete` (exclusão física total):**
   - Exclui fisicamente todos os arquivos de anexos em disco.
   - Executa `DELETE` em cascata em todas as tabelas do espaço (`transactions`, `accounts`, `credit_cards`, `goals`, `piggy_banks`, `attachments`, `spaces`).
   - Registra o recibo de evidência final com `action: 'lgpd.deletion'`.

### Execução via API HTTP
```bash
curl -X POST "http://localhost:3000/api/v1/spaces/{spaceId}/lgpd/delete" \
  -H "Authorization: Bearer <TOKEN_OWNER>" \
  -H "Content-Type: application/json" \
  -d '{
    "confirmation": "CONFIRMO_EXCLUSAO_DEFINITIVA",
    "mode": "anonymize"
  }'
```

---

## 4. Retenção de Anexos
- Conforme implementado na Fase 6, cada espaço possui política de retenção configurável em `attachment_retention_policies` (padrão: 30 dias).
- Anexos expirados são limpos periodicamente pelo processo `purgeExpiredAttachments`, que remove arquivos físicos e registra eventos `attachment.expire` na auditoria.
