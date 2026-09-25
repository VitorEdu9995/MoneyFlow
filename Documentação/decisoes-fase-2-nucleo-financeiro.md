# Decisões de Arquitetura — Fase 2: Núcleo Financeiro Persistido (ECO-62)

**Data:** 25/09/2026
**Status:** Fechado e Implementado

Este documento registra as decisões técnicas da **Fase 2** do MoneyFlow: persistência
do núcleo financeiro (transferências, ciclo de fatura, parcelamentos, recorrências e
previsões) e a migração idempotente do slice local (MVP em `localStorage`) para o
banco SQLite, sobre a fundação de isolamento multi-espaço da Fase 1 (ECO-61).

---

## 1. O que já existia (Fase 1) vs. o que esta fase adiciona

Contas, cartões, categorias e transações (CRUD básico de criação/leitura) e o schema
de `credit_card_invoices` já existiam desde a migration `001_initial_schema`. Esta
fase (migration `003_financial_core_phase2`) adiciona: `tags`, `transaction_tags`,
`transfers`, `invoice_payments`, `installment_plans`, `recurrences`,
`recurrence_occurrences`, `import_batches` e `import_entities` — e passa a preencher
as colunas `recurrence_id`, `installment_plan_id`, `installment_number` e
`total_installments` de `transactions`, que já existiam mas estavam vazias.

## 2. Transferências Pareadas

- `createTransfer` cria **duas** transações `type = 'transfer'` (uma em cada conta)
  dentro de uma única transação SQL, mais um registro em `transfers` que as vincula.
  Falha em qualquer perna reverte a operação inteira — nunca existe perna órfã.
- `type = 'transfer'` nunca é somado como receita/despesa em `getPeriodSummary`.
- Moedas incompatíveis entre a conta de origem e destino são rejeitadas com
  `CURRENCY_MISMATCH` (novo código de erro).

## 3. Ciclo de Fatura de Cartão

- `computeInvoiceCycle(referenceDate, closingDay, dueDay)` calcula início, fim,
  fechamento e vencimento do ciclo que contém uma data, sempre "clampando" ao último
  dia real do mês (evita estouro em Fevereiro para fechamento configurado nos dias
  29, 30 ou 31).
- `getOrCreateOpenInvoice` resolve ou cria a fatura do ciclo automaticamente.
- `createCardTransaction` (compra/estorno) atualiza `total_charges`/`total_credits`/
  `open_amount` da fatura. Uma cobrança tardia em fatura já `closed`/`paid` a reabre
  automaticamente (`status = 'reopened'`).
- `registerInvoicePayment` cobre pagamento parcial, integral e **excedente**: valor
  pago acima do devido fica registrado como `open_amount` negativo (crédito para a
  próxima fatura) e é exposto como `excessAmount`.
- `uninformInvoicePayment` desfaz um pagamento (exclusão lógica da transação
  associada) e reabre a fatura quando necessário.
- **Idempotência de pagamento:** `registerInvoicePayment` aceita `idempotencyKey`
  opcional com índice único `(space_id, idempotency_key)`. Reenviar a mesma chave
  (ex.: retry de rede) devolve o resultado já processado (`duplicate: true`) em vez
  de duplicar o pagamento — mitiga a classe de bug "pagamento repetido" cobrada nos
  testes adversariais.

## 4. Parcelamentos

- `createInstallmentPlan` distribui `totalAmount` em `installmentsCount` parcelas
  inteiras em centavos: `base = floor(total / count)`, e o resto (`total - base *
  count`) é distribuído 1 centavo por vez nas **primeiras** parcelas. A soma das
  parcelas sempre bate exatamente com o valor total (verificação defensiva em runtime).
- Vencimentos usam `addMonthsClamped`, evitando estouro de mês (ex: parcela com
  vencimento dia 31/01 gera a segunda parcela em 28/02, não em 03/03).

## 5. Recorrências e Previsões

- `createRecurrence` define o modelo (frequência mensal/semanal/anual, valor, conta
  ou cartão, categoria).
- `generateForecastOccurrences` gera (idempotentemente, sem duplicar por data) as
  ocorrências futuras como **previsões** (`status = 'forecast'`) até uma data limite,
  com limite de segurança de 600 ocorrências por chamada.
- `promoteForecastToTransaction` converte uma previsão em lançamento real. Uma
  ocorrência já promovida não pode ser promovida de novo (`OCCURRENCE_ALREADY_PROMOTED`).

