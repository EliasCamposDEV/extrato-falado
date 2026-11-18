# Design — Cartão de crédito (fatura, parcelas, internacional)

> Status: **desenho, ainda não codado.** Nada foi alterado no código. Este documento é o plano para aprovação antes da implementação.
> Contexto: app pessoal "Extrato Falado" - hoje trata toda conta como conta corrente. A maior lacuna para o usuário comum é cartão de crédito (fatura que atravessa meses, parcelamento, compra internacional).

---

## 0. O que o usuário realmente quer (jobs to be done)

1. **"Quanto gastei no cartão este mês?"** — soma das parcelas que *caíram* na fatura do mês (não só compras novas).
2. **"O que já está comprometido nos próximos meses?"** — parcelas futuras de compras já feitas.
3. **"Para onde foi o dinheiro do cartão?"** — breakdown por categoria/estabelecimento da fatura.
4. **"Quanto foi parcelado vs à vista?"** — dimensão nova, hoje inexistente.
5. **"Quanto foi em moeda estrangeira e quanto de IOF?"** — transparência de internacional.
6. **Sem dupla contagem** — a fatura paga pelo débito não pode virar despesa duas vezes.

O app já responde 1 e 3 para conta corrente. O desenho abaixo estende isso para cartão **sem quebrar** o motor (QuerySpec/compile/execute/render).

---

## 1. Princípios de desenho

- **Reusar o motor, não duplicar.** Nenhuma nova intenção de query. Filtros existentes (`from/to`, `account`, `category`, `direction`, `source`) continuam valendo. Adiciona-se um filtro `installment` pequeno e um endpoint de projeção.
- **Parcela é uma linha real.** O extrato do banco já lista cada parcela como lançamento futuro. Tratá-la como transação com metadados preserva dedupe, saldo, queries e o princípio "SQL é a única fonte de números".
- **Não inventar dado.** Projeção de parcelas futuras é *derivada* (calculada), nunca gravada como transação — para não poluir contagens/somas e para o LLM não incluí-la por engano.
- **Sinais consistentes.** Compra no cartão = valor negativo (despesa). Pagamento da fatura = transferência interna (já detectada). Saldo do cartão = soma (negativo = dívida). Nenhuma mudança na matemática do resumo.
- **Escopo v1 enxuto.** Fora: juros rotativo, anuidade, cashback/pontos, limite de crédito, cartão de débito (é conta corrente), múltiplas moedas de conta.

---

## 2. Modelo de dados

### 2.1 Nova tabela `accounts` (hoje contas são implícitas)

```sql
CREATE TABLE IF NOT EXISTS accounts (
  name            TEXT PRIMARY KEY,
  kind            TEXT NOT NULL DEFAULT 'checking',  -- checking | credit_card | savings | cash
  currency_code   TEXT NOT NULL DEFAULT 'BRL',
  closing_day     INTEGER,   -- 1..31, só credit_card
  due_day         INTEGER,   -- 1..31, só credit_card
  credit_limit_cents INTEGER,
  created_at      TEXT NOT NULL DEFAULT (datetime('now'))
);
```

**Migração:** criar a tabela; inserir uma linha por conta distinta já existente em `transactions` com `kind='checking'`. O usuário reclassifica depois (UI). Contas novas criadas no import recebem `kind='checking'` por padrão (heurística de nome pode sugerir, mas não decide).

**Por que tabela e não coluna em `transactions`:** fechamento/vencimento/limite são propriedades da conta, não do lançamento. Sem isso não dá para calcular "fatura atual" nem "comprometido".

### 2.2 Novas colunas em `transactions` (todas nullable, retrocompatíveis)

