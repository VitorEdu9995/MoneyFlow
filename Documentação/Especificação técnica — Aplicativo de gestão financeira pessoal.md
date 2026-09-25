# Especificação técnica — Aplicativo de gestão financeira pessoal

**Versão:** 1.0  
**Data:** 25/09/2026  
**Status:** Especificação inicial para produto e engenharia

## 1. Objetivo

Definir os requisitos funcionais e as regras de negócio para um aplicativo de finanças pessoais que combine recursos observados na Organizze (incluindo seu MCP) e no Minhas Finanças. O documento é uma especificação independente para orientar uma implementação própria; não descreve código-fonte ou regras internas não publicadas desses produtos.

O sistema deve permitir registrar e acompanhar contas, cartões, receitas, despesas, transferências, faturas, parcelas, recorrências, orçamentos e anexos; receber movimentações bancárias por integração; conciliar registros planejados com movimentações reais; e produzir relatórios coerentes sem contar valores duas vezes.

## 2. Convenções e classificação das regras

As regras são identificadas assim:

- **Documentada:** explicitamente descrita na documentação pública do Minhas Finanças ou nas descrições das ferramentas MCP da Organizze disponíveis nesta sessão.
- **Requisito proposto:** decisão técnica recomendada para construir um produto consistente. Deve ser validada com produto/UX antes de implementação definitiva.
- **A confirmar:** comportamento cuja documentação consultada não especifica todos os detalhes.

Valores monetários devem ser armazenados em decimal exato (por exemplo, `NUMERIC(18,2)` ou centavos inteiros), nunca em ponto flutuante binário. Datas são armazenadas com fuso da entidade/perfil e apresentadas no fuso configurado pelo usuário.

## 3. Escopo funcional

### 3.1 Módulos

1. Usuários, entidades/perfis e preferências regionais.
2. Contas financeiras e cartões.
3. Categorias, subcategorias e tags.
4. Receitas, despesas, transferências e recorrências.
5. Faturas, pagamentos, compras parceladas e estornos.
6. Orçamentos e objetivos financeiros.
7. Open Finance/importação, conciliação e deduplicação.
8. Anexos e leitura assistida de comprovantes.
9. Consultas, indicadores, relatórios e projeções.
10. Auditoria, permissões e operações em lote.

### 3.2 Fora do escopo desta versão

- Iniciar pagamentos, transferências bancárias ou compras em nome do usuário.
- Garantir sincronização em tempo real com instituições; a disponibilidade depende do provedor e do banco.
- Tratar investimentos sincronizados por Open Finance, salvo se um módulo próprio for definido posteriormente.
- Replicar a interface, marca, texto proprietário ou implementação interna de qualquer produto citado.

## 4. Entidades e modelo conceitual

### 4.1 Entidade financeira / perfil

Permite separar finanças pessoais, familiares ou profissionais.

Campos mínimos: `id`, `owner_user_id`, `name`, `currency`, `timezone`, `created_at`, `archived_at`.

Toda conta, cartão, transação, categoria, orçamento e conexão pertence a uma entidade. Usuários com acesso compartilhado só podem consultar ou alterar os dados autorizados para essa entidade.

### 4.2 Conta

Representa uma conta de caixa ou banco.

Campos mínimos: `id`, `entity_id`, `name`, `institution_id` opcional, `account_type`, `currency`, `opening_balance`, `current_balance_cache` opcional, `source` (`manual` ou `open_finance`), `connection_id` opcional, `account_number_hint` opcional, `archived_at`.

Regras:

- Contas manuais podem receber lançamentos manuais e ser editadas conforme permissões.
- Contas vinculadas a Open Finance recebem transações/saldos da conexão; alterações de identidade ou exclusão devem respeitar o ciclo de vida da conexão.
- Arquivar uma conta não deve apagar seu histórico. **Requisito proposto:** remoção física só deve ser permitida se não houver movimentações; caso contrário, arquivar ou iniciar fluxo explícito de migração.

### 4.3 Cartão de crédito

