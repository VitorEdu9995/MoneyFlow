# Catálogo de ferramentas — MCP da Organizze

**Versão:** 1.0  
**Data da consulta:** 25/09/2026  
**Escopo:** ferramentas MCP `organizze-gessy` e `organizze-vitor` disponíveis nesta sessão.

## 1. Resumo

Os dois servidores MCP Organizze consultados expõem a mesma lista de **62 ferramentas**, com funcionalidades de leitura, relatórios, análise, escrita e manutenção de dados financeiros. Este documento descreve o que cada ferramenta faz segundo as descrições e esquemas disponíveis no MCP; não é uma especificação interna da Organizze nem substitui o esquema atual de parâmetros.

A maioria das consultas é somente leitura. As ferramentas de escrita podem alterar ou excluir dados do usuário. Em qualquer chamada de escrita, devem ser usados nomes ou IDs válidos obtidos da própria conta/conexão, sem inventar identificadores.

## 2. Consultas e listagens

| Ferramenta | O que faz | Regras e observações |
|---|---|---|
| `get_account_context` | Retorna contexto inicial em uma chamada: entidade conectada, plano, data local e listas compactas de contas, cartões e categorias. | Útil no início para evitar várias consultas `list_*`. |
| `list_accounts` | Lista contas bancárias do usuário com IDs. | Use para resolver conta antes de operações. |
| `list_credit_cards` | Lista cartões de crédito com IDs e limites. | Cartões automáticos/conectados têm restrições diferentes dos manuais. |
| `list_categories` | Lista categorias usadas para classificar transações. | Usar antes de criar/editar quando a categoria não for conhecida. |
| `list_transactions` | Lista transações por período, com paginação. | Máximo de 80 por página. O padrão `cashflow` não mostra compras individuais de cartão. Para análise por categoria, use `list_mode='all_transactions'` ou `category_id`. Use `period_totals` para o período completo; não some página truncada. Detalhes crus de Open Finance requerem `get_transaction`. |
| `list_transferences` | Lista transferências entre contas com paginação. | Datas em `YYYY-MM-DD`. |
| `list_budgets` | Lista limites/orçamentos por categoria. | Pode filtrar por ano e/ou mês. |
| `list_recurrences` | Lista contas fixas recorrentes cadastradas, com periodicidade, valor e próxima ocorrência. | Traz recorrências manuais; em conexões Open Finance pode retornar vazio. Não inclui parcelamentos; para eles use `find_installments`. |
| `list_institutions` | Lista instituições financeiras e IDs/slug usados em contas ou cartões. | Aceita filtro por nome (`query`). |
| `get_credit_card_invoices` | Lista faturas de um cartão. | Requer `credit_card_id`. |
| `get_credit_card_invoice` | Retorna detalhes de uma fatura específica, incluindo transações, pagamentos e gastos por categoria. | Prefira o nome do cartão quando disponível para resolução. |
| `get_invoices_matrix` | Monta matriz mês × cartão com totais por mês, cartão e geral. | Indicado para vários cartões/meses; padrão é ano atual e todos os cartões. Usa os valores da ferramenta de faturas, evitando soma manual. |
| `get_transaction` | Obtém detalhes completos de uma transação por ID ou UUID. | Use para inspecionar detalhes Open Finance omitidos da listagem. |
| `search_transactions` | Pesquisa transações por texto na descrição, observação ou tags. | Paginação. Sem datas, o padrão são os últimos 6 meses. |
| `get_latest_imports` | Lista transações importadas mais recentemente via Open Finance. | Paginação; padrão 50, máximo 100 por página. |
| `get_bank_connections` | Lista conexões bancárias Open Finance ativas e o estado de cada uma. | Somente leitura; não força sincronização. |
| `get_open_finance_status` | Consulta ao vivo o estado do agregador Open Finance (Belvo), opcionalmente por banco. | Resultado cacheado por cerca de 5 minutos. Útil para diagnosticar instabilidade do provedor. |
| `resolve_entity` | Resolve um nome aproximado para ID/UUID de conta, cartão ou categoria. | Se houver ambiguidade, retorna correspondências candidatas. Usar antes de escrever em caso de nomes incertos. |

## 3. Relatórios, métricas e análises