## 6. Caixa vs. Competência

- `transaction_date` é a data de competência; `effective_date` + `paid_status = 'paid'`
  (via `setTransactionPaid`) é o evento de caixa. `getPeriodSummary(basis: 'cash' |
  'accrual')` soma cada visão separadamente e nunca as combina como o mesmo evento,
  excluindo sempre `type = 'transfer'`.

## 7. Exclusão com Arquivamento Preferencial

- `deleteAccount`, `deleteCategory` e `deleteCreditCard` calculam o **impacto**
  (contagem de transações/itens/subcategorias/faturas relacionadas) antes de agir:
  havendo qualquer histórico, a entidade é **arquivada** (`archived_at`) e o impacto é
  devolvido ao chamador; sem histórico associado, a exclusão é física.

## 8. Importação Idempotente e Reversível do Slice Local (MVP)

Contrato do payload aceito por `importLocalStorageExport` (definido nesta fase, na
ausência de um schema de `localStorage` documentado no MVP):

```json
{
  "source": "localstorage_mvp",
  "accounts": [{ "localId": "...", "name": "...", "accountType": "checking", "openingBalance": 0 }],
  "categories": [{ "localId": "...", "name": "...", "kind": "expense", "parentLocalId": null }],
  "transactions": [{
    "localId": "...", "type": "expense", "description": "...", "amount": 0,
    "transactionDate": "YYYY-MM-DD", "accountLocalId": "...", "categoryLocalId": "...",
    "observation": null, "tags": []
  }]
}
```

- **Idempotente:** o checksum SHA-256 do payload bruto é a chave de deduplicação
  (`import_batches.checksum`, único por espaço). Reenviar o mesmo export (ex.: usuário
  clica "importar" duas vezes) devolve o resultado já processado sem duplicar contas,
  categorias ou transações.
- **Validado:** linhas sem os campos mínimos, ou que referenciam `accountLocalId`/
  `categoryLocalId` não resolvidos dentro do próprio lote, são contadas em `skipped` e
  nunca inventadas.
- **Reversível:** cada entidade criada é rastreada em `import_entities`.
  `reverseImportBatch` arquiva (contas/categorias) ou exclui logicamente (transações)
  **apenas** as entidades daquele lote, preservando dado de outras origens.
- **Preserva o export original:** `raw_payload` grava o JSON bruto completo, nunca
  mutado, permitindo auditoria/reprocessamento posterior.

## 9. Risco Tratado e Verificação de Segurança Aplicável

Escopo desta fase: camada de persistência e regras de negócio (sem servidor HTTP nem
gateway MCP ainda) — por isso os blocos de `seguranca-app-vibe-coded` sobre upload,
webhook de pagamento, área administrativa e API pública **não se aplicam** (portão
não satisfeito). Os blocos aplicáveis (`tem_banco`, `tem_auth`) foram verificados:

- **SQL Injection:** todas as novas queries usam parâmetros ligados (`?`); os dois
  únicos trechos com interpolação de template (`updateTransaction`, `createRecurrence`)
  interpolam apenas nomes de coluna/tabela vindos de um vocabulário fixo no código
  (nunca de entrada do usuário) — confirmado por revisão manual, sem canal de injeção.
- **Anti-IDOR / isolamento multi-espaço:** toda nova mutação e leitura reaplica o
  padrão da Fase 1 — filtro obrigatório por `space_id` e validação de cross-space
  reference em toda FK nova (`sourceAccountId`, `destinationAccountId`, `creditCardId`
  em parcelamentos/recorrências). Coberto por teste adversarial dedicado
  (transferência para conta de outro espaço → `CROSS_SPACE_REFERENCE_DENIED`, sem
  perna órfã).
- **Deny-by-default:** toda mutação nova chama `requireAuthorization` (direta ou
  transitivamente via um getter que já a chama); nenhum método novo de escrita ficou
  sem checagem de permissão.
- **Duplicação de efeito financeiro (double-spend/double-charge):** tratada
  explicitamente via idempotência de pagamento de fatura e de importação (ver seções
  3 e 8), com teste adversarial cobrindo os dois casos.
- **Fora do escopo desta fase, sinalizado e não resolvido aqui:** autenticação de
  transporte (HTTPS/cookies/rate limiting) e um gateway MCP expondo estas operações
  como ferramentas — ainda não existem nesta camada; ficam para a fase que introduzir
  a interface HTTP/MCP.