Campos mínimos: `id`, `entity_id`, `name`, `source` (`manual` ou `open_finance`), `connection_id` opcional, `institution_id` opcional, `brand` opcional, `credit_limit` opcional, `closing_day`, `due_day`, `payment_account_id` opcional, `archived_at`.

Regras:

- Um cartão manual pode ser criado pelo usuário; o sistema gera ciclos de fatura conforme fechamento e vencimento.
- Um cartão Open Finance é criado/atualizado pela conexão, ou vinculado a um cartão manual existente. Não criar um segundo cartão se o usuário optar por vincular o já cadastrado.
- Ao vincular um cartão manual, importar somente movimentações a partir do início do vínculo por padrão; não importar o histórico anterior automaticamente, para reduzir duplicidade. **Documentada no Minhas Finanças; recomendada como padrão do produto.**
- Cartões automáticos têm restrições maiores de edição e exclusão. **Requisito proposto:** permitir apenas ajustes locais de apelido, arquivamento e metadados que não conflitem com dados do banco.
- Excluir cartão pode apagar faturas e compras associadas no comportamento descrito pelo MCP da Organizze. Para reduzir risco, este produto deve preferir arquivamento; exclusão com histórico deve exigir confirmação explícita, resumo do impacto e, idealmente, opção de exportação.

### 4.4 Categoria e tag

Categoria contém `id`, `entity_id`, `name`, `kind` (`expense` ou `income`), `parent_id` opcional, `color`, `is_system`, `archived_at`.

- Categorias podem formar árvore hierárquica.
- Categorias padrão podem ser renomeadas ou arquivadas, mas não removidas, conforme comportamento observado na Organizze.
- Ao remover uma categoria não protegida, suas transações devem ser reassociadas a uma categoria substituta válida antes da operação.
- Tags são rótulos livres, independentes da categoria, usados para pesquisa e relatório.

### 4.5 Transação

Campos mínimos recomendados:

`id`, `entity_id`, `type` (`income`, `expense`, `transfer`, `card_purchase`, `card_payment`, `refund`), `description`, `amount`, `currency`, `account_id` opcional, `credit_card_id` opcional, `category_id` opcional, `observation`, `tags[]`, `transaction_date`, `due_date` opcional, `effective_date` opcional, `paid_status`, `source` (`manual`, `open_finance`, `import`, `system`), `external_id` opcional, `recurrence_id` opcional, `installment_plan_id` opcional, `invoice_id` opcional, `created_at`, `updated_at`, `deleted_at` opcional.

- `amount` é não negativo no modelo e `type` determina o sentido financeiro. **Requisito proposto:** normalizar valores para magnitude positiva, armazenando o sentido em `type`; representar estornos como evento/lançamento negativo associado, ou como tipo `refund`, de forma consistente em todos os relatórios.
- Separar data da compra/lançamento, vencimento e efetivação/pagamento. Não inferir que são a mesma data.
- Para transação manual, o estado pago/recebido é controlado pelo usuário. Para transação bancária importada já confirmada, considerar efetivada; não usar uma flag manual como indicador de atraso.

### 4.6 Fatura de cartão

Campos mínimos: `id`, `entity_id`, `credit_card_id`, `cycle_start`, `cycle_end`, `closing_date`, `due_date`, `status` (`open`, `closed`, `partially_paid`, `paid`, `reopened`), `total_charges`, `total_credits`, `total_paid`, `open_amount`, `source`, `external_id` opcional.

Uma fatura deve manter vínculo às compras, estornos/créditos e pagamentos atribuídos a ela. Campos agregados podem ser cache, mas os itens associados são a fonte de verdade.

### 4.7 Pagamento de fatura

Campos mínimos: `id`, `invoice_id`, `from_account_id`, `amount`, `payment_date`, `source`, `external_transaction_id` opcional, `status`.

Um pagamento pode ser parcial; podem existir vários pagamentos para a mesma fatura, inclusive oriundos de contas diferentes. O extrato de cada conta deve refletir apenas a parcela paga por aquela conta (comportamento documentado no Minhas Finanças).

### 4.8 Parcelamento