| Ferramenta | O que faz | Regras e observações |
|---|---|---|
| `get_financial_summary` | Resume receitas, despesas, comparação entre períodos e maiores gastos. | Totais usam base caixa; maiores gastos usam base por lançamento e incluem cartão. Esses valores não devem ser somados entre si. |
| `transactions_list_results` | Retorna totais do período: receitas, despesas, resultado, saldo e previstos, sem paginar linha a linha. | Ideal para perguntas como “quanto gastei?” ou “qual meu saldo?”. Padrão mês atual; caixa por padrão, mas `category_id` muda para base por lançamento. Não misture bases. |
| `get_income_vs_expenses` | Relatório de receitas contra despesas por período. | Modo caixa; padrão mês atual. Pode filtrar conta. Exclui compras individuais de cartão e considera pagamento de fatura. |
| `get_monthly_overview` | Visão mensal com receitas, despesas, saldo, maiores categorias, status de orçamento e contas a pagar próximas. | Padrão mês atual. Totais são base caixa; categorias superiores são base por lançamento e não somam com `totals.expenses`. |
| `get_categories_report` | Agrupa receitas e despesas por categoria, com percentuais e subcategorias. | Inclui compras de cartão; base por lançamento. Padrão mês atual. |
| `get_categories_evolution` | Mostra evolução de receitas/despesas por categoria ao longo do tempo. | Pode agrupar por dia, semana ou mês; padrão últimos 3 meses. |
| `get_tags_report` | Agrupa transações por tag, com valores e percentuais. | Padrão mês atual; informar datas amplas para históricos longos/projetos. |
| `get_budget_summary` | Resume os orçamentos do mês e identifica limites excedidos ou próximos. | Padrão mês atual. |
| `get_upcoming_bills` | Lista contas não pagas e faturas de cartão com vencimento nos próximos dias. | Padrão 7 dias. |
| `get_balances` | Lista saldo por conta, faturas atuais abertas por cartão e patrimônio simplificado (contas menos faturas abertas). | Base caixa; não trata parcelas ou faturas futuras como dívida. |
| `get_cashflow_forecast` | Projeta fluxo de caixa com saldo atual e transações futuras não pagas em contas manuais. | Padrão próximos 30 dias; retorna saldo projetado e menor ponto. Não projeta faturas de cartão. |
| `find_duplicates` | Encontra transações possivelmente duplicadas com valores iguais e descrições parecidas em datas próximas. | Padrão mês atual. Útil antes de correções/exclusões, não prova por si só que são duplicatas. |
| `find_installments` | Identifica compras parceladas por dados estruturados e heurística. | Use em vez de pesquisa textual para parcelamentos. Sem datas, últimos 12 meses; pode filtrar conta/cartão. Resultados heurísticos são apresentados como possíveis parcelamentos. |
| `find_subscriptions` | Detecta assinaturas e serviços recorrentes em conexões Open Finance. | Combina recorrências cadastradas e heurística de repetição de estabelecimento; classifica estabilidade do valor. Não inclui parcelamentos. Sem datas, últimos 6 meses. |
| `suggest_categories` | Sugere categoria para uma ou mais descrições. | Considera edições anteriores do usuário, histórico categorizado e padrões gerais. Retorna confiança e força semântica. Usar antes de criar lotes categorizados e revisar confiança. |
| `load_skill` | Carrega guia detalhado de uso de um tema da Organizze. | A descrição recomenda chamar antes de responder quando a conversa envolver tema coberto por guia específico. |

## 4. Criação e manutenção de transações e transferências

| Ferramenta | O que faz | Regras e observações |
|---|---|---|
| `create_transaction` | Cria receita ou despesa. | `is_income` é obrigatório; valor é positivo e o booleano define receita/despesa. Requer descrição, valor, data e conta/cartão. Aceita conta/categoria pelo nome, tags, observação, recorrência e quantidade de parcelas. Não há parâmetro para anexar arquivo no esquema do MCP consultado. |
| `update_transaction` | Atualiza campos de transação existente. | Passe somente campos a alterar. ID/UUID deve vir de listagem/pesquisa/detalhe recente. Em transações automáticas só descrição, categoria, observação e tags podem mudar. Para mudar fatura de compra manual use `credit_card_invoice_id` ou `recompute_invoice=true`; mudar somente data mantém fatura atual. |
| `delete_transaction` | Exclui uma transação. | Transações automáticas não podem ser excluídas. ID/UUID deve vir de consulta recente. Em recorrências, use `delete_recurrence` para remover a regra (esta ferramenta não aparece na lista disponível) ou confirme o escopo da operação; exclusões em lote têm ferramenta própria. |
| `set_transaction_paid` | Marca transação como paga/recebida ou não paga. | Para contas manuais. Idempotente. Transações automáticas são sempre consideradas pagas. |
| `create_transfer` | Cria transferência entre duas contas bancárias. | Pode aceitar recorrência; não envolve cartão de crédito. Prefira nomes de contas resolvidos pela listagem/contexto. |
| `inform_invoice_payment` | Informa pagamento de fatura de cartão automático/Open Finance. | Representa sinalização enquanto aguarda confirmação da fonte bancária. |
| `register_invoice_payment` | Registra pagamento de fatura de cartão manual como lançamento vinculado à fatura. | Para cartões manuais. Obtenha faturas primeiro via `get_credit_card_invoices`; passe ID ou mês `YYYY-MM`. Prefira nomes de cartão/conta. |
| `uninform_invoice_payment` | Desfaz sinalização de pagamento de fatura automática ainda aguardando confirmação. | Exige data/ID da fatura. Não remove pagamentos reais já confirmados pelo Open Finance. |

