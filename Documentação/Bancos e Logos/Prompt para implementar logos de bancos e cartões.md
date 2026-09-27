# Prompt para implementar logos de bancos e cartões

Quero que você implemente no meu sistema de controle financeiro um catálogo de logos para ser utilizado no cadastro de bancos, instituições financeiras e cartões.

## Objetivo

Ao cadastrar ou editar uma conta bancária, banco, instituição financeira ou cartão, o usuário deve poder escolher facilmente a logo correspondente em uma lista de opções pré-cadastradas.

A experiência deve ser simples, visual, rápida e adequada para usuários que não conhecem o nome jurídico das instituições.

## Catálogo inicial de logos

Use como catálogo inicial a planilha anexada:

`instituicoes_bancarias_com_logo.xlsx`

A planilha contém 150 instituições com:

- `Nome popular`: nome comercial que deve ser exibido ao usuário, por exemplo, **Nubank**, e não `NU PAGAMENTOS - IP`;
- `Link da logo`: URL da imagem da logo;
- links clicáveis para as imagens das logos.

A fonte original dos dados é:

`https://brasilapi.com.br/api/banks/v1`

Importante: o sistema deve usar o **nome popular** para exibição. O nome jurídico ou original da API pode ser armazenado internamente apenas para referência, auditoria ou integração.

## Requisitos funcionais

### 1. Cadastro de banco ou instituição financeira

No formulário de cadastro de uma conta, banco ou instituição financeira, adicionar um campo:

**Logo da instituição**

Esse campo deve permitir:

- visualizar a logo atualmente selecionada;
- pesquisar pelo nome popular;
- pesquisar também por nome jurídico, código bancário ou alias, quando disponível;
- abrir uma grade ou lista visual com as logos;
- selecionar uma logo clicando nela;
- alterar ou remover a logo selecionada;
- mostrar uma opção **Sem logo**;
- manter a seleção ao editar um cadastro já existente.

O nome exibido na lista deve ser o nome popular, com capitalização normal e sem siglas jurídicas desnecessárias.

Exemplos:

- `NU PAGAMENTOS - IP` deve aparecer como **Nubank**;
- `PAGSEGURO INTERNET IP S.A.` deve aparecer como **PagBank**;
- `BCO SANTANDER (BRASIL) S.A.` deve aparecer como **Santander**;
- `BCO BRADESCO S.A.` deve aparecer como **Bradesco**;
- `BANCO INTER` deve aparecer como **Inter**.

### 2. Cadastro de cartão

No formulário de cadastro de cartão, adicionar campos para:

- instituição emissora;
- nome do cartão;
- logo do banco ou emissor;
- bandeira do cartão, quando aplicável;
- logo da bandeira, quando aplicável;
- cor principal ou cor personalizada do cartão;
- opção de usar a logo da instituição como logo padrão do cartão.

O usuário deve poder escolher uma logo existente do catálogo também no cadastro de cartões.

A instituição e a bandeira devem ser campos separados. Por exemplo:

- Instituição: **Nubank**;
- Cartão: **Nubank Ultravioleta**;
- Bandeira: **Mastercard**.

### 3. Visualização nos lançamentos

Sempre que uma conta, banco ou cartão for exibido no sistema, mostrar:

- logo em tamanho reduzido;
- nome popular;
- fallback visual caso a logo não carregue;
- texto alternativo acessível com o nome da instituição.

A logo deve aparecer, quando aplicável, em:

- lista de contas;
- lista de cartões;
- dashboard;
- filtros;
- telas de lançamento de receitas e despesas;
- transferências;
- conciliação bancária;
- relatórios;
- seleção de conta de origem e destino.

## Estrutura de dados sugerida

Criar uma tabela ou coleção de catálogo de instituições com campos equivalentes a:

```text
id
nome_popular
nome_original
aliases
codigo_bancario
ispb
logo_url
tipo
ativo
created_at
updated_at
```

Criar ou adaptar a tabela de contas para armazenar:

```text
instituicao_id
logo_url_customizada
```

Criar ou adaptar a tabela de cartões para armazenar:

```text
instituicao_id
nome_cartao
bandeira
logo_url
cor_principal
```

Regras importantes:

- armazenar o identificador da instituição sempre que possível, e não apenas o texto do nome;
- manter `logo_url` separado do nome da instituição;
- permitir logo personalizada para casos em que o usuário não queira usar a logo padrão;
- não apagar a logo existente quando o catálogo for atualizado;
- se uma instituição for desativada no catálogo, preservar os cadastros antigos que já a utilizam;
- impedir registros duplicados da mesma instituição quando houver código bancário ou ISPB disponível.

## Importação do catálogo

Criar uma rotina de importação da planilha XLSX com estas regras:

1. ler a aba principal de instituições;
2. importar `Nome popular` para `nome_popular`;
3. importar `Link da logo` para `logo_url`;
4. preservar acentos e capitalização;
5. evitar duplicidades usando código bancário, ISPB, URL da logo ou combinação de nome;
6. permitir reprocessar a planilha sem criar registros duplicados;
7. registrar data e origem da importação;
8. disponibilizar uma forma segura de atualizar o catálogo no futuro.

Se o sistema for web, prefira baixar e armazenar uma cópia local ou em storage próprio das logos, mantendo a URL original como referência. Caso opte por carregar diretamente as URLs externas, implementar timeout, fallback e tratamento de erro para imagens indisponíveis.

## Componente visual de seleção

Criar um componente reutilizável chamado, por exemplo, `InstitutionLogoPicker` ou `LogoPicker` com:

- campo de pesquisa;
- grid responsivo de logos;
- nome popular abaixo de cada logo;
- estado selecionado claramente indicado;
- navegação por teclado;
- foco visível;
- texto alternativo em todas as imagens;
- carregamento progressivo das imagens;
- placeholder durante o carregamento;
- fallback quando a imagem falhar;
- suporte a telas pequenas e dispositivos móveis;
- opção de limpar a seleção.

A seleção deve ser possível tanto clicando na logo quanto no nome da instituição.

## Experiência e usabilidade

- Exibir primeiro as instituições mais utilizadas ou recentemente selecionadas;
- permitir favoritos;
- permitir pesquisar sem diferenciar maiúsculas e minúsculas;
- aceitar busca por termos como `nubank`, `nu pagamentos`, `inter` e `banco inter`;
- não exibir nomes jurídicos longos na interface principal;
- usar tooltip ou tela de detalhes para mostrar o nome original, quando necessário;
- preservar a seleção ao voltar ou avançar no formulário;
- mostrar mensagem clara quando nenhum resultado for encontrado;
- permitir cadastrar uma instituição manualmente com logo personalizada.

## Acessibilidade

- Todas as logos devem ter `alt` com o nome popular;
- a seleção deve funcionar sem mouse;
- a logo não pode ser o único indicador visual da instituição;
- manter contraste adequado entre logo, fundo e estado selecionado;
- não depender apenas de cores para indicar a opção selecionada;
- garantir funcionamento com leitor de tela.

## Segurança e confiabilidade

- validar URLs de logo antes de exibi-las;
- aceitar somente `https` para URLs externas;
- evitar HTML ou scripts vindos dos campos de nome e URL;
- sanitizar nomes importados da planilha;
- tratar falhas de rede e imagens removidas;
- usar cache ou storage próprio para reduzir dependência de terceiros;
- não quebrar o cadastro caso uma logo esteja indisponível.

## Critérios de aceite

Considere a implementação concluída somente quando:

1. for possível cadastrar uma conta escolhendo uma logo visualmente;
2. for possível editar a conta e manter ou alterar a logo;
3. for possível cadastrar um cartão escolhendo instituição e bandeira;
4. a busca localizar instituições pelo nome popular e por aliases;
5. o catálogo inicial tiver as 150 instituições da planilha;
6. **Nubank** aparecer como nome popular, e não como `NU PAGAMENTOS - IP`;
7. as logos aparecerem nas listas, dashboards e seletores relevantes;
8. houver fallback para logos que falharem;
9. os links não forem perdidos durante a importação ou atualização;
10. não forem criados registros duplicados ao importar a mesma planilha novamente;
11. a interface funcionar em desktop e celular;
12. a seleção for acessível por teclado e leitor de tela;
13. existirem testes para importação, busca, seleção, edição e fallback de imagem.

Antes de finalizar, mostre um resumo dos arquivos alterados, da estrutura de dados criada e dos testes executados.
