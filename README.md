# Extrato Falado

Chat sobre o seu extrato bancário que **nunca erra a conta**.

Você pergunta em português, _"quanto gastei com delivery em outubro?"_, e recebe o valor exato, com o SQL que gerou o número na tela.

---

## O problema

Todo mundo abre o extrato, olha, fecha e continua sem saber para onde foi o salário. Os apps de banco mostram gráfico, mas não respondem pergunta específica, e quando respondem, é num chat genérico que **inventa números**.

## Como funciona

A regra é uma: **o modelo traduz, o banco soma.** Todo projeto de "converse com seus dados" falha no mesmo ponto, deixa o LLM somar, e LLM soma mal. Aqui ele nunca vê um valor:

```
pergunta ──▶ QuerySpec (JSON validado) ──▶ SQL parametrizado ──▶ SQLite (centavos) ──▶ frase em pt-BR
```

Três regras que sustentam o projeto:

1. **O modelo é compilador, não calculadora.** Ele só traduz a pergunta para um filtro estruturado.
2. **Só o SQLite produz números.** Nenhum valor passa pelo LLM, então errar a conta é impossível por construção.
3. **Toda resposta é auditável.** O SQL aparece junto, dá para conferir em vez de confiar.

## Arquitetura

### O caminho do número

| # | Etapa | Onde | O que acontece |
|---|---|---|---|
| 1 | **traduzir** | `src/planner/` | pergunta + data de hoje → `QuerySpec`. Heurístico offline por padrão; LLM opcional (`PLANNER=openai`), com provedor secundário e volta automática para o heurístico. O modelo nunca vê um valor e não escreve SQL. |
| 2 | **validar** | `src/query/spec.ts` | campos, formato, faixa e coerência. Erro sai com mensagem acionável e, no LLM, volta como contexto (repair loop). Pergunta fora do extrato é recusada. |
| 3 | **compilar** | `src/query/compile.ts` | `QuerySpec` → SQL com `?` em cada valor. Nenhum trecho da pergunta entra na string. |
| 4 | **executar** | `src/query/execute.ts` | uma agregação no SQLite; total do recorte inteiro via `SUM(...) OVER ()`. Dinheiro é inteiro, em centavos. |
| 5 | **responder** | `src/query/render.ts` | template pt-BR sobre o número do banco; zero token somado. |

**Fora do caminho do número**, mas dentro do produto: importação e dédupe (`src/ingest/`), categorização (`src/categorize/`: regra → kNN TF-IDF → `Outros`), guard de contraparte (`src/query/guard.ts`), continuação por heurística (`src/query/context.ts`) e o resumo com os PDFs (`src/stats.ts` e `src/export-pdf.ts`).

### Extratos em PDF

Cada banco desenha o extrato de um jeito, então o import escolhe o parser pela **assinatura do texto**, não pelo nome do arquivo:

| Banco | Como é lido |
|---|---|
| Caixa | o PDF é uma imagem: OCR (`tesseract.js`, idioma `por`) e a cadeia de saldo corrige o dígito que o OCR embolou |
| Banco do Brasil | camada de texto; o favorecido vem na linha de baixo do histórico |
| PicPay | cabeçalho de dia com saldo de fechamento; descrição quebrada em várias linhas; o saldo de cada dia fecha a cadeia inteira |
| Nubank | camada de texto; cada dia agrupa entradas e saídas; o total do dia fecha a cadeia |

Nenhum número do PDF passa pelo LLM: o parser entrega lançamentos em centavos e o import recusa o arquivo se a cadeia de saldo não fechar.

### Fatura de cartão

Compra de cartão tem duas datas: quando você comprou e em qual fatura ela caiu. O import guarda as duas (`posted_at` e `invoice_month`):

