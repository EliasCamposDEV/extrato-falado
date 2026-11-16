import { stripAccents } from '../ingest/normalize.ts';
import { shiftMonth } from '../domain/dates.ts';
import type { QuerySpec } from './spec.ts';

const MERGED_FILTERS = ['from', 'to', 'categories', 'merchants', 'text', 'direction', 'minCents', 'maxCents'] as const;

/** "e em setembro?" / "então e no mercado?" — pergunta que depende da anterior. */
export function isFollowUp(question: string): boolean {
  const q = stripAccents(question).toLowerCase().trim();
  return /^(e|entao|agora)\b/.test(q);
}

/**
 * "e no mes anterior?" se refere ao periodo da consulta anterior, nao ao mes
 * corrente do relogio. Sem isso, quem pergunta em outubro e continua em
 * novembro recebe outubro de novo.
 */
function relativePeriod(question: string, previous: QuerySpec): { from: string; to: string } | null {
  const q = stripAccents(question).toLowerCase();
  const anchor = previous.filters.from ?? previous.filters.to;
  if (!anchor) return null;

  if (/\bmes (anterior|passado)\b/.test(q)) return shiftMonth(anchor, -1);
  if (/\bmes (seguinte|que vem|proximo)\b/.test(q)) return shiftMonth(anchor, 1);
  return null;
}

/**
 * Continua a consulta anterior: herda o que a nova pergunta nao redefine.
 * Deterministico de proposito — o contexto nao passa pelo modelo.
 */
export function mergeFollowUp(previous: QuerySpec, next: QuerySpec, question = ''): QuerySpec {
  const shifted = relativePeriod(question, previous);

  const filters: QuerySpec['filters'] = { ...previous.filters };
  for (const key of MERGED_FILTERS) {
    const value = next.filters[key];
    if (value === undefined) continue;
    if (shifted && (key === 'from' || key === 'to')) continue;
    (filters as Record<string, unknown>)[key] = value;
  }
  if (shifted) {
    filters.from = shifted.from;
    filters.to = shifted.to;
  }

  // "e em setembro?" planeja como sum; a intencao original (ex.: breakdown) continua
  const intent = next.intent === 'sum' ? previous.intent : next.intent;
  const spec: QuerySpec = { intent, filters };

  const groupBy = next.groupBy ?? (intent === 'breakdown' ? previous.groupBy ?? 'category' : undefined);
  if (groupBy) spec.groupBy = groupBy;

  const limit = next.limit ?? previous.limit;
  if (limit) spec.limit = limit;

  const orderBy = next.orderBy ?? previous.orderBy;
  if (orderBy) spec.orderBy = orderBy;

  return spec;
}
