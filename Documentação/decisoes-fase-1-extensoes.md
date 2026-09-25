# Decisões de Arquitetura e Extensões do Domínio — Fase 1 (ECO-61)

**Data:** 25/09/2026  
**Status:** Fechado e Implementado

Este documento registra as decisões técnicas e as observações do usuário consolidadas na **Fase 1 (Extensão)** do MoneyFlow, preservando a imutabilidade do catálogo inicial das 62 ferramentas MCP e garantindo o isolamento multi-espaço.

---

## 1. Atributos Personalizados por Espaço e Categoria

1. **Escopo e Tipagem Estrita:**
   - Podem ser vinculados ao espaço inteiro ou a uma categoria específica.
   - Tipos suportados: `text`, `number`, `currency` (centavos), `date`, `boolean`, `select` (com lista permitida), `barcode`.
   - Modos: valor único ou múltiplo (`is_multiple`), opcional ou obrigatório (`is_required`).
2. **Versionamento e Preservação de Histórico:**
   - Renomear um atributo altera apenas a definição atual sem romper o vínculo histórico de lançamentos passados.
   - Mudança de tipo de dado (`data_type`) cria automaticamente uma nova versão (`version + 1`), arquivando a versão anterior.
   - Atributos arquivados (`archived_at IS NOT NULL`) permanecem visíveis para leitura em lançamentos antigos, mas impedem novos usos ou atualizações.
3. **Casos de Uso do Usuário:**
   - Lançamentos e agendamentos/recorrências agora suportam atributos como código de barras de boleto, linha digitável, vencimentos complementares e dados de faturamento sem poluir campos fixos.
   - Cada ocorrência recorrente armazena seu snapshot de atributos.

---

## 2. Locais de Compra (`purchase_locations`)

1. **Separação entre Marca/Rede e Filial:**
   - Campo `brand_name` (obrigatório, ex: "Pão de Açúcar", "Posto Ipiranga", "Amazon").
   - Campo `branch_name` (opcional, ex: "Filial Moema", "Av. Paulista", "Online").
   - Endereço, cidade, estado e país para enriquecimento geográfico opcional.
2. **Isolamento e Rastreamento:**
   - Totalmente restrito a `space_id`.
   - Compras, itens e preços são diretamente associados ao local, permitindo comparar preços entre diferentes filiais e redes ao longo do tempo.

---

## 3. Catálogo de Produtos e Resolução

1. **Identificação e Deduplicação:**
   - Se possuir código de barras (`barcode` EAN/GTIN/UPC), o barcode é o identificador único estrito por espaço. Conflitos de barcode entre produtos diferentes disparam `BARCODE_CONFLICT`.
   - Na ausência de barcode, o produto é identificado por chave normalizada: `normalized_name` (minúsculo sem diacríticos) + `brand` + `default_unit`.
2. **Mesclagem Administrativa (`merge_products`):**
   - Reservada a usuários com papel `admin` ou `owner`.
   - Reatribui itens de compras e histórico de preços ao produto consolidado.
   - Produtos com códigos de barras diferentes e divergentes são proibidos de fundir por segurança adversarial.

---

## 4. Compra-Pai com Itens-Filhos e Soma Exata

1. **Criação Atômica:**
   - Uma única chamada cria a transação de débito no caixa, o cabeçalho da compra (`purchases`) e todos os itens (`purchase_items`).
   - Quantidades decimais suportadas (ex: `1.542` kg).
   - Unidades permitidas: `un`, `kg`, `g`, `l`, `ml`, `m`, `cx`, `pacote`.
2. **Integridade Monetária e Conciliação:**
   - Todos os valores são calculados em centavos inteiros (`INTEGER`).
   - A soma dos itens (`subtotal`) com `discount_amount` e `addition_amount` (frete/taxas) resulta deterministicamente em `net_amount`, que coincide exatamente com o valor da transação financeira.
3. **Separação Caixa vs. Competência por Categoria:**
   - **Fluxo de Caixa:** A compra-pai gera um único lançamento/débito no extrato da conta/cartão, evitando contar cada item individualmente e mantendo a conciliação bancária correta.
   - **Visão por Categoria:** Cada item-filho possui sua própria `category_id`. Assim, uma compra de supermercado pode debitar R$ 300,00 no caixa e distribuir R$ 150,00 em "Alimentação", R$ 80,00 em "Limpeza" e R$ 70,00 em "Higiene".

---

## 5. Devoluções e Estornos Vinculados (`item_refunds`)

1. **Rastreabilidade Fiel:**
   - O item original nunca é apagado ou mutado silenciosamente.
   - A devolução referencia o `purchase_item_id`, a quantidade devolvida e o valor estornado.
2. **Consistência de Saldos:**
   - A soma das quantidades devolvidas não pode ultrapassar a quantidade do item (`REFUND_EXCEEDS_QUANTITY`).
   - A soma dos valores estornados não pode ultrapassar o valor líquido do item (`REFUND_EXCEEDS_AMOUNT`).
   - O sistema calcula e exibe: valor bruto, devolvido e líquido pós-estorno.
   - Pode gerar opcionalmente a transação financeira de estorno (`type = 'refund'`).

---

## 6. Histórico Auditável de Preços (`price_history`)

1. **Registro Automático:**
   - A cada compra finalizada com itens associados a produtos, o preço unitário efetivamente pago (líquido de descontos) é gravado no histórico com data, local, quantidade e moeda.
2. **Comparação Histórica:**
   - Permite consultar evolução de preços de produtos específicos filtrados por estabelecimento ou período.

---

## 7. Matriz de Autorização Refinada

- `viewer`: somente leitura de compras, itens, locais e relatórios. Deny-by-default para mutações.
- `editor`: cria e edita compras, itens, locais, produtos e devoluções.
- `admin`: tudo do editor + gerencia definições de atributos e executa mesclagens de produtos/locais.
- `owner`: controle irrestrito do espaço e membros.
