# Onde foi meu dinheiro

Chat sobre o seu extrato bancário que **nunca erra a conta**.

Você pergunta em português — _"quanto gastei com delivery em outubro?"_ — e recebe o valor exato, com o SQL que gerou o número na tela.

---

## O problema

Todo mundo abre o extrato, olha, fecha e continua sem saber para onde foi o salário. Os apps de banco mostram gráfico, mas não respondem pergunta específica — e quando respondem, é num chat genérico que **inventa números**.

## Como funciona

A regra é uma: **o modelo traduz, o banco soma.** Todo projeto de "converse com seus dados" falha no mesmo ponto — deixa o LLM somar, e LLM soma mal. Aqui ele nunca vê um valor:

```
pergunta ──▶ QuerySpec (JSON validado) ──▶ SQL parametrizado ──▶ SQLite (centavos) ──▶ frase em pt-BR
```

Três regras que sustentam o projeto:

1. **O modelo é compilador, não calculadora.** Ele só traduz a pergunta para um filtro estruturado.
2. **Só o SQLite produz números.** Nenhum valor passa pelo LLM, então errar a conta é impossível por construção.
3. **Toda resposta é auditável.** O SQL aparece junto — dá para conferir em vez de confiar.

## Arquitetura

### O caminho do número

| # | Etapa | Onde | O que acontece |
|---|---|---|---|
| 1 | **traduzir** | `src/planner/` | pergunta + data de hoje → `QuerySpec`. Heurístico offline por padrão; LLM opcional (`PLANNER=openai`), com provedor secundário e volta automática para o heurístico. O modelo nunca vê um valor e não escreve SQL. |
| 2 | **validar** | `src/query/spec.ts` | campos, formato, faixa e coerência. Erro sai com mensagem acionável e, no LLM, volta como contexto (repair loop). Pergunta fora do extrato é recusada. |
| 3 | **compilar** | `src/query/compile.ts` | `QuerySpec` → SQL com `?` em cada valor. Nenhum trecho da pergunta entra na string. |
| 4 | **executar** | `src/query/execute.ts` | uma agregação no SQLite; total do recorte inteiro via `SUM(...) OVER ()`. Dinheiro é inteiro, em centavos. |
| 5 | **responder** | `src/query/render.ts` | template pt-BR sobre o número do banco; zero token somado. |

**Fora do caminho do número**, mas dentro do produto: importação e dédupe (`src/ingest/`), categorização (`src/categorize/`: regra → kNN TF-IDF → `Outros`), guard de contraparte (`src/query/guard.ts`), continuação por heurística (`src/query/context.ts`) e o resumo com os PDFs (`src/server.ts`).

### Extratos em PDF

Cada banco desenha o extrato de um jeito, então o import escolhe o parser pela **assinatura do texto**, não pelo nome do arquivo:

| Banco | Como é lido |
|---|---|
| Caixa | o PDF é uma imagem: OCR (`tesseract.js`, idioma `por`) e a cadeia de saldo corrige o dígito que o OCR embolou |
| Banco do Brasil | camada de texto; o favorecido vem na linha de baixo do histórico |
| PicPay | cabeçalho de dia com saldo de fechamento; descrição quebrada em várias linhas; o saldo de cada dia fecha a cadeia inteira |
| Santander (simplificado e consolidado) | camada de texto; no consolidado só a seção de movimentação é lida (os comprovantes repetem os mesmos Pix); o saldo depois de cada lançamento corrige o valor |

Nenhum número do PDF passa pelo LLM: o parser entrega lançamentos em centavos e o import recusa o arquivo se a cadeia de saldo não fechar.

### Arquivo que não é extrato

O import é fechado por padrão: na dúvida, recusa em vez de gravar lixo.

- CSV/OFX sem nenhum lançamento é **recusado** (`400`) e **não apaga** a amostra fictícia.
- PDF sem a assinatura `%PDF-`, acima de 8 MB ou sem lançamento/saldo reconhecido é recusado.
- O parser genérico (último recurso) só aceita o documento se o texto se identifica como extrato (`extrato`, `movimentação`, `lançamentos` ou `conta corrente`) e tem pelo menos duas linhas de lançamento. Um contrato ou boleto com data e valor no meio não vira transação.
- OCR só roda quando o PDF quase não tem camada de texto (o print da Caixa tem 16 caracteres), com no máximo 4 imagens e 60 s; antes, qualquer imagem embutida disparava o reconhecimento.

