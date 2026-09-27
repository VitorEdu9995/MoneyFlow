# ADR-0002: Catálogo Canônico de Instituições Bancárias, Bandeiras e Logos

## Status
Aprovado / Implementado

## Contexto
O MoneyFlow necessitava de um catálogo padronizado e auditável de instituições bancárias e bandeiras de cartão de crédito para eliminar inconsistências na identificação de contas e cartões (ex.: duplicidade entre nomes jurídicos como "NU PAGAMENTOS - IP" e nomes comerciais "Nubank"), além de permitir exibição visual rica com logotipos em SVG/PNG mantendo isolamento estrito multi-tenant.

## Decisões Tomadas

1. **Fonte de Verdade e Extrator Idempotente:**
   - O arquivo `Documentação/Bancos e Logos/instituicoes_bancarias_com_logo.xlsx` foi extraído para `instituicoes_catalogo.json` com exatamente 150 instituições (111 SVG e 39 PNG) mapeadas por ISPB.
   - O `CatalogImporter` executa a importação idempotente registrando hash SHA-256 do lote, evitando duplicações em re-execuções.

2. **Esquema de Dados Canônico (Migration 010):**
   - `institutions`: Armazena a identidade canônica (ISPB, nome popular prioritário, razão social opcional, código bancário).
   - `institution_aliases`: Mapeia variações de busca (ex: "nu", "nu pagamentos", "bco santander", "cef", "inter").
   - `logo_assets`: Metadados do arquivo (MIME type, formato, hash SHA-256, storage local).
   - `institution_logos`: Relacionamento 1:N entre instituição e assets de logo.
   - `card_brands`: Bandeiras padrão (Mastercard, Visa, Elo, Hipercard, Amex, Diners).
   - `institution_preferences`: Preferências de favorito e frequência de uso isoladas estritamente por `space_id` (multi-tenant anti-vazamento).
   - Colunas vinculadas em `accounts` (`institution_id`, `custom_logo_asset_id`, `use_institution_logo`) e `credit_cards` (`institution_id`, `card_brand_id`, `custom_logo_asset_id`, `use_institution_logo`, `primary_color`).

3. **Segurança e Entrega de Assets:**
   - Entrega via rota REST `/api/v1/catalog/logos/:assetId` com cabeçalhos:
     * `X-Content-Type-Options: nosniff` (prevenção contra MIME-sniffing / XSS).
     * `Cache-Control: public, max-age=86400, immutable`.
     * `ETag: "<sha256>"`.
   - Consulta restrita à tabela `logo_assets` por ID determinístico (blindagem contra path traversal).
   - No frontend, renderização segura por `<img />` com tratamento de erro e fallback gracioso para monogramas com iniciais. Não há injeção de SVG arbitrário via innerHTML.

4. **Compatibilidade com Contratos MCP:**
   - A ferramenta congelada `list_institutions` foi enriquecida com `logo_url`, `ispb`, `bank_code` e `is_favorite`, mantendo 100% de retrocompatibilidade com o schema congelado original (`name`, `slug`, `query`).

## Consequências
- A experiência de onboarding e cadastro de contas e cartões passa a ser visual, precisa e auto-ordenada pelos bancos mais utilizados de cada espaço.
- 100% dos 143 testes automatizados (unitários, integração e adversariais) passam sem quebra.
