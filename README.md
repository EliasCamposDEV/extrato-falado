# Extrato Falado

Chat sobre o seu extrato bancário que nunca erra a conta.

Você pergunta em português, "quanto gastei com delivery em outubro?", e recebe o valor exato, com o SQL que gerou o número na tela.

**Demo:** https://extrato-falado.onrender.com

## O problema

Todo mundo abre o extrato, olha, fecha e continua sem saber para onde foi o salário. Os apps de banco mostram gráfico, mas não respondem a uma pergunta específica. Quando respondem, é num chat genérico que inventa números.

## A regra: o modelo traduz, o banco soma

Todo projeto de "converse com seus dados" falha no mesmo ponto: deixa o LLM somar, e o LLM soma mal. Aqui ele nunca vê um valor.

```
pergunta ──▶ QuerySpec (JSON validado) ──▶ SQL parametrizado ──▶ SQLite (centavos) ──▶ frase em pt-BR
```

- **O modelo é compilador, não calculadora.** Ele só traduz a pergunta para um filtro estruturado.
- **Só o SQLite produz números.** Nenhum valor passa pelo LLM, então errar a conta é impossível por construção.
- **Toda resposta é auditável.** O SQL aparece junto, dá para conferir em vez de confiar.

## O caminho do número

| # | Etapa | O que acontece |
|---|---|---|
| 1 | traduzir | pergunta + data de hoje viram um `QuerySpec`. Heurístico offline por padrão; LLM opcional (`PLANNER=openai`), com provedor secundário e retorno automático ao heurístico. O modelo não vê valor e não escreve SQL. |
| 2 | validar | campos, formato, faixa e coerência. O erro sai com mensagem acionável e, no LLM, volta como contexto (repair loop). Pergunta fora do extrato é recusada. |
| 3 | compilar | `QuerySpec` vira SQL com `?` em cada valor. Nenhum trecho da pergunta entra na string. |
| 4 | executar | uma agregação no SQLite; o total do recorte inteiro vem de `SUM(...) OVER ()`. Dinheiro é inteiro, em centavos. |
| 5 | responder | template em pt-BR sobre o número do banco; zero token somado. |

Fora desse caminho ficam a importação e a deduplicação, a categorização (regra → kNN TF-IDF → `Outros`), o guard de contraparte, a continuação por heurística e a exportação em PDF.

## Extratos que entram

Cada banco desenha o extrato de um jeito, então a importação escolhe o parser pela assinatura do texto, não pelo nome do arquivo.

| Banco | Como é lido |
|---|---|
| Caixa | o PDF é uma imagem: OCR (`tesseract.js`, idioma `por`) e a cadeia de saldo corrige o dígito que o OCR embolou |
| Banco do Brasil | camada de texto; o favorecido vem na linha de baixo do histórico |
| PicPay | cabeçalho de dia com saldo de fechamento; descrição quebrada em várias linhas; o saldo de cada dia fecha a cadeia inteira |
| Nubank | camada de texto; cada dia agrupa entradas e saídas; o total do dia fecha a cadeia |
| Santander | extrato consolidado e detalhado; o sinal vem depois do número (`200,00-`) e é normalizado antes da leitura |

Nenhum número do PDF passa pelo LLM: o parser entrega lançamentos em centavos e a importação recusa o arquivo se a cadeia de saldo não fechar.

### Fatura de cartão

Uma compra de cartão tem duas datas: quando você comprou e em qual fatura ela caiu. A importação guarda as duas (`posted_at` e `invoice_month`).

- O mês da fatura vem do arquivo quando o texto se identifica como fatura (`cartão de crédito final`, `fatura`, `vencimento`, `limite disponível`); o vencimento é a âncora. Se o arquivo não se anuncia, dá para informar o mês no campo `fatura` da tela (ou `invoiceMonth` na API).
- `PARCELA 3/10`, `parcela 2 de 6`, `(4/12)` e o sufixo `1/3` viram `installment_no`/`installment_total` e saem da descrição. O estabelecimento continua o mesmo para categorizar e agrupar.
- `fatura de outubro` filtra `invoice_month`, não `posted_at`. A compra de agosto que caiu na fatura de outubro entra no total de outubro uma única vez; reimportar a fatura não duplica nada.

