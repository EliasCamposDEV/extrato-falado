---
version: 1
slug: "web-src-app-tsx"
primary_target: "web/src/App.tsx"
related_targets: []
---

# Home — consulta sobre o extrato

Rota única `/`. Superfície **Operate**: o visitante vem fazer uma pergunta sobre o próprio dinheiro, e quem avalia vem ver o mecanismo funcionando. Sem login.

## Audiência e trabalho

- Quem avalia: abre a demo sem contexto, decide em segundos se lê o código. A tela precisa mostrar pergunta → SQL → número sem clique.
- Quem olha a própria conta: pergunta em português no fim do mês, não confia em número que não consegue conferir. A prova tem que estar na mesma página.

Tarefa primária: fazer uma pergunta e ver o valor com a consulta que o produziu. Tarefas secundárias: trocar de mês, importar CSV/OFX, ler os lançamentos, entender o mecanismo.

## Prova e conteúdo

- Valor, período, contagem e composição vindos de `/api/ask` (SQLite, centavos inteiros).
- SQL compilado, parâmetros, planner, tempo e `0 tokens somados` no painel de prova.
- 61 lançamentos sintéticos (ago–nov/2026), declarados como sintéticos em toda tela.
- Demo abre pronta no último mês completo, e aceita arquivo do visitante.

## Restrições

- Nenhum número é calculado no cliente nem escrito pelo modelo; formatação sim, aritmética nova não.
- Sem contas, sem sincronização, sem servidor remoto de dados.
- pt-BR em toda a interface; teclado, foco visível, contraste AA.
- Mobile 390px é viewport de primeira classe.

## Direção escolhida

**O saldo carimbado** — caderneta de poupança: capa azul, página pautada, lançamento com código de conta, coluna de acumulado e carimbo do período. A folha de prova translúcida fica sobre a página, não ao lado: a auditoria é uma camada do mesmo objeto.

Momento memorável: a resposta entra como lançamento — o total é carimbado sob o olho, e o valor anterior some sob a tinta.

## Direction contract

### THESIS

Toda resposta é um lançamento carimbado numa caderneta que nunca fecha: o valor entra na coluna do acumulado e o comprovante da consulta é uma folha de prova translúcida sobre a página. Recusa o dashboard de cartões e a fileira de números soltos.

### OWN-WORLD

Capa azul-petróleo `#1D3F73` ocupa barra e lombada; página em papel cru `#F4EFE2` com pauta fina; tinta `#1A2536`; carimbo vermelho-óxido `#A63B2E` só para proveniência e códigos; sálvia `#5F6F63` para saldo e entradas. Cantos retos, fios de 1px, réguas pontilhadas, numeração de conta 4.1–4.13, carimbo girado do período.

### STORY

O visitante entende que a pergunta virou filtros, que o SQLite somou e que o total foi conferido; acredita no número porque a consulta está na mesma folha; faz a segunda pergunta ou sobe o próprio extrato.

### FIRST VIEWPORT

1440×900. Barra azul de 64px com marca e Importar. Lombada de 64px com abas de mês. Página crua: cabeçalho do extrato, a pergunta em 25px, carimbo girado à direita, linha 4.0 com o total em ~68px e o acumulado à direita; cinco linhas de categoria com código, valor e acumulado; campo de consulta na base. Folha de prova de 360px flutua sobre a borda direita da página, com SQL, parâmetros e fontes.

### FORM

4ª de 7 na lista ordenada; seed:4ce5876e46d18d7d.

### FINISH

Unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance.

## Decisões em aberto

- Nenhuma bloqueante. Direção escolhida pelo usuário; build code-led.