- **O mês da fatura vem do arquivo** quando o texto se identifica como fatura (`cartão de crédito final`, `fatura`, `vencimento`, `limite disponível`); o vencimento é a âncora. Se o arquivo não se anuncia, dá para informar o mês no campo `fatura` da tela (ou `invoiceMonth` na API).
- **Parcelamento vira coluna.** `PARCELA 3/10`, `parcela 2 de 6`, `(4/12)` e o sufixo `1/3` viram `installment_no`/`installment_total` e saem da descrição, o estabelecimento continua o mesmo para categorizar e agrupar.
- **`fatura de outubro` filtra `invoice_month`, não `posted_at`.** A compra de agosto que caiu na fatura de outubro entra no total de outubro uma única vez; reimportar a fatura não duplica nada.

### Arquivo que não é extrato

O import é fechado por padrão: na dúvida, recusa em vez de gravar lixo.

- CSV/OFX sem nenhum lançamento é **recusado** (`400`) e **não apaga** a amostra fictícia.
- PDF sem a assinatura `%PDF-`, acima de 8 MB ou sem lançamento/saldo reconhecido é recusado.
- O parser genérico (último recurso) só aceita o documento se o texto se identifica como extrato (`extrato`, `movimentação`, `lançamentos` ou `conta corrente`) e tem pelo menos duas linhas de lançamento. Um contrato ou boleto com data e valor no meio não vira transação.
- OCR só roda quando o PDF quase não tem camada de texto (o print da Caixa tem 16 caracteres), com no máximo 4 imagens e 60 s; antes, qualquer imagem embutida disparava o reconhecimento.

### Segurança da API local

A API não tem login e escuta só em `127.0.0.1`. Além disso:

- `POST` exige `content-type: application/json` (fecha formulário cross-site) e recusa `Origin` que não seja loopback.
- `Host` que não seja `localhost`/`127.0.0.1`/`::1` é recusado, proteção contra DNS rebinding.
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
| `src/domain/` | vocabulário compartilhado: meses, limites de mês, limpeza e bloqueio da pergunta, fatura e parcelamento |
| `src/planner/fake.ts` | planner heurístico, offline, sem chave de API (padrão) |
| `src/planner/openai.ts` | planner via LLM (endpoint compatível com OpenAI), com fallback e repair loop |
| `src/ingest/` | CSV, OFX e PDF por banco (Caixa com OCR, BB, PicPay, Santander), conta detectada pelo conteúdo, fatura, conferência de saldo e dédupe |
| `src/categorize/` | regra → kNN TF-IDF → `Outros` |
| `src/eval/` | 12 casos com spec e resposta esperadas |
| `src/server.ts` | API local: roteamento, validação e guardas de segurança |
| `src/stats.ts` | consultas de resumo, comparação, orçamento e lançamentos (todo valor sai do SQLite) |
| `src/export-pdf.ts` | super extrato e folha de prova em PDF |
| `Dockerfile` / `render.yaml` | deploy em container com o SQLite em disco persistente |
| `vercel.json` / `scripts/build-api.mjs` | demo na Vercel: UI estática + o mesmo handler empacotado como função (`/tmp`) |
| `web/src/` | React: caderneta, carimbo do período, folha de prova e recibo de importação |
| `web/src/styles.css` | sistema visual: paleta, tipografia, responsivo e movimento |
| `test/core.test.ts` | 44 testes de unidade (parsing CSV/OFX/PDF, validação, injeção de SQL, agregados, dédupe, contas, fatura, guard, continuação, ponta a ponta) |
| `test/api.test.ts` | 35 testes de API: sobe o servidor com banco temporário e cobre saúde, resumo, período livre, consulta, comparação (mês e período livre), orçamento (mês e período rateado), reclassificação (inclusive o override que o import passa a usar), import, fatura, reset, PDF e as guardas de segurança |

### Rotas da API

