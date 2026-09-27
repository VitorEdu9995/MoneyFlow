# MoneyFlow

<!-- HEFESTO:INICIO -->
## Este repositorio e coordenado pelo Hefesto

Gerado em 2026-09-25 por `tools/adotar.py`. **Nao edite entre os marcadores** — o
bloco e reescrito quando as regras da frota mudam. Fora deles, o arquivo e seu.

**Onde as coisas ficam.** O codigo e aqui. As decisoes, incidentes e licoes deste
projeto ficam no vault do Hefesto, em `Projetos/moneyflow/`.
Nao crie pasta de documentacao paralela aqui: dois lugares para a mesma memoria viram
duas memorias que discordam.

**Board.** As issues vivem no Linear, time `ECO`, projeto `MoneyFlow`. Trabalho sem
issue e trabalho que ninguem enxerga depois — se for preciso agir sem issue, diga isso
no relatorio, em vez de deixar implicito.

### Se voce e um agente trabalhando neste repositorio

1. **Uma tarefa, do inicio ao fim.** Nao pegue trabalho vizinho porque "ja estava ali".
2. **Voce NAO faz merge.** Abrir PR e onde seu trabalho termina. Merge e decisao do
   humano, caso a caso, e autorizacao em branco nao existe.
3. **NUNCA** `git push --force`, `git reset --hard`, commitar segredo, alterar schema
   sem migration, ou apagar dado de producao.
4. **Se travar, PARE e escale** com o payload de bloqueio (contrato
   `Bloqueio@1.0` do Hefesto). Nao invente solucao — codigo inventado custa mais que a
   pergunta — e nao devolva o log de erro inteiro, que e caro de ler.
5. **Escreva em portugues do Brasil** em tudo que chega ao humano: PR, commit, relato.
   Identificador de codigo fica como esta.
6. **Leia com pontaria.** 83% do custo medido de uma tarefa e INPUT — o que voce LE.
   Use `grep`/`glob` para achar o trecho antes de abrir o arquivo inteiro.

### Se voce e o coordenador (Hermes)

**Voce nao poe a mao dentro deste repositorio.** O criterio e o LUGAR, nao o tamanho:
criar, editar ou apagar arquivo daqui, rodar build ou suite, ou commitar, e trabalho de
worker — do tamanho que for. Ler, diagnosticar e registrar no vault sao seus. Tamanho e
estimado ANTES de fazer e por isso e sempre subestimado; e trabalho feito a sua mao fica
sem contrato, sem worktree, sem revisao, sem recibo e sem custo medido: some do ledger.

Despache pelo Hefesto, nunca a mao:

```bash
python "C:/Users/vitor/Downloads/Empresas/Kodra Systems - Desenvolvimento/Hefesto/tools/despachar.py" --issue ECO-NN --turnos-estimados <n>
```

**Pedido direto do humano, sem issue no board?** Nao e licenca para fazer a mao — use
`--tarefa "<objetivo>" --contexto "<criterio de pronto>" --repo <este repo>`, que abre
uma issue local com branch e recibo proprios. O MCP do Linear e somente leitura, entao
abrir issue de verdade e acao do humano.

O despacho resolve sozinho o repositorio de destino a partir do projeto da issue, e
aplica os portoes de orcamento, roteamento, recursos e prova de modelo ANTES de criar
qualquer coisa. Montar despacho a mao pula portao, e portao pulado nao da erro — da
trabalho no lugar errado.

O resto esta em `C:/Users/vitor/Downloads/Empresas/Kodra Systems - Desenvolvimento/Hefesto/START.md` — leia ANTES de operar.
<!-- HEFESTO:FIM -->
