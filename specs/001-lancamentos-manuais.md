# Spec 001 - Lançamentos manuais (isolados)

Status: em implementação. Critérios de aceite a validar por testes unitários e de API.

## Contexto
O Extrato Falado trabalha com extratos importados. Gastos em dinheiro vivo e receitas avulsas ficam invisíveis. O usuário quer um módulo próprio de acompanhamento manual, com orçamento, recorrentes e comparativo, sem poluir a lista de transações do extrato.

## Objetivo
Módulo independente de lançamentos manuais (despesa/receita) com API, UI e armazenamento próprios, integrável por opção ao resumo/orçamento, mas isolado por padrão.

## Princípio de isolamento
- Armazenamento separado: tabela `manual_entries` (e `recurring_templates`), nunca misturada em `transactions`.
- API separada: namespace `/api/manual/*` e `/api/recurring/*`.
- UI separada: seção "Lançamentos manuais" distinta da caderneta do extrato.
- Listagem isolada por padrão: `/api/manual` não inclui importados; `/api/transactions` não inclui manuais.
- Resumo geral (`/api/summary`) agrega ambos apenas com `includeManual=true` (default `false`), com breakdown por origem.
- Orçamento (`/api/budgets`) aceita `source` (`imported`/`manual`/`all`, default `all`).
- Antes de exportar o PDF do super extrato, perguntar se inclui lançamentos manuais.

## Fora de escopo
- Sincronização/Open Finance, login/multi-usuário, previsão/projeção, alertas, app nativo.
- Materialização de recorrências (virtual por padrão).

## Requisitos funcionais
- RF1: `POST /api/manual` cria lançamento: `amount` (centavos), `direction` (in/out) ou sinal, `posted_at` (ISO), `category`, `description`, `tags[]`, `account?`, `payment_method?`.
- RF2: `GET /api/manual` lista com filtros de período/categoria/tag/direção/conta + paginação (isolado).
- RF3: `PUT /api/manual/:id`, `DELETE /api/manual/:id` (204). Só edita/exclui lançamentos manuais (guard de propriedade).
- RF4: `POST/GET/PUT/DELETE /api/recurring` para templates (frequência weekly/monthly, dia, início/fim).
- RF5: Templates ativos geram lançamentos virtuais no mês consultado (sem materializar).
- RF6: `/api/summary` aceita `includeManual` (default false) e retorna breakdown por origem.
- RF7: `/api/budgets` aceita `source` (default all).
- RF8: `/api/compare` aceita `includeManual`.
- RF9: Tags livres; filtro por tag.
- RF10: PDF do super extrato pergunta (via UI) se inclui manuais antes de exportar.

## Requisitos nao funcionais
- RNF1: centavos inteiros, SQL parametrizado.
- RNF2: tabelas `manual_entries`, `recurring_templates` no mesmo SQLite (`EXTRATO_DB`), consultas isoladas.
- RNF3: nenhum valor passa pelo LLM.
- RNF4: limite de corpo ≤ 256 KB.
- RNF5: segurança da API local mantida (Host/Origin loopback, CSP, etc.).
- RNF6: UI responsiva (390px) e acessível (teclado, foco).
- RNF7: categorias compartilhadas com o extrato (consistência).

## Modelo de dados
- `manual_entries`: `id TEXT PK`, `amount_cents INTEGER`, `direction TEXT` (in/out), `posted_at TEXT`, `category TEXT`, `description TEXT`, `tags TEXT` (JSON array), `account TEXT`, `payment_method TEXT`, `recurring_template_id TEXT` (nullable FK), `created_at TEXT`, `updated_at TEXT`.
- `recurring_templates`: `id TEXT PK`, `amount_cents INTEGER`, `direction TEXT`, `category TEXT`, `description TEXT`, `frequency TEXT` (weekly/monthly), `day_of_month INTEGER`, `weekday INTEGER`, `start_date TEXT`, `end_date TEXT` (nullable), `active INTEGER`, `created_at TEXT`.
- Índices: `idx_manual_date`, `idx_manual_category`, `idx_manual_account`, `idx_recurring_active`.

## Configuracao
Nenhuma nova variável. Reusa `EXTRATO_DB`.

## Erros esperados
| Status | Quando |
|--------|--------|
| 400 | corpo inválido (valor zero, data inválida, categoria desconhecida) |
| 404 | lançamento inexistente ou não manual |
| 413 | corpo acima do limite |

## Testes esperados
- CRUD manual isolado (não aparece em `/api/transactions`).
- Resumo com/sem `includeManual`.
- Orçamento com `source`.
- Recorrência virtual por mês, sem duplicação.
- Filtro por tag.
- SQL parametrizado.
- UI: seção própria, formulário, lista, edição.

## Critérios de aceite
- [ ] Criar/listar/editar/excluir lançamento manual isolado.
- [ ] Não mistura com extrato por padrão.
- [ ] Resumo/orçamento/comparativo com flag de inclusão (default false).
- [ ] Antes de exportar PDF, pergunta se inclui manuais.
- [ ] Recorrência virtual por mês.
- [ ] Filtro por tag.
- [ ] UI seção própria, responsiva e acessível.
- [ ] Testes unitários + API passando.

## Limitações
- Sem previsão/projeção.
- Recorrência virtual (sem materialização).
- Sem multi-usuário.

## Decisões
1. Recorrência virtual (sem materializar): mais simples, sem duplicação.
2. Tags livres.
3. PDF: manual não entra por padrão; pergunta antes de exportar.
4. Categorias compartilhadas com o extrato.
5. Resumo: `includeManual` default false, com breakdown por origem quando true.
6. Armazenamento em tabela separada (isolamento físico).