### Segurança da API local

A API não tem login e escuta só em `127.0.0.1`. Além disso:

- `POST` exige `content-type: application/json` (fecha formulário cross-site) e recusa `Origin` que não seja loopback.
- `Host` que não seja `localhost`/`127.0.0.1`/`::1` é recusado — proteção contra DNS rebinding.
- Corpo limitado por rota: 12 MB no import (8 MB de PDF em base64) e 256 KB nas demais.
- Toda resposta leva `Content-Security-Policy`, `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy` e `Permissions-Policy`.
- O arquivo importado não é salvo em disco; só os lançamentos normalizados entram no SQLite.

### Arquivos

| Arquivo | Papel |
|---|---|
| `src/query/spec.ts` | o AST do projeto: `Intent`, `Filters`, validação com mensagens acionáveis |
| `src/query/compile.ts` | `QuerySpec` → SQL 100% parametrizado |
| `src/query/execute.ts` | executa e devolve resultado tipado |
| `src/query/render.ts` | números → frase em português (template, não geração livre) |
| `src/query/guard.ts` | nome citado na pergunta vira filtro, mesmo que o planner esqueça |
| `src/query/context.ts` | continuação (`e no mês anterior?`) aplicada à spec anterior |
| `src/domain/` | vocabulário compartilhado: meses, limites de mês, limpeza e bloqueio da pergunta |
| `src/planner/fake.ts` | planner heurístico, offline, sem chave de API (padrão) |
| `src/planner/openai.ts` | planner via LLM (endpoint compatível com OpenAI), com fallback e repair loop |
| `src/ingest/` | CSV, OFX e PDF por banco (Caixa com OCR, BB, PicPay, Santander), conferência de saldo e dédupe |
| `src/categorize/` | regra → kNN TF-IDF → `Outros` |
| `src/eval/` | 12 casos com spec e resposta esperadas |
| `src/server.ts` | API local + super extrato e folha de prova em PDF |
| `web/src/` | React: caderneta, carimbo do período, folha de prova e recibo de importação |
| `web/src/styles.css` | sistema visual: paleta, tipografia, responsivo e movimento |
| `test/core.test.ts` | 37 testes de unidade (parsing CSV/OFX/PDF, validação, injeção de SQL, agregados, dédupe, guard, continuação, ponta a ponta) |
| `test/api.test.ts` | 28 testes de API: sobe o servidor com banco temporário e cobre saúde, resumo, período livre, consulta, comparação (mês e período livre), orçamento (mês e período rateado), reclassificação (inclusive o override que o import passa a usar), import, reset, PDF e as guardas de segurança |

### Rotas da API

| Rota | Função |
|---|---|
| `GET /api/health` | estado do banco, planner ativo e contas |
| `GET /api/summary` | resumo de um mês (`?month=`) ou período (`?from=&to=`): entradas, saídas, categorias, meses e contas |
| `GET /api/transactions` | lançamentos do mês ou período, com limite (combina `source`, `account` e `includeInternal`) |
| `GET /api/compare` | compara o mês (com o mês fechado anterior) ou um período livre (com o período anterior de mesmo tamanho) |
| `GET/POST/DELETE /api/budgets` | orçamento mensal por categoria com gasto e ritmo; o GET também aceita período livre (limite rateado pelos dias cobertos) |
| `PATCH /api/transactions/:id` | corrige a categoria de um lançamento; `applyAll` grava o override do estabelecimento |
| `POST /api/ask` | pergunta → `QuerySpec`, SQL, parâmetros, número e resposta |
| `POST /api/import` | CSV/OFX em texto ou PDF em base64, com recibo |
| `POST /api/reset` | apaga a amostra, o importado ou tudo |
| `GET /api/export/pdf` | super extrato com o mesmo recorte da tela (`?month=` ou `?from=&to=`, mais `source`/`account`/`includeInternal`) |
| `POST /api/export/proof` | folha de prova a partir da spec exibida, sem replanejar |
| `POST /api/spec-check` | valida uma spec crua (modo "ver filtro") |

