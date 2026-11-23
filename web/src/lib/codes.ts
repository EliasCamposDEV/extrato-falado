import { CATEGORIES } from '../../../src/domain/vocab.ts';
import { monthLong, shortDate } from './format.ts';

/**
 * Plano de contas do extrato: cada categoria tem um código fixo (4.6 = Moradia),
 * como num caderno de lançamentos. O código nao muda quando o ranking muda.
 */
export function categoryCode(category: string): string {
  const index = (CATEGORIES as readonly string[]).indexOf(category);
  return index >= 0 ? `4.${index + 1}` : '4.0';
}

export function rowCode(
  groupBy: string | undefined,
  label: string,
  index: number,
): string {
  switch (groupBy) {
    case 'merchant':
      return `7.${index + 1}`;
    case 'month':
      return `9.${index + 1}`;
    case 'day':
      return shortDate(label);
    default:
      return categoryCode(label);
  }
}

export function rowLabel(groupBy: string | undefined, label: string): string {
  if (groupBy === 'month' && /^\d{4}-\d{2}$/.test(label)) return monthLong(label);
  return label;
}