| Coluna | Tipo | Uso |
|---|---|---|
| `installment_index` | INTEGER | 1..N da parcela (null = à vista/sem parcela) |
| `installment_total` | INTEGER | N total (null se não parcelado) |
| `installment_group` | TEXT | id do grupo (hash) que liga as parcelas da mesma compra |
| `purchase_date` | TEXT (ISO) | data original da compra (quando a fatura a informa) |
| `currency_code` | TEXT | moeda original (default 'BRL') |
| `original_minor` | INTEGER | valor em centavos (ou minor units) da moeda original |
| `fx_rate` | TEXT | taxa de conversão (decimal, texto para evitar float) |
| `fx_date` | TEXT (ISO) | data da conversão |
| `iof_cents` | INTEGER | IOF cobrado (quando desmembrado; senão 0/null) |

**Migração:** `ALTER TABLE ... ADD COLUMN` em try/catch (padrão já usado). Índices novos: `idx_tx_installment_group (account, installment_group)`, `idx_tx_purchase_date`.

**Dedupe:** o hash atual é `(account, posted_at, amount_cents, merchant)`. Adicionar `installment_index` ao hash quando presente: `(account, posted_at, amount_cents, merchant, installment_index)`. Evita colisão de duas parcelas idênticas no mesmo dia. FITID continua mandando quando existe.

### 2.3 Sem tabela de "compras" separada

Tentador (compra → N parcelas), mas duplica fonte de verdade e quebra "SQL é a única fonte". A parcela é o lançamento; o grupo é só um id. Projeção futura é calculada, não gravada.

---

## 3. Ingestão

### 3.1 Detecção de parcela (parser de descrição)

Padrões brasileiros, em ordem de confiança:

1. **Com palavra-chave (alta confiança):** `PARC 03/10`, `PARCELA 3/10`, `3X DE 10`, `3x10`, `3 de 10`, `3ª de 10`, `3/10 PARC`.
2. **Bare `X/Y` final (baixa confiança, só se X≤Y, Y≤48, X≥1, Y≥2):** `MERCADOLIVRE*ABC 03/10`.

**Decisão de MVP: exigir palavra-chave.** Falso positivo em data (`PAGAMENTO 03/10`) destrói confiança no número; é melhor perder parcela do que classificar data como parcela. A heurística bare fica para fase 2, com flag de confiança.

Extração: regex `\b(?:parc(?:ela)?|parcela|x)\s*[:\-]?\s*(\d{1,2})\s*[\/de]+\s*(\d{1,2})\b` (case-insensitive, acentos). Armazenar `installment_index`, `installment_total`.

**Grupo:** remover o token de parcela da descrição antes de normalizar merchant; `installment_group = sha1(account | baseMerchant | amount_cents | installment_total)`. Assim todas as parcelas da mesma compra compartilham grupo mesmo com descrições levemente diferentes.

### 3.2 `normalizeMerchant` atualizado

Hoje remove datas e ids longos. Adicionar remoção do token de parcela, para que `MERCADOLIVRE*ABC 03/10` e `MERCADOLIVRE*ABC 04/10` gerem o mesmo merchant e a mesma categoria. Regra de categorização já roda sobre merchant → herança automática.

### 3.3 Internacional

- **OFX:** ler `<CURDEF>` (moeda da conta) e, por transação, `<ORIGCURRENCY>` + `<ORIGAMT>` quando presentes. Gravar `currency_code`, `original_minor`, `fx_rate` (calculado: amount/original, como texto), `fx_date = posted_at`.
- **CSV/PDF:** regex para códigos/símbolos conhecidos (`USD`, `EUR`, `GBP`, `US$`, `€`, `£`, `DOLAR`, `EURO`) e taxa (`taxa 5,23`, `cotacao 5.23`). Gravar o que for parseável.
- **Regra de ouro:** se só o valor em BRL está disponível (caso comum em extratos brasileiros), gravar `currency_code='BRL'` e campos FX null. **Nunca inventar taxa.**
- **IOF:** se desmembrado como linha separada, é um lançamento normal (categoria "Impostos"/"IOF") — sem tratamento especial. Se embutido, `amount_cents` já inclui; gravar `iof_cents` quando parseável, senão null.
- **Sanity check (análogo à conferência de saldo):** se `original_minor` e `fx_rate` existem, `original_minor * rate` deve bater com `amount_cents` dentro de 1%. Se não bater, avisar no recibo, não bloquear (câmbio tem spread).