| Rota | Função |
|---|---|
| `GET /api/health` | estado do banco, planner ativo e contas |
| `GET /api/summary` | resumo de um mês (`?month=`) ou período (`?from=&to=`): entradas, saídas, categorias, meses e contas; aceita `invoice=aaaa-mm` |
| `GET /api/transactions` | lançamentos do mês ou período, com limite (combina `source`, `account`, `invoice` e `includeInternal`) |
| `GET /api/invoices` | meses de fatura com total, quantidade de lançamentos e quantos são parcelas |
| `GET /api/compare` | compara o mês (com o mês fechado anterior) ou um período livre (com o período anterior de mesmo tamanho) |
| `GET/POST/DELETE /api/budgets` | orçamento mensal por categoria com gasto e ritmo; o GET também aceita período livre (limite rateado pelos dias cobertos) |
| `PATCH /api/transactions/:id` | corrige a categoria; `applyAll` grava o override do estabelecimento; `internalTransfer`/`refund` marcam transferência interna ou estorno |
| `GET /api/transactions/:id/explain` | por que essa categoria? (regra que casou, similaridade ou correção manual) |
| `POST /api/ask` | pergunta → `QuerySpec`, SQL, parâmetros, número e resposta; aceita `invoice` para amarrar a fatura |
| `POST /api/import` | CSV/OFX em texto ou PDF em base64, com recibo; `account`, `kind` (`card`/`account`) e `invoiceMonth` são opcionais |
| `POST /api/reset` | apaga a amostra, o importado ou tudo |
| `GET /api/export/pdf` | super extrato com o mesmo recorte da tela (`?month=` ou `?from=&to=`, mais `source`/`account`/`includeInternal`) |
| `POST /api/export/proof` | folha de prova a partir da spec exibida, sem replanejar |
| `POST /api/spec-check` | valida uma spec crua (modo "ver filtro") |

## Interface web

A demo abre pronta no último mês completo e já mostra a resposta com o SQL ao lado, sem clique, sem configuração.

- **A pergunta vira lançamento.** O total entra na linha `4.0` com o carimbo do período; as categorias aparecem como linhas de extrato, com código fixo (`4.6` = Moradia), valor e acumulado.
- **A prova é uma camada.** A folha translúcida sobre a página traz o SQL executado, os parâmetros, o planner, o tempo, `0 tokens somados` e o `QuerySpec` completo.
- **Troca de mês pela lombada.** As abas de mês mudam o extrato inteiro: resumo, consulta padrão e lista de lançamentos.
- **Período livre.** Os campos `de`/`até` recortam resumo, lista e consulta para qualquer intervalo; `mês todo` volta para as abas. As rotas aceitam `?month=` ou `?from=&to=`.
- **Importa o seu arquivo.** CSV, OFX ou PDF (Nubank, Caixa, BB, PicPay e Santander, com OCR quando o PDF é imagem), até 12 MB (8 MB no PDF), com recibo de linhas lidas, novas e já existentes. A conta sai do próprio arquivo (OFX `BANKID`/`ACCTID` ou cabeçalho do CSV) e pode ser corrigida no campo `conta do arquivo`; fatura de cartão tem campo `fatura`, e o parcelamento entra no recibo. Arquivo que não é extrato é recusado sem apagar o que já estava carregado. Os lançamentos ficam no SQLite local; nada sai da máquina.
- **Junta tudo num super extrato.** O botão `exportar PDF` gera um PDF com capa, resumo geral, resumo por conta, os lançamentos ordenados por data com subtotal por mês e o total geral, respeitando o período livre e a fonte escolhidos na tela.
- **Prova em papel.** A folha de prova tem um botão que baixa um PDF com a pergunta, a resposta, o número apurado, o SQL, os parâmetros e o `QuerySpec`, o mesmo recorte que estava na tela, sem replanejar.
- **Continua a conversa.** Depois de uma resposta, o chip `e no mês anterior?` refaz a consulta no mês anterior ao da pergunta (não ao do relógio), herdando intenção e filtros.
- **Explica e corrige.** Cada lançamento tem `?` (por que essa categoria?), `↔` (marcar como transferência interna) e `↩` (marcar como estorno); a marcação manual sobrevive a uma nova detecção automática.
- **Responsivo de verdade.** Em 390px a prova sobe como bottom sheet com scrim, o campo de consulta gruda na base e as colunas secundárias somem.

Stack: Vite + React no cliente, Node + SQLite no servidor. O cliente só formata o que a API devolve; nenhuma soma acontece no navegador.

## Rodando

Requisitos: Node 22.13+ (usa `node:sqlite` e _type stripping_, então não há etapa de build).