### Arquivo que não é extrato

A importação é fechada por padrão: na dúvida, recusa em vez de gravar lixo.

- CSV ou OFX sem nenhum lançamento recebe `400` e não apaga a amostra fictícia.
- PDF sem a assinatura `%PDF-`, acima de 8 MB ou sem lançamento/saldo reconhecido é recusado.
- O parser genérico, último recurso, só aceita o documento se o texto indica que é um extrato (`extrato`, `movimentação`, `lançamentos` ou `conta corrente`) e tem pelo menos duas linhas de lançamento. Contrato ou boleto com data e valor no meio não vira transação.
- OCR só roda quando o PDF quase não tem camada de texto (o print da Caixa tem 16 caracteres), com no máximo 4 imagens e 60 segundos.

## Segurança da API local

Não tem login e escuta só em `127.0.0.1`. `POST` exige `content-type: application/json`, recusa `Origin` que não seja de loopback e `Host` que não seja `localhost`, `127.0.0.1` ou `::1` (proteção contra DNS rebinding). O corpo é limitado por rota: 12 MB no import e 256 KB nas demais. O arquivo importado não é salvo em disco: só os lançamentos normalizados entram no SQLite.

## Interface

A demo abre no último mês completo e já mostra a resposta com o SQL ao lado, sem clique e sem configuração.

- **A pergunta vira lançamento.** O total entra na linha `4.0` com o carimbo do período; as categorias viram linhas de extrato, com código fixo (`4.6` = Moradia), valor e acumulado.
- **A prova é uma camada.** A folha translúcida sobre a página traz o SQL executado, os parâmetros, o planner, o tempo, `0 tokens somados` e o `QuerySpec` completo.
- **Troca de mês pela lombada.** As abas mudam o extrato inteiro: resumo, consulta padrão e lista de lançamentos. Os campos `de`/`até` recortam qualquer intervalo; `mês todo` volta para as abas.
- **Importa o seu arquivo.** CSV, OFX ou PDF de Nubank, Caixa, BB, PicPay e Santander, com OCR quando o PDF é imagem. A conta sai do próprio arquivo e pode ser corrigida no campo `conta do arquivo`; a fatura de cartão tem um campo `fatura`, e o parcelamento entra no recibo. Arquivo que não é extrato é recusado sem apagar o que já estava carregado. Os lançamentos ficam no SQLite do servidor (`data/extrato.db` no uso local, `/data/extrato.db` no container). Na demo pública, a importação não está disponível.
- **Exporta.** O botão `exportar PDF` gera um super extrato com capa, resumo geral, resumo por conta, lançamentos por data com subtotal por mês e total geral. A folha de prova baixa a pergunta, a resposta, o número, o SQL, os parâmetros e o `QuerySpec`, sem replanejar.
- **Continua a conversa.** O chip `e no mês anterior?` refaz a consulta no mês anterior ao da pergunta, herdando intenção e filtros.
- **Explica e corrige.** Cada lançamento tem `?` (por que essa categoria?), `↔` (transferência interna) e `↩` (estorno). A marcação manual sobrevive a uma nova detecção automática.
- **Responsivo.** Em 390px, a prova sobe como bottom sheet, o campo de consulta gruda na base e as colunas secundárias somem.

O cliente só formata o que a API devolve. Nenhuma soma acontece no navegador.

## API