### 3.4 Import em conta `credit_card`

- Saldo reportado = total da fatura (debt). Gravar em `account_balances` com sinal negativo (consistente com despesa). A conferência `previous + sum == reported` funciona se a fatura inclui o pagamento; se não incluir, avisar (não bloquear).
- O pagamento da fatura (débito→cartão) é detectado pelo `detectInternalTransfers` já existente (mesmo valor, contas diferentes, ≤3 dias). Considerar ampliar a janela para cartão (pagamento pode ser agendado) — configurável, default 5 dias para pares envolvendo `credit_card`.
- Recibo de import ganha: "fatura de X lançamentos, total R$ Y, fechamento Z".

### 3.5 Categorização de parcelas

Classificar sobre o merchant **base** (sem token de parcela). A regra `matchRule` já é por merchant → herança automática entre parcelas. Se o usuário recategorizar uma parcela, oferecer "aplicar às demais do mesmo grupo" (fase 2; v1 só recategoriza a linha).

---

## 4. Consulta e relatórios

### 4.1 Filtro `installment` (pequeno, limpo)

Adicionar a `Filters` (spec.ts, compile.ts, web types, api.ts):

```ts
installment?: 'any' | 'installment' | 'single';  // default 'any'
```

- `installment`: `installment_total IS NOT NULL`
- `single`: `installment_total IS NULL`
- Compila para `WHERE installment_total IS (NOT) NULL`.

Permite perguntas como "quanto foi parcelado" / "quanto foi à vista" sem mudar intenção. O prompt do LLM ganha uma linha sobre o filtro.

### 4.2 Endpoint de projeção (novo, separado do QuerySpec)

`GET /api/commitments?account=&months=6` retorna parcelas **futuras** inferidas:

```
{ month: '2026-12', rows: [{ postedAt, merchant, category, amountCents, installment: '4/10', group }] , totalCents }
```

**Lógica:** para cada grupo com parcela conhecida `k/N` e última parcela observada no mês `M`, gerar parcelas `k+1..N` nos meses `M+1..M+(N-k)`, no **mesmo dia do mês** da última parcela observada (clamp ao último dia do mês). Somar por mês.

**Por que endpoint separado e não QuerySpec:** é dado derivado, não lançamento real. Se entrar no motor, o LLM pode somá-lo por engano e o "onde foi meu dinheiro" fica sujo. Fica como botão/seção "Comprometido", claramente rotulado.

### 4.3 Relatórios existentes

- Super extrato: mostrar coluna de parcela (`3/10`) quando presente; internacional com moeda original em linha secundária.
- Folha de prova: incluir `installment` e FX no spec quando aplicável (já via Filters).

---

## 5. UI/UX

- **Seletor de conta** agrupa por `kind` (conta corrente / cartão / poupança). Badge de cartão.
- **Painel "Cartão"** (aparece quando a conta selecionada é `credit_card`): fatura atual (ciclo), fechamento, vencimento, % do limite usado, e "comprometido nos próximos 6 meses" (chama `/api/commitments`).
- **Importação em conta cartão:** recibo mostra "fatura", não "saldo"; conferência de saldo vira "fatura fecha?".
- **Lista de lançamentos:** coluna de parcela (`3/10`) e, para internacional, tooltip/linha secundária "USD 12,50 @ 5,23 + IOF R$ 0,80".
- **Não inflar a tela principal:** tudo de cartão é contextual (aparece só com conta cartão selecionada). O fluxo padrão (pergunta → resposta → SQL) não muda.
- **"Incluir transferências internas"** já exclui o pagamento da fatura; renomear label para "incluir pagamentos de fatura e transferências internas" para clareza.

---

## 6. Testes