```bash
npm install

npm run dev                             # API (8787) + interface (5173), com a amostra pronta
npm run import                          # importa data/sample-extrato.csv
npm run ask -- "quanto gastei em outubro"
npm run demo                            # 5 perguntas de demonstração
npm run eval                            # mede planner e resposta (heurístico)
npm run eval -- --llm                   # mede o planner configurado (usa a rede)
npm test                                # 79 testes (44 de unidade + 35 de API)
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

## Deploy

O app é um processo Node com um arquivo SQLite: o mesmo container serve interface e API. O `Dockerfile` deixa `/data` como volume, é lá que ficam `extrato.db` e o cache do OCR.

```bash
docker build -t extrato-falado .
docker run -d --name extrato -p 8787:8787 \
  -e HOST=0.0.0.0 \
  -e APP_PASSWORD=escolha-uma-senha \
  -v extrato-data:/data \
  extrato-falado
```

| Variável | Por quê |
|---|---|
| `HOST=0.0.0.0` | dentro do container, o proxy não alcança `127.0.0.1` |
| `PUBLIC_HOSTS=app.exemplo.com` | allowlist do Host/Origin público; sem ela a API recusa o domínio do deploy (a proteção contra DNS rebinding continua valendo) |
| `OWNER_KEY` | liga o **modo dono**: o site fica somente leitura para visitantes; abrir `https://.../?chave=<OWNER_KEY>` uma vez troca a chave por um cookie e libera importar/editar. Sem ela, todo mundo escreve (uso local) |
| `APP_PASSWORD` | alternativa de HTTP Basic para uma instância 100% privada (usuário `extrato`). `/api/health` fica aberto, mas sem detalhes |
| `EXTRATO_DB` | caminho do banco (no container, `/data/extrato.db`). Monte o volume nesse diretório ou o banco recomeça da amostra a cada deploy |

No **Render**, o `render.yaml` é um Blueprint: serviço Docker, health check em `/api/health` e `OWNER_KEY` pedida no painel (`sync: false`). No plano **free** não há disco: a importação funciona durante a sessão e volta para a amostra quando a instância dorme (15 min parada) ou é redeployada. Para persistir de verdade, troque `plan: free` por `starter` e descomente o bloco `disk` (1 GB em `/data`). Uma instância só: SQLite não escala horizontalmente, e para um extrato pessoal não precisa.

O Docker baixa o traineddata do OCR no build (`4.0.0_fast`), então o primeiro PDF-imagem não gasta tempo baixando modelo em runtime.

### Vercel (demo)

A Vercel serve a UI estática (`web/dist`) e a API como uma função Node (`api/index.mjs`, bundle gerado por `npm run build:api`). O bundle é versionado porque a Vercel valida o bloco `functions` do `vercel.json` **antes** de rodar o `buildCommand`; o build regenera o arquivo a partir de `src/`. Função serverless não tem disco persistente, então o banco vai para `/tmp`: a demo sempre abre semeada com a amostra, mas **o que você importar vive só naquela instância** e some quando ela recicla. A própria tela avisa (`/api/health` devolve `ephemeral: true`).

Por isso a Vercel serve como **vitrine somente leitura**: defina `OWNER_KEY` nas envs do projeto (e não compartilhe) para que ninguém importe ali; a importação de verdade fica no Render ou local. Sem `OWNER_KEY`, qualquer visitante escreve numa instância efêmera.

```bash
npx vercel        # preview
npx vercel --prod # produção
```

- `vercel.json` define build, `outputDirectory` e o rewrite de `/api/*` para a função.
- Ao mexer no servidor, rode `npm run build:api` e commite o bundle junto (ele só é gerado de novo no deploy).
- A função leva o canvas nativo (`@napi-rs/canvas`, carregado em `src/ingest/pdf.ts`) e o worker do pdf.js via `includeFiles`: sem eles o import de PDF morre com `DOMMatrix is not defined` ou `fake worker`.
- `data/sample-extrato.csv` entra no pacote sozinho (é lido por um caminho fixo, que o rastreamento enxerga); o `data/extrato.db` local nunca sobe (`.vercelignore`).
- A Vercel corta corpos em ~4,5 MB: PDFs acima de ~3 MB são recusados, e a UI lê esse teto do `/api/health`.
- `PUBLIC_HOSTS` é preenchido sozinho com `VERCEL_URL`; `APP_PASSWORD` continua opcional.
- Precisa de persistência real? Use o container (Docker/Render) ou troque o SQLite por um banco remoto.