## Interface web

A demo abre pronta no último mês completo e já mostra a resposta com o SQL ao lado — sem clique, sem configuração.

- **A pergunta vira lançamento.** O total entra na linha `4.0` com o carimbo do período; as categorias aparecem como linhas de extrato, com código fixo (`4.6` = Moradia), valor e acumulado.
- **A prova é uma camada.** A folha translúcida sobre a página traz o SQL executado, os parâmetros, o planner, o tempo, `0 tokens somados` e o `QuerySpec` completo.
- **Troca de mês pela lombada.** As abas de mês mudam o extrato inteiro: resumo, consulta padrão e lista de lançamentos.
- **Período livre.** Os campos `de`/`até` recortam resumo, lista e consulta para qualquer intervalo; `mês todo` volta para as abas. As rotas aceitam `?month=` ou `?from=&to=`.
- **Importa o seu arquivo.** CSV, OFX ou PDF (Caixa, BB, PicPay e Santander, com OCR quando o PDF é imagem), até 12 MB (8 MB no PDF), com recibo de linhas lidas, novas e já existentes. Arquivo que não é extrato é recusado sem apagar o que já estava carregado. O arquivo fica no SQLite do processo; nada sai da máquina.
- **Junta tudo num super extrato.** O botão `exportar PDF` gera um PDF com capa, resumo geral, resumo por conta, os lançamentos ordenados por data com subtotal por mês e o total geral — respeitando o período livre e a fonte escolhidos na tela.
- **Prova em papel.** A folha de prova tem um botão que baixa um PDF com a pergunta, a resposta, o número apurado, o SQL, os parâmetros e o `QuerySpec` — o mesmo recorte que estava na tela, sem replanejar.
- **Continua a conversa.** Depois de uma resposta, o chip `e no mês anterior?` refaz a consulta no mês anterior ao da pergunta (não ao do relógio), herdando intenção e filtros.
- **Responsivo de verdade.** Em 390px a prova sobe como bottom sheet com scrim, o campo de consulta gruda na base e as colunas secundárias somem.

Stack: Vite + React no cliente, Node + SQLite no servidor. O cliente só formata o que a API devolve; nenhuma soma acontece no navegador.

## Rodando

Requisitos: Node 22+ (usa `node:sqlite` e _type stripping_, então não há etapa de build).

```bash
npm install

npm run dev                             # API (8787) + interface (5173), com a amostra pronta
npm run import                          # importa data/sample-extrato.csv
npm run ask -- "quanto gastei em outubro"
npm run demo                            # 5 perguntas de demonstração
npm run eval                            # mede planner e resposta (heurístico)
npm run eval -- --llm                   # mede o planner configurado (usa a rede)
npm test                                # 65 testes (37 de unidade + 28 de API)
npm run typecheck
```

Para a versão de produção:

```bash
npm run build     # gera web/dist
npm start         # serve a interface e a API em http://127.0.0.1:8787
```

Roda **sem chave de API** por padrão. Para usar o planner LLM:

```bash
cp .env.example .env      # PLANNER=openai + OPENAI_API_KEY
npm run ask -- "quanto gastei com besteira em outubro"
```

## Saída real

```
Pergunta: para onde foi meu dinheiro em outubro
Filtro:   {"intent":"breakdown","filters":{"from":"2026-10-01","to":"2026-10-31","direction":"out"},"groupBy":"category","limit":5}
SQL:      SELECT category AS label, ABS(SUM(amount_cents)) AS total_cents, COUNT(*) AS n,
          SUM(ABS(SUM(amount_cents))) OVER () AS grand_total
          FROM transactions WHERE posted_at >= ? AND posted_at <= ? AND amount_cents < 0
          GROUP BY label ORDER BY total_cents DESC LIMIT ?
Params:   ["2026-10-01","2026-10-31",5]

Para onde foi o dinheiro em outubro de 2026:
   1. Moradia                       R$ 1.651,44   50%
   2. Supermercado                    R$ 632,65   19%
   3. Alimentação                     R$ 292,20    9%
   4. Transporte                      R$ 237,20    7%
   5. Transferências                  R$ 200,00    6%
```