`installment_plan`: `id`, `entity_id`, `credit_card_id`/`account_id`, `description`, `merchant`, `total_amount` opcional, `installment_count`, `first_installment_number`, `source`, `status`.

Cada ocorrência deve guardar `installment_number`, `amount`, `due_date`, `transaction_id` ou estado `forecast`/`actual`.

### 4.9 Recorrência

Define geração de ocorrências repetidas, com frequência, data inicial/final opcional, regra de valor e tipo. Uma recorrência manual não é o mesmo que uma assinatura inferida a partir de transações bancárias.

### 4.10 Anexo

Campos mínimos: `id`, `entity_id`, `transaction_id`, `storage_key`, `original_filename`, `mime_type`, `size_bytes`, `checksum`, `uploaded_by`, `created_at`, `deleted_at`.

- Permitir mais de um arquivo por transação, pois a ajuda da Organizze declara essa possibilidade.
- Minhas Finanças divulga anexos de comprovantes/documentos e leitura de recibos a partir de imagem.
- **A confirmar:** formatos, tamanho máximo, número máximo e prazo de retenção não foram especificados nas fontes consultadas.
- **Requisito proposto para MVP:** aceitar PDF, JPEG e PNG; limitar tamanho individual e total por entidade; validar MIME real (não apenas extensão); usar armazenamento privado e URLs temporárias; permitir exclusão por permissão e manter metadados de auditoria. Definir limites concretos por plano antes do lançamento.
- OCR/extração de dados de comprovantes deve ser assistido: mostrar campos reconhecidos ao usuário e exigir revisão antes de criar ou alterar transação.

### 4.11 Conexão Open Finance

Campos mínimos: `id`, `entity_id`, `institution_id`, `provider`, `consent_status`, `connection_status`, `last_sync_at`, `next_sync_at` opcional, `last_error_code` opcional, `created_at`, `revoked_at`.

Guardar identificadores externos e cursores de sincronização de modo seguro; nunca registrar credenciais bancárias em logs. Consentimentos podem ser revogados e sincronizações dependem da instituição/provedor.

## 5. Regras de negócio de cartões e faturas

### 5.1 Ciclo de fatura

1. O cartão possui dia de fechamento e dia de vencimento.
2. A regra de fechamento determina a fatura de destino de uma compra; a data do lançamento posiciona a compra no ciclo correspondente. **Documentada pelo Minhas Finanças.**
3. Toda compra manual deve ser associada a uma fatura conforme a data de compra e configuração do cartão.
4. Fechamento, vencimento e fuso horário precisam lidar com meses mais curtos. **Requisito proposto:** se o dia configurado não existir no mês, usar o último dia daquele mês.
5. Editar apenas a data de uma compra existente pode conservar sua fatura; se o usuário pretende mudar o ciclo, oferecer ação explícita de recalcular/mover e mostrar a fatura de origem e destino. O MCP Organizze documenta essa distinção.
6. Ajustar os dias de fechamento/vencimento não deve reescrever silenciosamente faturas pagas. Exibir impacto futuro e permitir recalcular apenas ciclos em aberto, mediante confirmação.

### 5.2 Total de fatura

Definição sugerida:

`total_due = soma(compras e encargos atribuídos ao ciclo) - soma(estornos/créditos atribuídos ao ciclo)`

`open_amount = max(0, total_due - total_paid)`

O produto pode mostrar crédito excedente separado quando `total_paid > total_due`; não esconder o valor nem produzir saldo negativo confuso.

- Valores negativos no cartão representam estornos/créditos e reduzem o total, conforme a ajuda do Minhas Finanças.
- Compras fixas podem gerar previsões em ciclos futuros.
- Compras parceladas devem aparecer com a parcela atual e com previsões para parcelas futuras, se a origem/informação disponível permitir.
- Limite disponível deve ser rotulado com clareza e calculado por regra aprovada pelo produto. **A confirmar:** as fontes consultadas não detalham exatamente como tratar compras parceladas, compras pendentes ou pagamentos parciais no limite.

### 5.3 Pagamento, antecipação e reabertura