## 5. Operações em lote

| Ferramenta | O que faz | Limites e regras |
|---|---|---|
| `mass_create_transactions` | Cria várias transações em uma chamada. | Máximo 100. Cada linha deve ser única por descrição+valor+data+conta; deduplicar antes de enviar. Não usar para importar CSV/OFX com snapshot canônico; a orientação é usar a importação do app ou linhas sem fingerprint de anexo. A chamada MCP executa sem confirmação interativa. |
| `mass_update_transactions` | Atualiza várias transações por filtro de busca. | Máximo 200. Antes, valide os mesmos filtros com listagem/pesquisa. Informe ao menos um filtro e um campo alterável. Conjunto vazio ou maior que o limite exige refinamento. Alterações em lote podem ser irreversíveis. |
| `mass_delete_transactions` | Exclui várias transações por IDs/UUIDs. | Máximo 500. IDs devem vir de uma busca recente; nunca invente. Transações automáticas são ignoradas; recorrentes afetam apenas a ocorrência atual. Operação destrutiva. |
| `add_transactions_tags` | Adiciona tags a várias transações. | Máximo 200; acumula às tags existentes. Cada item informa ID/UUID e tags, como texto separado por vírgulas ou lista. |
| `update_transactions_categories` | Define categoria de várias transações, podendo escolher destino por linha. | Máximo 200. Útil quando cada transação tem categoria diferente, por exemplo após `suggest_categories`. Prefira nome de categoria e IDs obtidos no turno atual. Se todas receberão a mesma categoria, prefira `mass_update_transactions`. |
| `update_transactions_descriptions` | Substitui descrições de várias transações. | Máximo 200. Aceita ID/UUID e descrição por linha; também aceita um único objeto. Para uma regra comum a todas, prefira `mass_update_transactions`. |
| `mass_manage_categories` | Aplica mudanças em lote na árvore de categorias. | Máximo 100 operações; mudanças atômicas: se uma falhar, nenhuma é aplicada. Operações: criar, renomear, mover (pai `0` para raiz), arquivar e desarquivar. Não exclui categorias. Resolve por nome. |

## 6. Contas, cartões, categorias e orçamentos

| Ferramenta | O que faz | Regras e observações |
|---|---|---|
| `create_account` | Cria conta bancária manual. | Usar nomes/IDs válidos de instituição conforme `list_institutions` quando aplicável. |
| `update_account` | Atualiza nome, descrição, instituição ou arquivamento da conta. | Contas automáticas permitem apenas nome e arquivamento. Prefira nome, sem inventar ID. |
| `delete_account` | Exclui uma conta. | **Atenção:** todas as transações daquela conta são apagadas em background. Contas automáticas não podem ser excluídas por essa ferramenta; desconexão deve ser feita no fluxo próprio do app. |
| `create_credit_card` | Cria cartão manual. | Cartões automáticos vêm da conexão bancária. Faturas são geradas automaticamente após criação. |
| `update_credit_card` | Atualiza nome, bandeira, dias de fechamento/vencimento, limite ou arquivamento. | Cartões automáticos permitem somente nome e arquivamento. Prefira nome em vez de ID inventado. |
| `delete_credit_card` | Exclui cartão. | **Atenção:** todas as transações e faturas do cartão são excluídas. Cartões automáticos não podem ser excluídos por esta ferramenta. |
| `create_category` | Cria categoria de despesa ou receita, raiz ou subcategoria. | Categoria filha depende da categoria pai apropriada. |
| `update_category` | Atualiza nome, cor, categoria pai ou arquivamento. | Categorias padrão não podem ser excluídas, mas podem ser renomeadas/arquivadas. Prefira nome. |
| `delete_category` | Exclui categoria e redireciona transações para categoria substituta ou padrão. | Categorias padrão não podem ser excluídas. Excluir categoria raiz também remove subcategorias. Confirmar destino e impacto antes de usar. |
| `create_budget` | Cria limite de gastos para uma categoria. | Padrão é orçamento de despesa; use `activity_type='earning'` para meta de receita. Prefira nome da categoria. |
| `update_budget` | Atualiza valor de orçamento. | `amount=0` remove o orçamento. |
| `delete_budget` | Remove um orçamento. | Afeta limite da categoria/período informado. |
| `clone_budgets` | Copia orçamentos do mês anterior para o mês de destino. | Não sobrescreve mês que já tenha orçamentos. Padrão é mês atual. |

