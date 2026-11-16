---
name: onde foi meu dinheiro
description: Extrato bancário que responde em português e carimba a consulta que produziu o número.
colors:
  cover: "#1D3F73"
  cover-deep: "#16325C"
  page: "#F4EFE2"
  page-deep: "#EBE5D4"
  ink: "#1A2536"
  ink-soft: "#454F5E"
  stamp: "#A63B2E"
  sage: "#5F6F63"
  sage-deep: "#4C5C50"
  rule: "#CFC6B2"
typography:
  display:
    fontFamily: "Archivo Narrow, Archivo, system-ui, sans-serif"
    fontSize: "clamp(48px, 5.2vw, 72px)"
    fontWeight: 700
    lineHeight: "0.9"
    letterSpacing: "-0.035em"
  body:
    fontFamily: "Archivo, system-ui, sans-serif"
    fontSize: "16px"
    fontWeight: 400
    lineHeight: "1.45"
  label:
    fontFamily: "Cascadia Mono, ui-monospace, SFMono-Regular, Consolas, monospace"
    fontSize: "8.5px"
    fontWeight: 400
    lineHeight: "1.9"
    letterSpacing: "0.11em"
rounded:
  none: "0px"
spacing:
  rule: "28px"
  page: "44px"
  section: "38px"
components:
  button-primary:
    backgroundColor: "{colors.cover}"
    textColor: "{colors.page}"
    rounded: "{rounded.none}"
    padding: "9px 14px"
  button-cover-outline:
    backgroundColor: transparent
    textColor: "{colors.page}"
    rounded: "{rounded.none}"
    padding: "8px 13px"
  chip:
    backgroundColor: transparent
    textColor: "{colors.cover}"
    rounded: "{rounded.none}"
    padding: "2px 0"
  input-ask:
    backgroundColor: transparent
    textColor: "{colors.ink}"
    typography: "{typography.body}"
    rounded: "{rounded.none}"
    padding: "6px 0"
  tab-month:
    backgroundColor: "{colors.cover}"
    textColor: "{colors.page}"
    rounded: "{rounded.none}"
    width: "44px"
    height: "42px"
  tab-month-active:
    backgroundColor: "{colors.page}"
    textColor: "{colors.cover}"
    rounded: "{rounded.none}"
    width: "44px"
    height: "42px"
  proof-sheet:
    backgroundColor: "rgba(255, 255, 255, 0.62)"
    textColor: "{colors.ink}"
    rounded: "{rounded.none}"
    padding: "16px 18px 10px 24px"
  ledger-row:
    backgroundColor: transparent
    textColor: "{colors.ink}"
    rounded: "{rounded.none}"
    padding: "8px 0"
  stamp:
    backgroundColor: transparent
    textColor: "{colors.stamp}"
    rounded: "{rounded.none}"
    width: "136px"
    height: "64px"
  total:
    backgroundColor: transparent
    textColor: "{colors.ink}"
    rounded: "{rounded.none}"
    padding: "12px 0 10px"
---

# Design System: onde foi meu dinheiro

## Overview

**Creative North Star: "O saldo carimbado"**

A interface é uma caderneta de poupança aberta: capa azul-petróleo na barra e na lombada, página em papel cru pautado, lançamentos numerados e um carimbo vermelho-óxido que data o recorte conferido. Não é um painel de cartões com números soltos; é um livro-razão em que a resposta ocupa a mesma folha dos lançamentos que a compõem.

A densidade é de extrato impresso: linhas curtas, códigos de conta, colunas de valor e acumulado, réguas de 1px e tipografia condensada nos totais. A auditoria não é uma gaveta ao lado: é uma folha de prova translúcida pousada sobre a página, com o SQL que gerou o número. O visitante deve sentir que pode conferir cada centavo com o dedo na linha.

**Key Characteristics:**
- Capa azul contínua e lombada com abas de mês, emoldurando uma página de papel.
- Números grandes em Archivo Narrow, sempre com `tabular-nums`; metadados em mono caixa-alta.
- Uma única sombra no sistema: a folha de prova sobre a página.
- Cantos retos, fios de 1px, divisórias pontilhadas e carimbo girado.

## Colors

Paleta de agência bancária antiga: azul de capa, papel cru, tinta navalha, vermelho de carimbo e um sálvia discreto para saldo e entradas.

### Primary