1. O usuário escolhe a conta de origem, a data e o valor do pagamento.
2. O pagamento pode ser parcial; cada pagamento fica vinculado à fatura e à conta efetivamente usada.
3. Pagamentos parciais de contas diferentes geram movimentos separados nos extratos correspondentes.
4. Pagamento antecipado reduz o valor pendente antes do vencimento.
5. Pagamento acima do total pode formar crédito para o ciclo seguinte. Exibir como crédito claramente identificado, sem tratá-lo como receita.
6. Reabrir fatura desfaz o estado de pagamento para permitir correções; antes de permitir novo pagamento, atualizar o valor pendente e revisar vínculos existentes.
7. Pagamento feito pelo Open Finance deve ser conciliado à fatura; uma indicação manual de pagamento pendente não é prova de pagamento efetivado.
8. Não registrar duas vezes o mesmo pagamento: manter referência à transação bancária externa e fazer matching idempotente.

### 5.4 Distinção entre compras e fluxo de caixa

O sistema deve oferecer duas visões explicitamente nomeadas:

- **Fluxo de caixa:** saídas e entradas efetivamente refletidas em contas. Para cartão, considera o pagamento da fatura como saída de caixa.
- **Gastos por compra/competência:** compras individuais classificadas por categoria e associadas à data/ciclo da fatura.

Nunca somar o valor pago da fatura e as compras individuais da mesma fatura como se fossem despesas independentes em um único total. Relatórios devem declarar a base utilizada.

### 5.5 Faturas conectadas

- Faturas em aberto importadas podem ser mostradas como compromisso pendente.
- Quando o banco confirmar o pagamento, o fluxo de caixa deve ser representado pelo lançamento/pagamento real na conta e a fatura não deve continuar contribuindo como um segundo desembolso.
- Cartões conectados podem ter limitações de alteração/exclusão distintas dos cartões manuais.
- A sincronização não deve ser apresentada como instantânea garantida; a ajuda do Minhas Finanças informa que atualizações podem levar horas e, em alguns casos, até cinco dias, conforme a instituição.

## 6. Parcelas e previsões

1. Ao criar compra parcelada manual, exigir ou confirmar número de parcelas e valor total; calcular parcelas com arredondamento em centavos e distribuir o resíduo de forma determinística (por exemplo, ajustar a última parcela).
2. Em Open Finance, o banco pode enviar apenas a parcela que chegou à fatura atual, com referência à posição e quantidade total.
3. Quando os dados recebidos permitirem, gerar previsões para as parcelas restantes, marcadas como previstas — nunca como transações bancárias confirmadas.
4. Quando a parcela real chegar, localizar a previsão correspondente pelo conjunto de sinais (cartão, plano, comerciante/descrição, número da parcela, valor aproximado e ciclo) e promovê-la/atualizá-la, em vez de duplicá-la.
5. Diferenças de centavos entre parcelas são possíveis; aceitar tolerância configurável e preservar o valor real recebido. A documentação do Minhas Finanças observa que alguns bancos concentram o resíduo na primeira parcela.
6. Se uma parcela prevista deixar de existir após atualização/histórico e houver indício confiável de cancelamento ou estorno, cancelar/remover previsões futuras automáticas relacionadas, mantendo trilha de auditoria e sem apagar dados reais confirmados.
7. Permitir ajuste manual de previsão; sincronização posterior não deve sobrescrever silenciosamente ajuste confirmado pelo usuário.

## 7. Open Finance, importação e conciliação

### 7.1 Importação

- Importar contas, cartões, saldos e transações autorizados pelo usuário.
- A primeira sincronização pode conter apenas histórico recente, conforme disponibilidade e limites do provedor.
- Manter estado visível da conexão, último sincronismo, mensagens de falha e opção de reconectar/revogar.
- Desconectar interrompe sincronizações futuras, mas não apaga dados já importados por padrão (regra documentada no Minhas Finanças).
- Arquivos OFX/CSV importados devem passar por pré-visualização, validação, deduplicação e confirmação; não reutilizar a operação de lote manual para uma importação que precise preservar snapshot, correspondências ou trilha de conciliação.