## 7. Regras de interpretação que afetam as ferramentas

### 7.1 Caixa versus compras do cartão

- `cashflow` é a visão de caixa: não lista compras individuais de cartão; pode mostrar pagamentos de fatura.
- `all_transactions` mostra compras individuais de cartão e respectivas categorias, mas sem `account_id` não inclui pagamentos de fatura.
- Quando existe filtro `account_id`, `all_transactions` também pode incluir `CreditCardBillsPayment`.
- Fatura Open Finance já confirmada como paga pode não aparecer como fatura no `cashflow`; o caixa efetivo fica representado pelo lançamento na conta, com marcador de pagamento de fatura.
- Totais caixa e totais por lançamento não devem ser reconciliados/somados como uma só base. Os relatórios nomeados indicam as diferenças.

### 7.2 Paginação e totais

- Se `truncated=true`, há mais registros; avance a página ou aplique filtros mais estreitos.
- `period_totals` de `list_transactions` cobre o período inteiro com filtros atuais; não some apenas registros de uma página truncada.
- Para agregados mais ricos, use `transactions_list_results` ou relatórios próprios.

### 7.3 Status pago/pendente

- Conta manual: `paid=false` com data anterior à data local significa atrasada; data presente/futura significa a vencer.
- Conta automática/conectada: `paid` é sempre verdadeiro para movimentações bancárias confirmadas; não use esse campo para inferir atraso.
- Fatura de cartão pode continuar pendente/atrasada mesmo em cartão automático; conferir `paid` da fatura.

### 7.4 Anexos

- A ajuda pública da Organizze menciona anexar mais de um arquivo a uma movimentação.
- Os esquemas MCP de `create_transaction` e `update_transaction` consultados não incluem parâmetro de upload/anexo. Portanto, esta sessão não expõe anexação de arquivos pela interface MCP, ainda que a interface do produto possa oferecer esse recurso.

## 8. Recomendações de uso seguro

1. Comece com `get_account_context`; use `resolve_entity` quando nome estiver ambíguo.
2. Consulte os registros antes de editar/apagar; IDs devem ser originados na mesma conexão e em consultas recentes.
3. Prefira nomes de conta, cartão e categoria quando a ferramenta os aceitar.
4. Escolha corretamente a base: caixa para dinheiro efetivamente entrando/saindo; por lançamento para compras categorizadas.
5. Em lote, valide filtros, dedupe payloads e confira limites antes de escrever.
6. Evite operações de exclusão em conta, cartão, categoria e transações sem revisar impacto; contas/cartões podem remover históricos associados.
7. Para cartões manuais e conectados, escolha a ferramenta de pagamento de fatura apropriada.
8. Não assuma sincronização Open Finance ao consultar status; as consultas de conexão/status são somente leitura e não forçam atualização.
9. Quando a resposta depende de semântica não especificada na descrição da ferramenta, consulte o esquema completo com `tool.get` ou carregue o guia temático via `load_skill`.

## 9. Índice alfabético das 62 ferramentas

1. `add_transactions_tags`
2. `clone_budgets`
3. `create_account`
4. `create_budget`
5. `create_category`
6. `create_credit_card`
7. `create_transaction`
8. `create_transfer`
9. `delete_account`
10. `delete_budget`
11. `delete_category`
12. `delete_credit_card`
13. `delete_transaction`
14. `find_duplicates`
15. `find_installments`
16. `find_subscriptions`
17. `get_account_context`
18. `get_balances`
19. `get_bank_connections`
20. `get_budget_summary`
21. `get_cashflow_forecast`
22. `get_categories_evolution`
23. `get_categories_report`
24. `get_credit_card_invoice`
25. `get_credit_card_invoices`
26. `get_financial_summary`
27. `get_income_vs_expenses`
28. `get_invoices_matrix`
29. `get_latest_imports`
30. `get_monthly_overview`
31. `get_open_finance_status`
32. `get_tags_report`
33. `get_transaction`
34. `get_upcoming_bills`
35. `inform_invoice_payment`
36. `list_accounts`
37. `list_budgets`
38. `list_categories`
39. `list_credit_cards`
40. `list_institutions`
41. `list_recurrences`
42. `list_transactions`
43. `list_transferences`
44. `load_skill`
45. `mass_create_transactions`
46. `mass_delete_transactions`
47. `mass_manage_categories`
48. `mass_update_transactions`
49. `register_invoice_payment`
50. `resolve_entity`
51. `search_transactions`
52. `set_transaction_paid`
53. `suggest_categories`
54. `transactions_list_results`
55. `uninform_invoice_payment`
56. `update_account`
57. `update_budget`
58. `update_category`
59. `update_credit_card`
60. `update_transaction`
61. `update_transactions_categories`
62. `update_transactions_descriptions`

