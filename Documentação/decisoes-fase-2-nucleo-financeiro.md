# Decisões de Arquitetura — Fase 2: Núcleo Financeiro Persistido (ECO-62)

**Data:** 25/09/2026 (revisado em 25/09/2026 — correção de duas pendências)
**Status:** Fechado e Implementado

Este documento registra as decisões técnicas da **Fase 2** do MoneyFlow: persistência
do núcleo financeiro (transferências, ciclo de fatura, parcelamentos, recorrências e
previsões) e a migração idempotente do slice local (MVP em `localStorage`) para o
banco SQLite, sobre a fundação de isolamento multi-espaço da Fase 1 (ECO-61).

**Revisão (mesmo PR, mesmo dia):** a primeira entrega desta fase tinha duas pendências
identificadas na revisão — (1) o contrato de importação do slice local havia sido
**inventado** sem checar o MVP de verdade, e (2) `accounts.current_balance` nunca era
recalculado após uma transação. As seções 8 e 10 abaixo documentam a correção; as
demais seções permanecem como na entrega original.

---

## 1. O que já existia (Fase 1) vs. o que esta fase adiciona

Contas, cartões, categorias e transações (CRUD básico de criação/leitura) e o schema
de `credit_card_invoices` já existiam desde a migration `001_initial_schema`. Esta
fase (migration `003_financial_core_phase2`) adiciona: `tags`, `transaction_tags`,
`transfers`, `invoice_payments`, `installment_plans`, `recurrences`,
`recurrence_occurrences`, `import_batches` e `import_entities` — e passa a preencher
as colunas `recurrence_id`, `installment_plan_id`, `installment_number` e
`total_installments` de `transactions`, que já existiam mas estavam vazias. A
migration `004_import_real_mvp_format` (revisão) amplia `import_batches`
(`imported_cards`, `imported_payments`) e o `CHECK` de `import_entities.entity_type`
para aceitar `'credit_cards'`, sem alterar nenhuma tabela do núcleo financeiro.

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

## 8. Importação Idempotente e Reversível do Slice Local (MVP) — formato REAL

> **Correção pós-entrega:** a versão original desta seção descrevia um contrato
> `{ accounts, categories, transactions }` com `localId` que **nunca existiu** no MVP
> — foi inventado por não ter sido checado o slice local de verdade. Corrigido lendo
> o worktree `local-20260925-iniciar-o-moneyflow-como-aplicat` (`src/main.js` +
> `src/domain/finance.js`), que é o app real que grava em `localStorage`.

Formato REAL persistido por `localStorage.setItem('moneyflow-state-v1',
JSON.stringify(state))`:

```json
{
  "accounts": [{ "id": "account-demo", "name": "...", "institution": "Nubank", "type": "Conta corrente", "balance": 845000, "source": "manual" }],
  "cards": [{ "id": "card-demo", "name": "...", "brand": "Mastercard", "closingDay": 10, "dueDay": 18, "creditLimit": 350000, "paymentAccountId": "account-demo", "source": "manual" }],
  "transactions": [{ "id": "...", "type": "card_purchase", "description": "...", "amount": 12680, "transactionDate": "YYYY-MM-DD", "creditCardId": "card-demo", "category": "Alimentação" }],
  "payments": [{ "id": "...", "invoiceId": "card-demo-2026-09-10", "fromAccountId": "account-demo", "amount": 14530, "paymentDate": "YYYY-MM-DD", "source": "manual", "status": "confirmed" }]
}
```

Diferenças que o contrato hipotético errava:

- **Não existe `categories`.** Categoria é texto livre por transação
  (`transaction.category`); `importLocalStorageExport` resolve-ou-cria a categoria
  por nome (kind inferido: `income` para `type: 'income'`, `expense` para os demais),
  reaproveitando uma categoria já existente no espaço com o mesmo nome+kind em vez de
  duplicar a cada importação.
- **Não existe `localId`.** O `id` de cada entidade já É a identidade local, usado
  diretamente como FK por outras entidades (`transaction.accountId`,
  `transaction.creditCardId`, `payment.fromAccountId`).
- **`payments[]` é a fonte de verdade do pagamento de fatura, não `transactions[]`.**
  A UI do MVP grava, em paralelo, uma transação espelho `type: 'card_payment'` para o
  MESMO evento de caixa (ver `app.addEventListener('submit', ...)` em `src/main.js`
  do MVP). Importar as duas duplicaria o débito. Por isso: `payments[]` é processado
  via `registerInvoicePayment` (que já gera sua própria transação `card_payment` e
  debita a conta), e linhas `type: 'card_payment'` de `transactions[]` são puladas de
  propósito — nunca contam como inválidas/`skipped`, porque não são um erro, são
  redundantes por design da UI.