| Rota | Função |
|---|---|
| `GET /api/health` | estado do banco e planner; na demo pública omite contagens, contas e fontes e informa `publicDemo: true` |
| `GET /api/summary` | resumo de um mês (`?month=`) ou período (`?from=&to=`): entradas, saídas, categorias, meses e contas; aceita `invoice=AAAA-MM` |
| `GET /api/transactions` | lançamentos do mês ou período, com limite; combina `source`, `account`, `invoice` e `includeInternal` |
| `GET/POST /api/manual` | lançamentos manuais, isolados do extrato: listar e criar |
| `GET/PUT/DELETE /api/manual/:id` | obter, editar e excluir lançamento manual |
| `GET/POST /api/recurring` | templates de recorrência, que geram lançamentos virtuais por mês |
| `GET/PUT/DELETE /api/recurring/:id` | obter, editar e excluir template |
| `GET /api/invoices` | meses de fatura com total, quantidade de lançamentos e quantos são parcelas |
| `GET /api/compare` | compara o mês com o mês fechado anterior, ou um período livre com o período anterior de mesmo tamanho |
| `GET/POST/DELETE /api/budgets` | orçamento mensal por categoria com gasto e ritmo; o GET também aceita período livre, com o limite rateado pelos dias cobertos |
| `PATCH /api/transactions/:id` | corrige a categoria; `applyAll` grava o override do estabelecimento; `internalTransfer` e `refund` marcam transferência interna ou estorno |
| `GET /api/transactions/:id/explain` | por que essa categoria? Mostra a regra que casou, a similaridade ou a correção manual |
| `POST /api/ask` | pergunta → `QuerySpec`, SQL, parâmetros, número e resposta; aceita `invoice` para amarrar a fatura |
| `POST /api/import` | CSV/OFX em texto ou PDF em base64, com recibo; `account`, `kind` (`card`/`account`) e `invoiceMonth` são opcionais |
| `POST /api/reset` | `imported` (padrão) apaga só as transações importadas, `sample` restaura a amostra e `all` apaga todas as tabelas; modo inválido recebe `400` |
| `POST/DELETE /api/consent` | registra ou retira o consentimento da sessão (`privacy`, `over18`, `shareNotice`, `llm`) |
| `GET/DELETE /api/me` | dados da sessão em JSON (manuais, orçamentos, recorrências, consentimentos) ou exclusão desses dados |
| `GET /api/export/pdf` | super extrato com o mesmo recorte da tela (`?month=` ou `?from=&to=`, mais `source`/`account`/`includeInternal`) |
| `POST /api/export/proof` | folha de prova a partir da spec exibida, sem replanejar |
| `POST /api/spec-check` | valida uma spec crua (modo "ver filtro") |

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
npm test                                # 111 testes (50 de unidade + 57 de API + 4 de dashboard)
npm run typecheck
```

Para a versão de produção:

```bash
npm run build     # gera web/dist
npm start         # serve a interface e a API em http://127.0.0.1:8787
```

Roda sem chave de API por padrão. Para usar o planner LLM:

```bash
cp .env.example .env      # PLANNER=openai + OPENAI_API_KEY
npm run ask -- "quanto gastei com besteira em outubro"
```

## Deploy

O app é um processo Node com um arquivo SQLite: o mesmo container serve interface e API. O `Dockerfile` deixa `/data` como volume, e é lá que ficam `extrato.db` e o cache do OCR.

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
| `PUBLIC_HOSTS=app.exemplo.com` | hosts públicos permitidos; sem ela, a API recusa o domínio do deploy (a proteção contra DNS rebinding continua valendo) |
| `PUBLIC_DEMO=1` | liga a demo pública: o extrato fica somente leitura para todos; visitantes podem registrar lançamentos manuais e ver o dashboard depois de aceitar o aviso. Sem ela, vale o comportamento local (importação e edição abertas) |
| `APP_PASSWORD` | alternativa de HTTP Basic para uma instância 100% privada (usuário `extrato`). `/api/health` fica aberto, mas sem detalhes |
| `EXTRATO_DB` | caminho do banco (no container, `/data/extrato.db`). Monte o volume nesse diretório ou o banco recomeça da amostra a cada deploy |

No Render, o `render.yaml` é um Blueprint: serviço Docker, health check em `/api/health` e `PUBLIC_DEMO=1`. No plano gratuito não há disco, então os lançamentos manuais da sessão voltam à amostra quando a instância dorme (15 minutos parada) ou é redeployada. Para persistir, troque `plan: free` por `starter` e descomente o bloco `disk` (1 GB em `/data`). Uma instância só: SQLite não escala horizontalmente, e um extrato pessoal não precisa.

O Docker baixa o traineddata do OCR no build (`4.0.0_fast`), então o primeiro PDF-imagem não gasta tempo baixando modelo em runtime.

## Privacidade e LGPD

A demo pública é compartilhada e roda no Render (plano gratuito, Oregon/EUA). Nela não dá para importar arquivo, editar o extrato, usar orçamentos ou recorrências: há só a amostra fictícia e lançamentos manuais isolados por sessão, apagados em 30 dias. Para usar extrato real, rode localmente.

Cada navegador recebe um `extrato_sid` anônimo (`HttpOnly`, `Secure` em HTTPS, `SameSite=Lax`, 30 dias); o servidor guarda só o SHA-256. Um banner bloqueia os manuais até o consentimento. `GET /api/me` devolve os dados da sessão e `DELETE /api/me` apaga. Fora da demo não há expurgo automático.

Com `PLANNER=openai`, a pergunta e o contexto da consulta podem ser enviados ao provedor configurado em `.env.example`. Por padrão, o planner heurístico roda offline e nenhum valor passa pelo modelo.

Documentação: [aviso completo](docs/PRIVACIDADE.md) · [versão HTML](https://extrato-falado.onrender.com/privacidade.html) · [ROPA](docs/ROPA.md) · [RIPD](docs/RIPD.md) · [incidentes](docs/INCIDENTES.md) · [checklist](docs/CHECKLIST-PRIVACIDADE.md).

Dúvidas e exercício de direitos: **eliascamposdev@gmail.com**. Falha técnica sem dado pessoal: [issues](https://github.com/EliasCamposDEV/extrato-falado/issues).

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

`npm run eval` mede duas coisas separadas, porque falham por motivos diferentes:

- **Planner:** o filtro gerado é o mesmo do gabarito? O modelo entendeu a pergunta?
- **Resposta:** o resultado executado é idêntico? O número bateu?

```
Planner heurístico (offline) · 12 casos
Planner:     12/12 (100%)
Resposta:    12/12 (100%)
```

O planner heurístico serve de referência: uma LLM só se justifica se superar isso.

Para medir o planner LLM, copie `.env.example` para `.env`, defina `PLANNER=openai` e uma chave em `OPENAI_API_KEY`, depois rode `npm run eval -- --llm`. Sem chave, ou com `PLANNER=fake`, o comando mede o heurístico, que é a referência determinística e sem rede.

## Decisões de projeto

1. **Dinheiro em centavos (`INTEGER`).** `0.1 + 0.2 !== 0.3`; um banco de dados não pode ter esse problema.
2. **Nenhum valor entra na string do SQL.** Pergunta, categoria e estabelecimento vão como parâmetro do prepared statement. Tem teste para isso.
3. **Template em vez de geração livre na resposta.** O texto é previsível, testável e não inventa número que o SQL não devolveu.
4. **Deduplicação pelo `fitid` do banco quando existe; senão por um id estável do lançamento.** Duas compras iguais no mesmo dia continuam sendo duas; reimportar o mesmo arquivo não duplica nada.
5. **Guard de contraparte.** Se a pergunta cita um nome que existe no extrato e o planner esquece o filtro, o servidor injeta `filters.text`. Melhor recusar o total genérico do que devolver número errado com cara de certo.
6. **Continuação sem modelo.** "E no mês anterior?" é resolvido por heurística determinística sobre a spec anterior; o modelo não vê o histórico, então não inventa um recorte novo.

## Limitações

- O planner heurístico ignora termo desconhecido: "gastei em outubro com foguete" responde o total de outubro. O planner LLM devolve `fora do escopo`. É o custo de rodar offline.
- A categorização não é perfeita, então o detalhamento por categoria é aproximado. Pela interface dá para corrigir a categoria de um lançamento e aplicar ao estabelecimento.
- A importação é manual (CSV, OFX, PDF). Sem Open Finance.
- Transferências internas são detectadas por heurística (mesmo valor, sinais opostos, contas diferentes e estabelecimentos relacionados). Casos ambíguos ainda escapam.
- "Média" usa valor absoluto.
- Fatura de cartão é detectada pelo texto do arquivo (ou pelo campo `fatura`/`invoiceMonth`). Sem isso, o arquivo cai como extrato de conta e o mês da fatura não é preenchido. Vencimento sem ano cai no ano do extrato.

## Dados de exemplo

`data/sample-extrato.csv` é fictício, com 61 lançamentos de agosto a novembro de 2026.

Licença: [MIT](LICENSE).
