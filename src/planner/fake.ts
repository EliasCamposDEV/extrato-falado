import type { QuerySpec } from '../query/spec.ts';
import { BRANDS, CATEGORY_KEYWORDS, MONTHS } from '../domain/vocab.ts';
import { monthBounds } from '../domain/dates.ts';
import { parseAmountToCents, stripAccents } from '../ingest/normalize.ts';

export interface PlanInput {
  question: string;
  today: string;
  /** "e no mes anterior?" continua a consulta anterior e pode vir sem filtros proprios. */
  allowEmpty?: boolean;
}

export interface Planner {
  name: string;
  plan(input: PlanInput): Promise<QuerySpec>;
}

/** Pergunta fora do escopo do extrato. Nao deve virar um total generico. */
export class OutOfScopeError extends Error {}

/** Tentativa de manipular o planner. Nunca deve cair em outro planner. */
export class SecurityError extends Error {}

function extractPeriod(q: string, today: string): { from: string; to: string } | null {
  const currentYear = Number(today.slice(0, 4));
  const currentMonth = Number(today.slice(5, 7));

  if (/\b(mes passado|mes anterior)\b/.test(q)) {
    return currentMonth === 1
      ? monthBounds(currentYear - 1, 12)
      : monthBounds(currentYear, currentMonth - 1);
  }
  if (/\b(esse|este) mes\b|\bmes atual\b/.test(q)) {
    return monthBounds(currentYear, currentMonth);
  }

  const yearMatch = /\b(20\d{2})\b/.exec(q);
  // q ja vem sem acento: o nome exibido ("março") precisa da mesma normalizacao
  const monthIndex = MONTHS.findIndex((month) => new RegExp(`\\b${stripAccents(month)}\\b`).test(q));

  if (monthIndex >= 0) {
    let year = yearMatch ? Number(yearMatch[1]) : currentYear;
    if (!yearMatch && monthIndex + 1 > currentMonth) year -= 1;
    return monthBounds(year, monthIndex + 1);
  }
  if (yearMatch) {
    return { from: `${yearMatch[1]}-01-01`, to: `${yearMatch[1]}-12-31` };
  }
  return null;
}

const COUNTERPARTY_STOP =
  /\b(?:em|no|na|nos|nas|durante|entre|esse|este|deste|desse|mes|mesmo|periodo|passado|ultimo|ultimos|ano|hoje|r\$)\b/;

/**
 * "quanto enviei para janisleyde silva campos no periodo" -> "janisleyde silva campos".
 * Sem isso, o nome da pessoa era descartado e a pergunta virava o total de tudo.
 */
function extractCounterparty(q: string): string | null {
  const match = /\b(?:enviei|envio|transferi|mandei|paguei|recebi)\b[^?.!]{0,40}?\b(?:para|pra|pro|de|do|da)\s+(.+)$/.exec(q);
  if (!match?.[1]) return null;
  const name = match[1]
    .split(COUNTERPARTY_STOP)[0]!
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const words = name.split(' ').filter((word) => word.length > 1).slice(0, 4);
  const text = words.join(' ');
  return text.length >= 4 ? text : null;
}

/**
 * Planeja pelo vocabulario do dia a dia, sem LLM.
 * Cobre o vocabulario do dia a dia e serve de baseline do eval —
 * qualquer LLM tem que bater pelo menos isso.
 */
export function planHeuristic({ question, today }: PlanInput): QuerySpec {
  const q = stripAccents(question).toLowerCase();

  const period = extractPeriod(q, today);

  const brands = BRANDS.filter((brand) => q.includes(brand));

  const categories = new Set<string>();
  if (brands.length === 0) {
    for (const [category, keywords] of Object.entries(CATEGORY_KEYWORDS)) {
      if (keywords.some((keyword) => q.includes(keyword))) categories.add(category);
    }
  }

  const filters: QuerySpec['filters'] = {};
  if (period) {
    filters.from = period.from;
    filters.to = period.to;
  }
  if (brands.length > 0) filters.merchants = brands;
  else if (categories.size > 0) filters.categories = [...categories];

  const counterparty = extractCounterparty(q);
  if (counterparty) filters.text = counterparty;

  const above = /(?:mais|acima|superior)\s+de\s+(?:r\$\s*)?([\d.,]+)/.exec(q);
  if (above?.[1]) filters.minCents = parseAmountToCents(above[1]);
  const below = /(?:menos|abaixo|ate)\s+de\s+(?:r\$\s*)?([\d.,]+)/.exec(q);
  if (below?.[1]) filters.maxCents = parseAmountToCents(below[1]);

  if (/\b(recebi|recebido|receita|entrou|entrada|ganhei)\b|salario/.test(q)) filters.direction = 'in';
  else if (
    /\b(gastei|gasto|gastos|paguei|pago|despesa|despesas|custou|saiu|saida|pedi|comprei|enviei|envio|transferi|mandei|saquei)\b|para onde|onde foi/.test(q)
  ) {
    filters.direction = 'out';
  }

  let intent: QuerySpec['intent'] = 'sum';
  if (/\bquantas vezes\b|\bquantos lancamentos\b|\bquantas compras\b/.test(q)) intent = 'count';
  else if (/\bmedia\b/.test(q)) intent = 'average';
  else if (/\bmaiores\b|\bpara onde\b|\bonde foi\b|\bpor categoria\b|\branking\b|\btop\b/.test(q)) intent = 'breakdown';
  else if (/\bliste\b|\blista\b|\bquais foram os lancamentos\b|\bmostre (os |meus )?lancamentos\b|\bextrato\b/.test(q)) {
    intent = 'list';
  }

  const spec: QuerySpec = { intent, filters };
  if (intent === 'breakdown') {
    spec.groupBy = /\bmaiores\b|\bestabelecimentos?\b|\blojas?\b|\bcomercios?\b/.test(q) ? 'merchant' : 'category';
    spec.limit = 5;
  }
  if (intent === 'list') spec.limit = 10;

  return spec;
}

const TOTAL_HINTS = /\b(total|tudo|geral|saldo|todo o periodo|no periodo|complete|completo|mes)\b/;

export const heuristicPlanner: Planner = {
  name: 'heuristico (offline)',
  plan: async (input) => {
    const spec = planHeuristic(input);
    const q = stripAccents(input.question).toLowerCase();
    const hasFilter = Object.keys(spec.filters).length > 0;
    // Nao entendeu nada sobre o extrato: melhor recusar do que devolver
    // o total geral como se fosse a resposta da pergunta.
    if (!input.allowEmpty && !hasFilter && spec.intent !== 'breakdown' && spec.intent !== 'list' && !TOTAL_HINTS.test(q)) {
      throw new OutOfScopeError('nao entendi essa pergunta como uma consulta ao extrato');
    }
    return spec;
  },
};