- **`payment.invoiceId` segue `${card.id}-${closingDateISO}`** (formato gerado por
  `getInvoiceForPurchase` no MVP), sem carregar `creditCardId` próprio. O cartão e a
  data de fechamento são resolvidos a partir desse prefixo comparando com
  `payload.cards[].id`, sem inventar uma FK que o MVP nunca gravou.

Garantias mantidas (e como o formato real não as compromete):

- **Idempotente:** checksum SHA-256 do payload bruto continua a chave de dedupe
  (`import_batches.checksum`, único por espaço) — reenviar o mesmo export não duplica
  contas, cartões, categorias, transações nem pagamentos.
- **Validado:** linha sem os campos mínimos, ou com `accountId`/`creditCardId`/
  `fromAccountId` não resolvidos dentro do próprio lote, conta em `skipped`; nenhum
  comportamento é inventado para um `type` de transação desconhecido.
- **Reversível:** cada entidade criada é rastreada em `import_entities`, agora também
  para cartões (`entity_type = 'credit_cards'`, migration 004).
  `reverseImportBatch` arquiva (contas/cartões/categorias) ou exclui logicamente
  (transações, incluindo a `card_payment` derivada de `payments[]`) **apenas** as
  entidades daquele lote.
- **Preserva o export original:** `raw_payload` grava o JSON bruto completo (o mesmo
  que `JSON.stringify` produziria a partir do `state` real do MVP), nunca mutado.
- **Isolamento por `space_id`:** cada chamada interna (`createAccount`,
  `createCreditCard`, `createCategory`, `createTransaction`, `createCardTransaction`,
  `registerInvoicePayment`) já reaplica o padrão de isolamento da Fase 1; a importação
  não abre nenhum atalho novo.

## 10. `current_balance`: Recálculo Consistente e Atômico (correção pós-entrega)

> **Correção pós-entrega:** a entrega original criava `accounts.current_balance` uma
> única vez (igual a `opening_balance`) e nunca mais o atualizava — nenhuma transação,
> transferência, pagamento de fatura, estorno ou importação o tocava. Corrigido nesta
> revisão, com teste RED confirmando a ausência do comportamento antes da correção.

### Regra de cálculo

`_recalculateAccountBalance(spaceId, accountId)` recalcula do zero (não incrementa)
a partir de `opening_balance` mais a soma de todo movimento de **caixa** não excluído
daquela conta — nunca de competência:

| `transactions.type` | Entra no saldo? | Sinal |
|---|---|---|
| `income` | sim | `+amount` |
| `expense` | sim | `-amount` |
| `card_payment` | sim | `-amount` (débito na conta pagadora) |
| `refund` | sim, **só se** `account_id` estiver preenchido (devolução em dinheiro) | `+amount` |
| `transfer` | sim, pela perna | perna de origem (`destination_account_id` preenchido) = `-amount`; perna de destino (`destination_account_id` nulo) = `+amount` |
| `card_purchase` | **não** | competência fica só na fatura (`credit_card_invoices`), nunca em `accounts` |

`card_purchase` nunca carrega `account_id` (só `credit_card_id`), então já fica fora
do somatório por construção — é assim que "caixa e competência não são somados como
a mesma despesa" se traduz em código: a compra no cartão só vira débito de conta
quando a fatura é paga (`card_payment`, evento de caixa único), não no momento da
compra (competência).

Uma transferência tem duas linhas (uma por conta); cada recálculo filtra
estritamente por `account_id = X`, então a perna do OUTRO lado (que só aparece via
`destination_account_id` na linha de origem) nunca é somada duas vezes na mesma
conta.

Sempre filtra por `space_id` **e** `accountId` juntos; conta de outro espaço ou
inexistente nunca é tocada (mesmo padrão anti-cross-space do resto do serviço).

### Onde o recálculo é disparado

- `createTransaction` — toda vez que insere uma linha com `account_id` (cobre
  transação simples E cada perna de transferência, já que `createTransfer` chama
  `createTransaction` duas vezes).
- `updateTransaction` — após alterar `amount` (único campo editável que afeta caixa).
- `deleteTransaction` — após o soft-delete.
- `uninformInvoicePayment` — após excluir logicamente a transação do pagamento
  desfeito (devolve o valor à conta pagadora).