O `SUM(...) OVER ()` garante que o total da resposta seja o do recorte inteiro (R$ 3.278,99), não a soma das cinco linhas exibidas (R$ 3.013,49).

## Avaliação

`npm run eval` mede **duas coisas separadas**, porque falham por motivos diferentes:

- **Planner** — o filtro gerado é o mesmo do gabarito? (o modelo entendeu a pergunta?)
- **Resposta** — o resultado executado é idêntico? (o número bateu?)

```
Planner heurístico (offline) · 12 casos
Planner:     12/12 (100%)
Resposta:    12/12 (100%)
```

O planner heurístico serve de **baseline**: uma LLM só se justifica se bater isso.

## Decisões que valem uma conversa

1. **Dinheiro em centavos (`INTEGER`).** `0.1 + 0.2 !== 0.3`; banco não pode ter esse problema.
2. **Nenhum valor entra na string do SQL.** Pergunta, categoria e nome de estabelecimento vão sempre como parâmetro do prepared statement — tem teste para isso.
3. **Repair loop no planner LLM.** Se a validação falha, o erro volta como contexto e o modelo tem uma segunda chance. Sem isso, uma em cada ~10 perguntas morre por um campo faltando.
4. **Template em vez de geração livre na resposta.** O texto é previsível, testável e não pode inventar um número que o SQL não devolveu.
5. **Regra antes de modelo na categorização.** `ifood → Alimentação` é explicável; quando o usuário discorda da categoria, "porque casou com a regra ifood" resolve a conversa. kNN entra só no que a regra não cobre.
6. **Dedupe pelo `fitid` do banco quando existe; senão por um id estável do lançamento.** Duas compras iguais no mesmo dia continuam sendo duas: a segunda ganha um sufixo, e reimportar o mesmo arquivo produz os mesmos sufixos e não duplica nada. Reimportar um PDF também não acusa saldo inconsistente, porque o saldo anterior vem do próprio extrato.
7. **`QuerySpec` com validação manual, sem framework.** O AST é pequeno; a mensagem de erro é o contrato com o LLM.
8. **Guard de contraparte.** Se a pergunta cita um nome que existe no extrato e o planner "esquece" o filtro, o servidor injeta `filters.text` — melhor recusar o total genérico do que devolver um número errado com cara de certo.
9. **Continuação sem modelo.** "E no mês anterior?" é resolvido por heurística determinística sobre a spec anterior; o modelo não vê o histórico, então não pode inventar um recorte novo.

## Limitações (de propósito, documentadas)

- O planner heurístico **ignora termo desconhecido**: "gastei em outubro com foguete" responde o total de outubro. O planner LLM devolve `fora do escopo`. É o custo de rodar offline.
- Categorização não é perfeita; breakdown por categoria é aproximado e não há revisão manual ainda.
- Import é manual (CSV/OFX/PDF). Sem Open Finance.
- "Média" usa valor absoluto; transferência entre contas próprias conta como gasto.

## Próximos passos

- [x] UI web (Vite + React) com o SQL visível sobre a resposta
- [ ] marcar transferência interna / estorno
- [ ] orçamento por categoria com alerta
- [ ] "por que essa categoria?" mostrando a regra que casou
- [ ] OFX reais de Nubank / Itaú / Inter + Open Finance

## Para o currículo

**Bullets:**

> Assistente de finanças pessoais que responde perguntas em linguagem natural sobre extratos bancários. Arquitetura "LLM planeja, SQL executa": o modelo gera um AST validado e o SQLite calcula, eliminando alucinação numérica (12/12 casos no eval, 65 testes, typecheck limpo).

> Planner com repair loop, validação de AST com mensagens acionáveis e SQL 100% parametrizado. Categorização híbrida regra + kNN TF-IDF, offline e a custo zero por transação.

**Pitch de 60 segundos:** "Todo projeto de chat com dados deixa o modelo fazer a conta. Eu inverti: o modelo só traduz a pergunta para um filtro JSON validado, e quem soma é o SQLite. Com isso o número não tem como estar errado, e a resposta vem com o SQL para você auditar. O eval mede separado se ele entendeu a pergunta e se o número bateu."

---

Dados de exemplo: `data/sample-extrato.csv` (fictício, 61 lançamentos de ago–nov/2026).