### 7.2 Vinculação e não duplicidade

- Oferecer vínculo de conta/cartão manual existente à conexão bancária em vez de criar duplicata.
- No vínculo inicial, não importar histórico anterior por padrão; informar claramente a data a partir da qual haverá atualização automática.
- Permitir transações manuais em contas/cartões conectados para planejamento.
- Quando a movimentação real chegar, comparar campos como valor, data, descrição, observação, conta/cartão, comerciante e referência externa.
- Fazer conciliação somente quando a correspondência for suficientemente segura; se houver ambiguidade, sugerir correspondências e solicitar escolha.
- Em caso de correspondência, associar a movimentação importada ao registro planejado ou convertê-lo em efetivo, sem contar duas vezes. Guardar os valores original planejado e real para auditoria.
- Notificações bancárias em itens já sincronizados podem ser ignoradas por padrão para reduzir duplicidade; caso habilitadas, aplicar comparação e alertar que falsos positivos/duplicatas ainda podem ocorrer (regra documentada no Minhas Finanças).

### 7.3 Transferências

- Transferência entre contas é movimentação interna: deve reduzir uma conta e aumentar outra sem ser classificada como receita ou despesa consolidada.
- Detectar possíveis pares de saída/entrada por valor, proximidade de data, titularidade e instituição; não fazer conversão automática sem confiança suficiente.
- Se só um lado estiver conectado, usar informação de identificação da outra conta se disponível e oferecer sugestão quando origem/destino não puder ser confirmado.

### 7.4 Categorias automáticas

- Sugerir categoria com base em histórico do usuário, estabelecimento e padrões; incluir confiança e explicação quando possível.
- Permitir escolha de usar somente categorias existentes ou criação assistida de nova categoria.
- Mudança manual deve prevalecer sobre futuras sugestões, salvo solicitação explícita do usuário.
- Nunca classificar transferência interna como gasto ou receita.

## 8. Recorrências, assinaturas e contas a vencer

- Recorrência cadastrada cria previsões de ocorrências em calendário e relatórios; não confundir previsão com pagamento confirmado.
- Em contas manuais, estado `paid=false` com vencimento anterior à data local é atrasado; com data futura é a vencer.
- Em transações Open Finance já importadas/confirmadas, não inferir atraso com base em um campo `paid` que seja sempre verdadeiro.
- Faturas podem estar pendentes/atrasadas mesmo para cartão conectado; verificar estado próprio da fatura.
- Detecção de assinaturas por repetição de estabelecimento é heurística; apresentar como possível recorrência, com confiança, não como recorrência confirmada.
- Assinaturas inferidas, recorrências cadastradas e parcelas devem ser categorias de previsão separadas.

## 9. Orçamentos, saldo, relatórios e projeções

### 9.1 Orçamentos

- Orçamento pertence a categoria, entidade e período; pode ser de despesa ou meta de receita.
- Exibir gasto/receita realizado, previsto, valor-limite e percentual de utilização.
- Alertar quando excedido ou próximo do limite; limiares configuráveis.
- Clonar valores de período anterior somente quando o período de destino não tiver orçamento preexistente, a menos que o usuário solicite substituição explícita.

### 9.2 Saldos

- `saldo_conta = saldo_inicial + créditos efetivos - débitos efetivos`, com transferências e pagamentos contabilizados uma única vez.
- `patrimônio líquido simplificado = soma dos saldos das contas - faturas atuais em aberto`.
- Não subtrair simultaneamente saldo de fatura e parcelas futuras já previstas se isso implicar dupla contagem. Exibir claramente que esta visão simplificada não inclui obrigações futuras não faturadas.

### 9.3 Fluxo de caixa previsto

- Partir do saldo atual e aplicar lançamentos futuros não pagos de contas manuais na janela definida.
- Mostrar saldo projetado final e ponto mínimo projetado, com datas e itens causadores.
- A versão básica não deve tratar faturas futuras de cartão como desembolsos já confirmados. Preferencialmente apresentar uma projeção separada que inclua cenários de fatura, claramente identificada como previsão.