O `render.yaml` é o caminho recomendado para a demo pública: uma instância só, modo dono por chave e, no plano pago, disco persistente.

## Modo dono

Com `OWNER_KEY` definida, todo `POST`/`PATCH`/`DELETE` que grava (importar, reclassificar, orçamento, reset) responde `403` para quem não tem o cookie. Para assumir o controle:

```
https://extrato-falado.onrender.com/?chave=SUA_CHAVE
```

A chave sai da URL, vira cookie `HttpOnly` de 30 dias e a página recarrega. Vale onde o próprio app serve a UI (Render, `npm start`); na Vercel, que publica o `web/dist` como site estático, `/?chave=` não chega à função, lá o modo é só leitura por desenho. `/api/health` informa `ownerMode` e `readOnly`; a UI esconde importação e edição quando `readOnly` é `true`.

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

- **Planner**, o filtro gerado é o mesmo do gabarito? (o modelo entendeu a pergunta?)
- **Resposta**, o resultado executado é idêntico? (o número bateu?)

```
Planner heurístico (offline) · 12 casos
Planner:     12/12 (100%)
Resposta:    12/12 (100%)
```

O planner heurístico serve de **baseline**: uma LLM só se justifica se bater isso.

Para medir o planner LLM: copie `.env.example` para `.env`, defina `PLANNER=openai` e uma chave em `OPENAI_API_KEY`, depois `npm run eval -- --llm`. Sem chave (ou com `PLANNER=fake`) o comando mede o heurístico, que é o baseline determinístico e sem rede.

## Decisões de projeto

1. **Dinheiro em centavos (`INTEGER`).** `0.1 + 0.2 !== 0.3`; banco não pode ter esse problema.
2. **Nenhum valor entra na string do SQL.** Pergunta, categoria e nome de estabelecimento vão sempre como parâmetro do prepared statement, tem teste para isso.
3. **Template em vez de geração livre na resposta.** O texto é previsível, testável e não pode inventar um número que o SQL não devolveu.
4. **Dedupe pelo `fitid` do banco quando existe; senão por um id estável do lançamento.** Duas compras iguais no mesmo dia continuam sendo duas; reimportar o mesmo arquivo não duplica nada.
5. **Guard de contraparte.** Se a pergunta cita um nome que existe no extrato e o planner esquece o filtro, o servidor injeta `filters.text`, melhor recusar o total genérico do que devolver um número errado com cara de certo.
6. **Continuação sem modelo.** "E no mês anterior?" é resolvido por heurística determinística sobre a spec anterior; o modelo não vê o histórico, então não pode inventar um recorte novo.

## Limitações (de propósito, documentadas)

- O planner heurístico **ignora termo desconhecido**: "gastei em outubro com foguete" responde o total de outubro. O planner LLM devolve `fora do escopo`. É o custo de rodar offline.
- Categorização não é perfeita; o breakdown por categoria é aproximado. Pela interface dá para corrigir a categoria de um lançamento e aplicar ao estabelecimento.
- Import é manual (CSV/OFX/PDF). Sem Open Finance.
- Transferências internas são detectadas por heurística (mesmo valor, sinais opostos, contas diferentes e estabelecimentos relacionados); casos ambíguos ainda podem escapar.
- "Média" usa valor absoluto.
- Fatura de cartão é detectada pelo texto do arquivo (ou pelo campo `fatura`/`invoiceMonth`); sem isso, o arquivo cai como extrato de conta e o mês da fatura não é preenchido. O vencimento sem ano cai no ano do extrato.

## Próximos passos

- [ ] OFX reais de Itaú / Inter + Open Finance (Nubank já suportado em PDF)

---

Dados de exemplo: `data/sample-extrato.csv` (fictício, 61 lançamentos de ago–nov/2026).

Licença: [MIT](LICENSE).
