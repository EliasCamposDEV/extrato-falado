import type { Filters, QuerySpec } from '../types.ts';
// os nomes de mês vêm do domínio (mesma lista usada pelo servidor), como em codes.ts
import { MONTHS, MONTHS_SHORT } from '../../../src/domain/vocab.ts';

/** Zero à esquerda para número de prova e datas: "01", "31". */
export const pad2 = (value: number) => String(value).padStart(2, '0');

export function money(cents: number): string {
  const value = (Math.abs(cents) / 100).toLocaleString('pt-BR', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return `R$ ${value}`;
}

export function moneyParts(cents: number): { whole: string; fraction: string } {
  const [whole = '0', fraction = '00'] = money(cents).replace('R$ ', '').split(',');
  return { whole: `R$ ${whole}`, fraction: `,${fraction}` };
}

export function moneySigned(cents: number): string {
  return cents < 0 ? `− ${money(cents)}` : money(cents);
}

export function countLabel(value: number, singular: string, plural: string): string {
  return `${value} ${value === 1 ? singular : plural}`;
}

export function monthOf(isoMonth: string): number {
  return Number(isoMonth.slice(5, 7));
}

export function monthName(isoMonth: string): string {
  return MONTHS[monthOf(isoMonth) - 1] ?? isoMonth;
}

export function monthShort(isoMonth: string): string {
  return MONTHS_SHORT[monthOf(isoMonth) - 1] ?? isoMonth;
}

export function monthLong(isoMonth: string): string {
  return `${monthName(isoMonth)} de ${isoMonth.slice(0, 4)}`;
}

export function monthNumber(isoMonth: string): string {
  return isoMonth.slice(5, 7);
}

export function shortDate(iso: string): string {
  const [, month = '01', day = '01'] = iso.split('-');
  return `${day} ${MONTHS_SHORT[Number(month) - 1] ?? ''}`.trim();
}

export function fullDate(iso: string): string {
  const [year = '', month = '', day = ''] = iso.split('-');
  return `${day}/${month}/${year}`;
}

/** A data do lançamento no formato do extrato (aaaa-mm-dd), para linhas. */
export function dayMonth(iso: string): string {
  const [, month = '', day = ''] = iso.split('-');
  return `${day}/${month}`;
}

export interface PeriodInfo {
  /** Texto curto e carimbável, ex. "OUT 2026". */
  stamp: string;
  /** "CONFERIDO", "SEM PERÍODO". */
  stampNote: string;
  /** "01/10 a 31/10/2026". */
  full: string;
  /** "01–31 OUT". */
  short: string;
}

export function periodInfo(filters: Filters): PeriodInfo {
  const { from, to } = filters;

  if (from && to) {
    const sameMonth = from.slice(0, 7) === to.slice(0, 7);
    const sameYear = from.slice(0, 4) === to.slice(0, 4);

    if (sameMonth) {
      return {
        stamp: `${monthShort(from)} ${from.slice(0, 4)}`,
        stampNote: 'CONFERIDO',
        full: `${fullDate(from)} a ${fullDate(to)}`,
        short: `${from.slice(8, 10)}–${to.slice(8, 10)} ${monthShort(from)}`,
      };
    }

    return {
      stamp: sameYear
        ? `${monthShort(from)}–${monthShort(to)} ${from.slice(0, 4)}`
        : `${from.slice(0, 4)}–${to.slice(0, 4)}`,
      stampNote: 'CONFERIDO',
      full: `${fullDate(from)} a ${fullDate(to)}`,
      short: `${shortDate(from)} – ${shortDate(to)} ${to.slice(0, 4)}`,
    };
  }

  if (from) {
    return {
      stamp: `${monthShort(from)} ${from.slice(0, 4)}`,
      stampNote: 'DESDE',
      full: `a partir de ${fullDate(from)}`,
      short: `desde ${shortDate(from)}`,
    };
  }

  if (to) {
    return {
      stamp: `${monthShort(to)} ${to.slice(0, 4)}`,
      stampNote: 'ATÉ',
      full: `até ${fullDate(to)}`,
      short: `até ${shortDate(to)}`,
    };
  }

  return { stamp: 'TUDO', stampNote: 'SEM PERÍODO', full: 'todo o período carregado', short: 'todo o período' };
}

export function directionLabel(spec: QuerySpec): string {
  const direction = spec.filters.direction;
  if (direction === 'in') return 'entradas';
  if (direction === 'out') return 'saídas';
  return 'movimentação';
}

export function groupLabel(spec: QuerySpec): string {
  switch (spec.groupBy) {
    case 'merchant':
      return 'estabelecimento';
    case 'month':
      return 'mês';
    case 'day':
      return 'dia';
    default:
      return 'categoria';
  }
}

export function groupLabelPlural(spec: QuerySpec): string {
  const singular = groupLabel(spec);
  return singular === 'mês' ? 'meses' : singular === 'dia' ? 'dias' : `${singular}s`;
}

/**
 * Mês de abertura: o último mês completo. Se o mês corrente já tem lançamentos,
 * ele ainda está em curso, entao a demo abre no anterior.
 */
export function pickMonth(months: string[]): string {
  const current = new Date().toISOString().slice(0, 7);
  if (months.length === 0) return current;
  if (months[0] === current && months.length > 1) return months[1] ?? current;
  return months[0] ?? current;
}

/** Pergunta padrão de um mês, no vocabulário que o planner heurístico entende. */
export function defaultQuestion(isoMonth: string): string {
  return `Para onde foi meu dinheiro em ${monthLong(isoMonth)}?`;
}

/** Pergunta padrão de um período livre; o recorte vai explícito para a API. */
export function rangeQuestion(from: string, to: string): string {
  return `Para onde foi meu dinheiro de ${fullDate(from)} a ${fullDate(to)}?`;
}

export function suggestQuestions(isoMonth: string): string[] {
  const name = monthName(isoMonth);
  return [`quanto gastei com iFood em ${name}`, `maiores gastos de ${name}`, `quanto recebi em ${name}`];
}