### 9.4 Relatórios

Todos os relatórios devem indicar período, entidade, filtros e base de cálculo:

- Caixa (pagamentos efetivos) ou compras/transações por lançamento.
- Receitas, despesas, resultado e saldo.
- Categorias, subcategorias, tags, cartões, contas e evolução temporal.
- Faturas por mês/cartão.
- Parcelamentos, assinaturas detectadas, vencimentos próximos, orçamento e duplicidades.
- Totais agregados devem ser calculados sobre o período filtrado inteiro; paginação de linhas não pode alterar o total exibido.

## 10. Pesquisa, paginação e operações em lote

- Paginar listas com limite configurável; retornar `has_more`/`next_cursor` ou equivalente. Deixar claro quando resultados estão truncados.
- Pesquisa de transação deve aceitar descrição, observação, tag, comerciante, intervalo de data, conta, cartão, categoria e estado.
- Lotes devem validar todos os itens antes de aplicar, ou documentar claramente atomicidade parcial. Para operações de cadastro/alteração, devolver resultado por item e uma chave de idempotência.
- Deduplicar lote de criação antes de gravar.
- Operações destrutivas em lote devem exigir revisão dos registros correspondentes e confirmar o impacto.
- Limites sugeridos para primeira versão (ajustáveis): criação em lote até 100, atualização até 200; manter exclusão em lote desabilitada até haver fluxo robusto de revisão/recuperação.

## 11. Segurança, privacidade e auditoria

- Proteger arquivos anexos em armazenamento privado; links de download devem expirar.
- Criptografar tráfego e dados sensíveis em repouso; separar segredos de conexão dos dados funcionais.
- Consentimento Open Finance deve ser explícito, revogável e ter registro de data/escopo.
- Registrar auditoria de alterações de transação, fatura, orçamento, categoria e vínculo de conexão: ator, valor anterior, valor novo, data e origem.
- Não apagar silenciosamente compras/faturas ao excluir conta/cartão. Mostrar prévia de impacto e oferecer arquivamento como alternativa.
- Autorização deve sempre ser validada no backend por entidade/perfil; não confiar em IDs enviados pelo cliente.
- Dados de comprovantes e OCR podem conter dados pessoais; aplicar retenção e exclusão sob controle do usuário.

## 12. API de domínio sugerida

Exemplos conceituais; não constituem contrato final:

- `GET/POST /entities/{entityId}/accounts`
- `GET/POST /entities/{entityId}/cards`
- `GET /entities/{entityId}/transactions?from=&to=&basis=&cursor=`
- `POST /entities/{entityId}/transactions`
- `PATCH /entities/{entityId}/transactions/{transactionId}`
- `POST /entities/{entityId}/cards/{cardId}/invoices/{invoiceId}/payments`
- `POST /entities/{entityId}/cards/{cardId}/invoices/{invoiceId}/reopen`
- `GET /entities/{entityId}/cards/{cardId}/invoices?from=&to=`
- `POST /entities/{entityId}/connections/open-finance`
- `POST /entities/{entityId}/connections/{connectionId}/sync` (ação autorizada, com rate limit)
- `POST /entities/{entityId}/transactions/{transactionId}/attachments` (upload assinado)
- `GET /entities/{entityId}/reports/monthly-overview?month=`

Todas as rotas de escrita devem suportar autorização, validação, idempotência quando aplicável e log de auditoria.

## 13. Requisitos de aceitação essenciais

1. Registrar compra em cartão manual cria ou associa a transação ao ciclo correto da fatura.
2. Um estorno diminui o total da fatura e continua pesquisável/auditável.
3. Pagamento parcial reduz o valor aberto, fica associado à conta de origem e não marca a fatura como totalmente paga antes da quitação.
4. Pagamento excedente é exibido como crédito, não como receita.
5. Pagamento bancário importado e indicação manual não geram dois débitos no fluxo de caixa.
6. Relatório de caixa não duplica pagamento de fatura com compras; relatório por compras mostra as compras sem somar o pagamento como gasto da mesma categoria.
7. Parcela prevista vira parcela real ao sincronizar sem duplicação; divergência de centavos é preservada no valor real.
8. Desconectar Open Finance mantém dados históricos já importados.
9. Vincular cartão manual impede criação inadvertida de cartão duplicado e torna explícito o início de sincronização.
10. Uma transação pode ter vários anexos; tipo/tamanho não documentado em fontes deve ser validado conforme limites do produto.
11. Transação manual vencida e não paga é marcada atrasada; transação bancária confirmada não é marcada atrasada por simples comparação de datas.
12. Excluir conta/cartão com dados exibe antes o impacto e oferece arquivamento.

