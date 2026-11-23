import type { QueryOutcome } from './execute.ts';
import type { QuerySpec } from './spec.ts';
import { MONTHS } from '../domain/vocab.ts';

export function brl(cents: number): string {
  return (cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

export function shortDate(iso: string): string {
  const [year, month, day] = iso.split('-');
  return `${day}/${month}/${year}`;
}

export function describePeriod(from?: string, to?: string): string {
  if (!from && !to) return 'no período completo';
  if (from && to) {
    if (from.slice(0, 7) === to.slice(0, 7) && from.endsWith('-01')) {
      const month = Number(from.slice(5, 7));
      return `em ${MONTHS[month - 1] ?? ''} de ${from.slice(0, 4)}`;
    }
    return `entre ${shortDate(from)} e ${shortDate(to)}`;
  }
  return from ? `a partir de ${shortDate(from)}` : `até ${shortDate(to!)}`;
}

function titleCase(value: string): string {
  return value.replace(/\b\p{L}/gu, (char) => char.toUpperCase());
}

function describeFilters(spec: QuerySpec): string {
  const f = spec.filters;
  const parts: string[] = [];

  if (f.categories?.length) parts.push(`em ${f.categories.join(' e ')}`);
  if (f.merchants?.length) parts.push(`em ${f.merchants.map(titleCase).join(', ')}`);
  if (f.text) parts.push(`com "${titleCase(f.text)}"`);
  if (typeof f.minCents === 'number') parts.push(`acima de ${brl(f.minCents)}`);
  if (typeof f.maxCents === 'number') parts.push(`abaixo de ${brl(f.maxCents)}`);

  parts.push(describePeriod(f.from, f.to));
  return parts.join(' ');
}

const NO_DATA = (scope: string) => `Não encontrei nenhum lançamento ${scope}.`;

/**
 * Numeros chegam prontos do SQLite; aqui so ha formatacao.
 * Template, nao geracao livre: e o que garante que a resposta nunca invente um valor.
 */
export function renderAnswer(spec: QuerySpec, outcome: QueryOutcome): string {
  const scope = describeFilters(spec);

  switch (outcome.kind) {
    case 'sum': {
      if (outcome.count === 0) return NO_DATA(scope);
      // direction ausente significa "any" no SQL: nao pode virar "Você gastou"
      const direction = spec.filters.direction ?? 'any';
      const value = brl(Math.abs(outcome.totalCents));
      const verb = direction === 'in' ? 'Você recebeu' : 'Você gastou';
      const sentence = direction === 'any'
        ? `O total do período foi ${brl(outcome.totalCents)} ${scope}`
        : `${verb} ${value} ${scope}`;
      return `${sentence} (${outcome.count} lançamentos).`;
    }

    case 'count':
      return outcome.count === 0
        ? NO_DATA(scope)
        : `Foram ${outcome.count} lançamentos ${scope}.`;

    case 'average':
      return outcome.count === 0
        ? NO_DATA(scope)
        : `A média por lançamento foi ${brl(outcome.averageCents)} ${scope} (${outcome.count} lançamentos).`;

    case 'breakdown': {
      if (outcome.rows.length === 0) return NO_DATA(scope);
      const header = spec.groupBy === 'merchant'
        ? `Onde você mais gastou ${scope}:`
        : `Para onde foi o dinheiro ${scope}:`;
      const lines = outcome.rows.map((row, index) => {
        const share = outcome.totalCents === 0 ? 0 : Math.round((row.totalCents / outcome.totalCents) * 100);
        const label = row.label.length > 26 ? `${row.label.slice(0, 25)}…` : row.label;
        return `  ${String(index + 1).padStart(2)}. ${label.padEnd(26)} ${brl(row.totalCents).padStart(14)}  ${String(share).padStart(3)}%`;
      });
      return [header, ...lines].join('\n');
    }

    case 'list': {
      if (outcome.rows.length === 0) return NO_DATA(scope);
      const lines = outcome.rows.map((row) =>
        `  ${shortDate(row.postedAt)}  ${row.merchant.slice(0, 24).padEnd(26)} ${brl(row.amountCents).padStart(12)}`,
      );
      return [`Lançamentos ${scope}:`, ...lines].join('\n');
    }
  }
}