- **Azul de capa** (#1D3F73): barra superior, lombada, ações primárias, abas ativas invertidas e o rodapé. É a moldura do livro, nunca o fundo do conteúdo.
- **Azul de capa fundo** (#16325C): estado hover das ações primárias e faixa do favicon.

### Secondary

- **Vermelho de carimbo** (#A63B2E): período conferido, códigos de conta, foco visível, erros de importação e a marca do total. Proveniência e correção, não despesa.
- **Sálvia** (#5F6F63): entradas, valores acumulados, rótulos secundários e legendas.
- **Sálvia fundo** (#4C5C50): a mesma família em texto pequeno sobre papel, para contraste AA.

### Neutral

- **Papel** (#F4EFE2): fundo da página, texto sobre a capa e superfícies de controle.
- **Papel fundo** (#EBE5D4): trilho de rolagem e profundidade da página.
- **Tinta** (#1A2536): texto principal, totais, réguas fortes.
- **Tinta suave** (#454F5E): parágrafos de resposta e textos auxiliares.
- **Régua** (#CFC6B2): fios finos, divisórias pontilhadas e bordas desativadas.

### Named Rules

**The Stamp Rule.** O vermelho de carimbo marca proveniência e código (período, 4.x, erro, foco). Valor gasto é tinta; entrada é sálvia. Vermelho nunca é usado para representar dinheiro.

**The Paper Rule.** O conteúdo vive sobre papel cru. Azul é moldura, não superfície de leitura; nenhum bloco de texto longo é colocado sobre a capa.

## Typography

**Display Font:** Archivo Narrow (com Archivo e system-ui)
**Body Font:** Archivo (com system-ui)
**Label/Mono Font:** Cascadia Mono (com ui-monospace, Consolas)

**Character:** Uma condensada de jornal para o dinheiro e uma grotesca neutra para a leitura; o mono entra como voz de máquina — códigos, períodos, parâmetros — e nunca como corpo de texto.

### Hierarchy

- **Display** (700, `clamp(48px, 5.2vw, 72px)`, 0.9, −0.035em): o total da consulta e contagens. Ocupa a linha 4.0, sozinho, com a fração em 0.44em.
- **Headline** (700, `clamp(22px, 2.2vw, 28px)`, 1.05, 0.045em, caixa-alta): título "Extrato de lançamentos" e cabeçalhos de seção.
- **Title** (500–700, 15–27px, 1.2): a pergunta do visitante e títulos de etapas. A pergunta usa 500 e measure de 26ch.
- **Body** (400, 12.5–16px, 1.45–1.65): respostas em português, linhas de lançamento e textos de apoio; measure de 60–75ch.
- **Label** (400, 7.5–10px, 0.11–0.22em, caixa-alta): metadados, cabeçalhos de coluna, códigos e assinaturas. Sempre em mono.

### Named Rules

**The Tabular Rule.** Todo valor monetário usa `font-variant-numeric: tabular-nums` e `white-space: nowrap`. Algarismos precisam alinhar na coluna, como num extrato impresso.

**The Machine Voice Rule.** Caixa-alta e mono são reservados para rótulo, código e prova. Frases da interface ficam em caixa mista e na grotesca.

## Layout

O livro é uma grade de duas colunas: lombada fixa de 64px e página fluida. A barra de capa tem 64px e permanece no topo; a lombada permanece à esquerda com as abas de mês. A página reserva `padding: 24px 44px 0` e um vão direito de `clamp(360px, 31vw, 440px)` para a folha de prova, que flutua sobre a borda. O conteúdo de leitura para em 1000px.

O ritmo vertical segue a pauta de 28px desenhada no fundo; seções começam com 38px e uma régua de 1px. Colunas de lançamento: 68px de código, histórico fluido, 138px de valor e 138px de acumulado. No total, 64px de código, valor fluido e 168px de metadados.

Breakpoints: em 1100px a folha de prova vira bottom sheet e o vão cai para 32px; em 900px as colunas de valor encolhem; em 760px a lombada vira uma faixa horizontal de abas, a capa cresce para 96px, a coluna de acumulado e a categoria somem, e o campo de consulta fica fixo na base da tela.

### Named Rules

**The Margin Rule.** A margem esquerda da página carrega a linha vermelha do caderno e a numeração; nada de conteúdo compete com ela. O olho encontra primeiro o código, depois a descrição, depois o valor.

## Elevation & Depth

O sistema é plano por padrão: profundidade vem de camadas tonais (capa, papel, papel fundo) e de réguas, não de sombras. A única elevação real é a folha de prova, que precisa parecer pousada sobre o papel; no celular ela sobe como gaveta e ganha uma sombra difusa acima.

Textura: ruído SVG sutil sobre o papel (opacidade 0.05) mais a pauta horizontal; a capa recebe listras verticais de 1px em branco a 2,8%. A tinta do total entra com um blur curto de 340ms, como tinta absorvendo.

### Shadow Vocabulary

- **Proof sheet (desktop)** (`box-shadow: 0 18px 40px rgba(14, 26, 44, 0.2)`): única sombra de superfície, sob a folha translúcida.
- **Proof sheet (mobile)** (`box-shadow: 0 -18px 40px rgba(14, 26, 44, 0.28)`): gaveta aberta sobre a página.
- **Scrim** (`background: rgba(11, 22, 40, 0.55)`): fecha o resto da página quando a prova sobe.

### Named Rules

**The One Shadow Rule.** Nenhum cartão, botão ou linha recebe sombra. Só a folha de prova (e seu scrim) projeta sombra; qualquer outra sombra é sinal de componente genérico.

## Shapes

Cantos retos em tudo. Formas se constroem com fios de 1px (réguas), 2px (total), pontilhados (linhas internas) e recortes de 10px com furos circulares na borda esquerda da folha de prova. O carimbo é um retângulo de 2px com segundo fio interno, girado em −6°; a aba de mês é um retângulo de 44×42px. Não há raios, pílulas, nem círculos decorativos; o único círculo é o furo de fichário.

## Components

### Buttons

- **Shape:** retangular, sem raio (`0px`), fio de 1px.
- **Primary ("Consultar"):** fundo azul de capa, texto papel, mono 8.5px em caixa-alta, `padding: 9px 14px`; hover escurece para o azul fundo. Desativado fica transparente com fio de régua e texto sálvia.
- **Cover ("Importar extrato"):** fantasma sobre a capa, fio papel a 48%, texto papel; hover inverte para papel sobre azul.
- **Text ("Ver todos os lançamentos", "ver a prova"):** sem caixa, sublinhado de 1px, mono 8.5px em caixa-alta.
- **Hover / Focus:** transições de 160ms; foco visível é contorno de 2px no vermelho de carimbo com offset de 2px, trocado para papel quando o fundo é azul.

### Chips

- **Style:** sem fundo; texto azul de capa 11.5px com sublinhado de 1px a 35%; `padding: 2px 0`.
- **State:** hover fecha o sublinhado; desativado usa sálvia e régua. No celular viram uma fita horizontal rolável, sem quebra.

### Cards / Containers

- **Corner Style:** nenhum raio; o sistema não usa cartões.
- **Background:** a página é o único contêiner; seções são separadas por régua de 1px e 38px de espaço.
- **Shadow Strategy:** ver Elevation; nada além da folha de prova.
- **Border:** 1px de tinta para cabeçalhos, 2px para o total, pontilhado para linhas internas.
- **Internal Padding:** 44px na página, 12–18px em blocos de aviso e recibo.

### Inputs / Fields

- **Style:** o campo de consulta é uma linha sublinhada de 1px, sem caixa; prefixo "›" no vermelho de carimbo; corpo em 15px.
- **Focus:** o campo não desenha anel próprio; o foco visível global (2px vermelho, offset 2px) aparece no contêiner.
- **Placeholder:** #6F6A5C, opacidade 1, 4.5:1 sobre o papel.
- **Disabled:** texto sálvia, campo ainda legível.

### Navigation

- **Cover:** marca em Archivo Narrow 23px e metadados em mono 8.5px; links em 12.5px com sublinhado de 1px no item atual; gap de 26px.
- **Spine:** abas empilhadas com número do mês em mono 7.5px e sigla em 9px; ativa inverte (papel sobre azul).
- **Mobile:** a navegação quebra para uma segunda linha dentro da capa; as abas viram faixa horizontal com rolagem e a lombada perde o título vertical.

### Signature Components

**Ledger row.** Grade de quatro colunas: código 4.x em vermelho, rótulo com contagem em mono, valor e acumulado em sálvia. Cada linha tem `padding: 8px 0` e divisória pontilhada; a última linha do top 5 pode não fechar o total, e uma nota em mono explica a diferença entre as linhas exibidas e o recorte inteiro.

**Period stamp.** Retângulo de 136×64px, fio de 2px mais fio interno de 1px, girado em −6°, com o período em Archivo Narrow 18px e "CONFERIDO" em mono 7px. Entra com a animação `press` de 420ms; enquanto a consulta roda, fica a 32% de opacidade.

**Proof sheet.** Folha translúcida de 300–368px fixa à direita (bottom sheet até 86dvh no mobile), com furos de fichário à esquerda, SQL em mono 10px com parâmetros destacados em vermelho, métricas em `dl` e o QuerySpec dentro de um `details`. No mobile o fundo sobe para quase opaco (0.985) para o SQL continuar legível; o scrim fica atrás dela e o foco é preso na folha.

**Month tab.** Aba de 44×42px com o número do mês em mono e a sigla; a ativa é papel com texto azul. No mobile ganha 54px de largura mínima e 34px de altura, em linha.

## Do's and Don'ts

### Do:

- **Do** alinhar todo valor em `tabular-nums` e manter a coluna de acumulado à direita.
- **Do** usar o código fixo da categoria (4.1–4.13) em toda linha, inclusive na lista de lançamentos e na prova.
- **Do** reservar o vermelho de carimbo para período, código, erro e foco; dinheiro é tinta ou sálvia.
- **Do** manter a folha de prova sobre a página no desktop e como gaveta com scrim no mobile, sempre fechável por Escape e pelo botão.
- **Do** garantir contraste AA no texto pequeno: tinta suave sobre papel, papel a 75% ou mais sobre azul.
- **Do** respeitar `prefers-reduced-motion`: as animações caem para 0.01ms.

### Don't:

- **Don't** transformar seções em cartões arredondados com sombra; a página é uma folha contínua.
- **Don't** usar cinza neutro sobre o azul da capa; tintar o texto de papel com opacidade.
- **Don't** colocar mais de uma sombra no sistema ou usar sombra como decoração.
- **Don't** escrever valores monetários em fonte proporcional; a coluna perde o alinhamento.
- **Don't** usar ícones ilustrativos ou pictogramas; setas tipográficas e códigos bastam.
- **Don't** animar cada seção na entrada; o momento é o carimbo e a tinta do total, uma vez por consulta.