## 14. Questões a decidir antes da implementação

1. Quais plataformas serão suportadas no MVP (Android, iOS, web/desktop)?
2. Qual agregador/provedor Open Finance será usado e quais instituições, campos e histórico estão disponíveis?
3. Qual política para importar histórico inicial e vincular itens manuais já existentes?
4. Como calcular limite disponível para compras parceladas, autorizações pendentes e pagamentos parciais?
5. A fatura será fechada automaticamente na data de fechamento, por ação do usuário, ou conforme dados bancários?
6. Quais tipos, limites por arquivo e cotas por plano serão aceitos para anexos?
7. A remoção de transações/contas/cartões será exclusão lógica, exclusão definitiva ou arquivamento padrão?
8. Como apresentar cartões em visão de caixa, competência, orçamento e patrimônio sem dupla contagem?
9. Quais moedas, múltiplos perfis e permissões de compartilhamento entram no MVP?
10. Qual regra de arredondamento e tolerância de matching de parcelas será configurável?

## 15. Fontes e rastreabilidade

### Minhas Finanças

- [Central de Ajuda](https://minhasfinancas.app.br/ajuda) — tópicos de cartões, faturas, Open Finance, relatórios e recorrências.
- [Controlar despesas e conferir a fatura](https://minhasfinancas.app.br/ajuda/controlar-despesas-fatura) — fechamento define fatura; lançamento organiza compras; compras parceladas, fixas, estornos e crédito por pagamento excedente.
- [Pagar, antecipar ou reabrir uma fatura](https://minhasfinancas.app.br/ajuda/pagar-antecipar-reabrir-fatura) — pagamentos integrais/parciais associados a contas, antecipação, excedente e reabertura.
- [Entender parcelamentos no Open Finance](https://minhasfinancas.app.br/ajuda/parcelamentos-open-finance) — previsão de parcelas futuras, atualização pelas parcelas reais, diferenças de centavos e cancelamentos/estornos.
- [Open Finance](https://minhasfinancas.app.br/open-finance) — atualização, vinculação a contas/cartões existentes, importação sem histórico anterior ao vínculo, conciliação, categorização, desconexão e limitações de sincronização.
- [Descrição oficial do app no Google Play](https://play.google.com/store/apps/details?id=cicero.minhasfinancas&hl=pt_BR) — anexos de comprovantes/documentos e leitura de recibos por imagem.

### Organizze

- [Ajuda Organizze — lançar uma despesa](https://ajuda.organizze.com.br/hc/pt-br/articles/5662695438739-Web-Lan%C3%A7amentos-Como-lan%C3%A7ar-uma-despesa) — campos de lançamento e possibilidade de múltiplos anexos.
- [Ajuda Organizze — lançar uma receita](https://ajuda.organizze.com.br/hc/pt-br/articles/5662752085523-Web-Lan%C3%A7amentos-Como-lan%C3%A7ar-uma-receita) — campos de lançamento e possibilidade de múltiplos anexos.
- Descrições e esquemas das ferramentas MCP `organizze-gessy` e `organizze-vitor`, consultados na sessão de 25/09/2026 — regras de consulta por caixa versus transação, cartões manuais/conectados, faturas, restrições de edição, pagamentos, transferências, limites em lote, recorrências e relatórios.

> A documentação pública e as descrições dos MCPs não determinam todos os detalhes de implementação. Regras marcadas como “requisito proposto” ou “a confirmar” precisam de decisão de produto antes de serem tratadas como comportamento definitivo.