- `reverseImportBatch` — após soft-deletar as transações do lote revertido, para
  cada conta afetada (capturada ANTES do soft-delete).
- `registerInvoicePayment`, `createItemRefund`, `promoteForecastToTransaction`,
  `createInstallmentPlan`, `importLocalStorageExport` — não chamam o helper
  diretamente; todos criam suas transações via `createTransaction`/
  `createCardTransaction`, que já recalculam por dentro. Nenhum caminho de escrita
  ficou de fora por não repetir a chamada manualmente.

### Atomicidade: `SAVEPOINT` em vez de `BEGIN/COMMIT` aninhado

SQLite não permite `BEGIN TRANSACTION` dentro de uma transação já aberta — e vários
métodos desta fase já chamavam `createTransaction`/`createCardTransaction` de dentro
do próprio `BEGIN...COMMIT` (`createTransfer`, `registerInvoicePayment`,
`createInstallmentPlan`, `importLocalStorageExport`...). Adicionar o recálculo de
saldo dentro de `createTransaction` expôs esse aninhamento: o teste RED de
importação real falhava com `cannot start a transaction within a transaction` assim
que `importLocalStorageExport` chamava `createCardTransaction`.

Correção: `_runAtomic(fn)` substitui `BEGIN/COMMIT/ROLLBACK` por
`SAVEPOINT/RELEASE/ROLLBACK TO SAVEPOINT` em todo método que participa de alguma
cadeia de chamada aninhada do núcleo financeiro: `createSpace`, `addTransactionsTags`,
`createTransaction`, `updateTransaction`, `deleteTransaction`, `createTransfer`,
`createCardTransaction`, `registerInvoicePayment`, `uninformInvoicePayment`,
`createInstallmentPlan`, `promoteForecastToTransaction`, `importLocalStorageExport` e
`reverseImportBatch`. `SAVEPOINT` funciona isolado (abre uma transação implícita
quando não há nenhuma aberta) e aninhado (dentro de uma transação ou de outro
savepoint já aberto), então o mesmo helper serve tanto uma chamada direta a
`createTransaction` quanto uma chamada feita de dentro de
`importLocalStorageExport`. INSERT/UPDATE da linha + recálculo de saldo + log de
auditoria viram uma única unidade atômica — se qualquer parte falhar, tudo desfaz,
saldo nunca fica dessincronizado do razão de transações. Os métodos herdados da
Fase 1 que não entram nessa cadeia (`updateAttributeDefinition`, `mergeProducts`,
`createPurchaseWithItems`, `createItemRefund`) permanecem com `BEGIN/COMMIT` puro:
são sempre pontos de entrada, nunca chamados de dentro de outra transação, então não
sofrem do mesmo risco — mas `createPurchaseWithItems`/`createItemRefund` já se
beneficiam do recálculo de saldo porque chamam `createTransaction` por dentro.

## 11. Risco Tratado e Verificação de Segurança Aplicável

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
- **Integridade de saldo (novo nesta revisão):** `current_balance` era escrito uma
  vez e nunca mais recalculado — não é uma vulnerabilidade de acesso externo, mas é
  o tipo de bug de lógica de negócio que a skill `seguranca-app-vibe-coded` cita
  explicitamente como fora do alcance de checklist genérico ("sensação de falsa
  segurança ao passar por checklists básicos sem avaliar lógica de negócio
  específica"). Corrigido na seção 10, com 9 testes RED→GREEN dedicados cobrindo os
  cinco gatilhos citados no pedido de correção (transação, transferência,
  pagamento/estorno de fatura, devolução, importação) mais o caso de não cruzar
  espaços.
- **Atomicidade entre linha e saldo (novo nesta revisão):** antes desta correção,
  qualquer recálculo feito como passo solto depois do `INSERT`/`UPDATE` correria o
  risco de um saldo dessincronizado se o processo caísse entre os dois. Resolvido
  com `SAVEPOINT` (seção 10) — o mesmo motivo pelo qual descobrimos e corrigimos, de
  quebra, um bug pré-existente de `BEGIN TRANSACTION` aninhado que nunca havia sido
  exercitado porque a importação original (inventada) nunca chamava
  `createCardTransaction`/`registerInvoicePayment` de dentro de si mesma.
- **Fora do escopo desta fase, sinalizado e não resolvido aqui:** autenticação de
  transporte (HTTPS/cookies/rate limiting) e um gateway MCP expondo estas operações
  como ferramentas — ainda não existem nesta camada; ficam para a fase que introduzir
  a interface HTTP/MCP (ECO-63, fora do escopo desta correção por instrução
  explícita).