- **Unit:** regex de parcela (casos positivos + negativos: `PAGAMENTO 03/10`, `03/10/2026`, `12/2026`), normalização de merchant com token, cálculo de grupo, projeção de comprometidos (clamp de dia, virada de ano).
- **Ingestão:** CSV com parcelas → N linhas com metadados corretos; reimportação não duplica; categoria herdada entre parcelas.
- **API:** import em conta `credit_card` com saldo reportado; `/api/commitments` retorna projeção; filtro `installment` funciona; internacional com FX grava campos.
- **Regressão:** os 42 testes atuais continuam passando; nenhuma mudança em `transactions` que quebre dedupe existente.
- **Isolamento de conta:** importar cartão não afeta resumo de conta corrente (já garantido por `account` filter, mas testar).

---

## 7. Riscos e mitigações

| Risco | Mitigação |
|---|---|
| Falso positivo de parcela (data lida como `3/10`) | Exigir palavra-chave no v1; bare só na fase 2 com confiança armazenada |
| Internacional: extrato só mostra BRL | Gravar FX só quando parseável; nunca inventar taxa; avisar no recibo |
| Fatura que não inclui pagamento → conferência falha | Avisar, não bloquear (padrão já usado para saldo) |
| Projeção virar "dado" e poluir somas | Endpoint separado, rotulado "comprometido", fora do QuerySpec |
| Escopo creep (juros, anuidade, pontos, limite) | Explicitamente fora do v1; documentar como "não agora" |
| UX pesada para usuário simples | Tudo de cartão é contextual à conta selecionada |
| Migração em DB real do usuário | Colunas nullable + tabela nova; `ALTER` em try/catch; backup antes de migrar (adicionar ao fluxo de import) |

---

## 8. Fases e esforço (1 dev)

| Fase | Conteúdo | Esforço |
|---|---|---|
| 0 | Aprovação deste desenho + decisões (seção 9) | 0.5 sem |
| 1 | Data: `accounts` + migração; colunas novas; índices; `normalizeMerchant` com token; parser de parcela; FX; dedupe atualizado | 1.5–2 sem |
| 2 | Query: filtro `installment`; endpoint `/api/commitments`; testes unit+ingestão | 1 sem |
| 3 | UX: seletor agrupado, painel cartão, recibo de fatura, coluna parcela, tooltip FX | 1 sem |
| 4 | Polish: docs, README, testes de API, regressão completa | 0.5 sem |
| **Total** | | **~4–5 semanas** (realista com interrupções: 5–6) |

---

## 9. Decisões a confirmar (as que mudam o desenho)

1. **Projeção como linhas reais vs derivada?** Recomendo **derivada** (endpoint separado) para não poluir somas/LLM. Alternativa (linhas `source='scheduled'`) torna "quanto vou gastar mês que vem" uma query normal, mas arrisca o LLM somar comprometido como gasto real.
2. **Tipo de conta: auto-detect ou manual?** Recomendo **manual** com sugestão por nome ("cartao", "card", "credito" → sugere `credit_card`), nunca decisão automática.
3. **Internacional: guardar moeda original ou só BRL?** Recomendo **guardar quando parseável**, senão BRL-only. Nunca inventar taxa.
4. **IOF: linha separada ou embutido?** Recomendo **embutido no `amount_cents`** (é o que o usuário pagou) + `iof_cents` quando desmembrável.
5. **Pagamento de fatura: automático ou manual?** Recomendo **automático** via `detectInternalTransfers` (já existe), com aviso no recibo de import.
6. **Escopo de "cartão":** só crédito (fatura). Débito é conta corrente — fora.

Defaults recomendados estão marcados como "Recomendo". Se concordar com todos, começo pela Fase 1 (data + ingestão), que é a parte que mexe em schema e por isso precisa ser feita com cuidado e testes antes de qualquer UI.

---

## 10. O que NÃO muda

- `QuerySpec`/`compile`/`execute`/`render`: intenções e matemática intactas.
- Dedupe, conferência de saldo, folha de prova, super extrato: estendidos, não reescritos.
- Princípio "LLM planeja, SQL soma": preservado (projeção fica fora do motor).
- App pessoal continua sendo o produto; nada de tenancy/auth aqui.