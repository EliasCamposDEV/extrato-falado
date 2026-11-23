# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Stack

Núcleo existente em TypeScript puro (Node 22, `node:sqlite`, sem build). UI: Vite + React + TypeScript, servida por um servidor Node pequeno que reusa o núcleo. Escolha confirmada pelo usuário; descartado Next.js por não persistir SQLite em serverless.

## Users

Duas audiências confirmadas:

- **Quem avalia o projeto**: desenvolvedor ou recrutador que abre a demo sem contexto e decide, em segundos, se vale ler o código. Não vai ler README antes de olhar a tela.
- **Quem olha o próprio dinheiro**: pessoa que exportou o extrato do banco e não sabe para onde foi o salário. Pergunta em português, não escreve SQL e não confia em número que não pode conferir.

## Product Purpose

Responder perguntas em linguagem natural sobre um extrato bancário com precisão contábil. Sucesso é quando a pessoa faz três perguntas seguidas e nenhuma resposta precisa ser conferida na mão, e quando quem avalia o projeto entende o mecanismo sem abrir o código.

## Positioning

"O modelo planeja, o banco calcula": o LLM nunca produz um número, só um AST validado; quem soma é o SQLite. Toda resposta expõe o SQL que a gerou. Um chat com dados concorrente não pode copiar isso sem abrir mão da própria arquitetura.

## Operating Context

Demo pública de portfólio, aberta em desktop e celular, muitas vezes sem interação (o visitante só olha). Uso real acontece em sessão curta, no fim do mês, com o extrato exportado em CSV, OFX ou PDF. Sem login, sem servidor remoto de dados: o extrato fica no SQLite local do processo.

## Capabilities and Constraints

- Importa CSV (data/descrição/valor, separador `;`, `,` ou tab), OFX e PDF (Caixa com OCR, BB, PicPay e Santander), com conferência de saldo e dédupe.
- Recusa arquivo que não é extrato (sem lançamento, sem assinatura de PDF ou sem marcador de extrato) sem apagar os dados já carregados.
- API local: só loopback, `POST` em JSON, `Host`/`Origin` de loopback e cabeçalhos de segurança; corpo limitado por rota.
- Categorização por regra e, no que sobra, kNN TF-IDF offline; toda classificação é auditável.
- Planner heurístico roda sem chave de API; planner LLM é opcional e devolve `fora do escopo` quando não entende.
- Intents suportados: soma, contagem, média, ranking e listagem, com filtros de período, categoria, estabelecimento, direção e faixa de valor.
- Dinheiro sempre em centavos inteiros; SQL sempre parametrizado.
- Sem contas de usuário, sem sincronização, sem Open Finance.

## Evidence on Hand

- `data/sample-extrato.csv`, 61 lançamentos fictícios, ago–nov/2026 (rotular como sintético na interface).
- `npm run eval` - 12/12 no planner e na resposta; `npm test` - 65 testes.
- README com a arquitetura e as decisões.

Não existem clientes, depoimentos, números de uso ou benchmarks externos. Nada disso pode ser fabricado.

## Product Principles

1. O número nunca é opinião: se não veio do SQLite, não aparece na tela.
2. Mostrar o mecanismo, não só o resultado, o SQL é parte da resposta, não um detalhe técnico escondido.
3. Confiança antes de encanto: a interface pode ter personalidade, mas nunca ao custo de legibilidade do valor.
4. Dado sintético é declarado como sintético.
5. Uma pergunta por vez, com o contexto do período sempre visível.

## Accessibility & Inclusion

Contraste suficiente para leitura de valores em tela de celular sob luz ruim. Navegação completa por teclado, foco visível, e o SQL exposto em texto selecionável. Nenhum requisito de acessibilidade formal foi estabelecido pelo usuário.

Tema visual único (papel + carimbo, sem dark mode) é decisão intencional do design system; não há variante escura.
