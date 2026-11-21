/**
 * O "AST" do projeto.
 *
 * A LLM nunca ve numeros e nunca escreve SQL: ela so produz um QuerySpec.
 * Isso torna impossivel inventar um valor, o unico componente que soma
 * e o SQLite. Todo o resto do sistema depende deste tipo.
 */

import { normalizeInvoiceMonth } from '../domain/invoice.ts';

export type Intent = 'sum' | 'count' | 'average' | 'breakdown' | 'list';
export type Direction = 'in' | 'out' | 'any';
export type GroupBy = 'category' | 'merchant' | 'month' | 'day';

export interface Filters {
  from?: string;
  to?: string;
  categories?: string[];
  merchants?: string[];
  text?: string;
  direction?: Direction;
  minCents?: number;
  maxCents?: number;
  source?: 'sample' | 'imported';
  account?: string;
  /** mes da fatura (aaaa-mm): atravessa o mes da compra */
  invoice?: string;
  includeInternal?: boolean;
}

export interface QuerySpec {
  intent: Intent;
  filters: Filters;
  groupBy?: GroupBy;
  orderBy?: 'amount' | 'label';
  limit?: number;
}

export class SpecError extends Error {}

const INTENTS: Intent[] = ['sum', 'count', 'average', 'breakdown', 'list'];
const DIRECTIONS: Direction[] = ['in', 'out', 'any'];
const GROUP_BYS: GroupBy[] = ['category', 'merchant', 'month', 'day'];
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function asString(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new SpecError(`campo "${field}" deve ser texto nao vazio`);
  }
  return value.trim();
}

function asDate(value: unknown, field: string): string {
  const date = asString(value, field);
  if (!ISO_DATE.test(date) || Number.isNaN(Date.parse(`${date}T00:00:00Z`))) {
    throw new SpecError(`campo "${field}" deve ser data ISO (aaaa-mm-dd), recebido "${date}"`);
  }
  return date;
}

function asStringArray(value: unknown, field: string): string[] {
  if (!Array.isArray(value)) throw new SpecError(`campo "${field}" deve ser lista de texto`);
  return value.map((item, i) => asString(item, `${field}[${i}]`));
}

/** Valida e normaliza. Mensagem de erro clara: e ela que alimenta o repair loop da LLM. */
export function parseSpec(input: unknown): QuerySpec {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    throw new SpecError('a resposta deve ser um objeto JSON');
  }
  const raw = input as Record<string, unknown>;

  const intent = asString(raw.intent, 'intent') as Intent;
  if (!INTENTS.includes(intent)) {
    throw new SpecError(`"intent" deve ser um de: ${INTENTS.join(', ')}`);
  }

  const rawFilters = raw.filters ?? {};
  if (typeof rawFilters !== 'object' || Array.isArray(rawFilters)) {
    throw new SpecError('"filters" deve ser um objeto');
  }
  const f = rawFilters as Record<string, unknown>;
  const filters: Filters = {};

  if (f.from !== undefined) filters.from = asDate(f.from, 'filters.from');
  if (f.to !== undefined) filters.to = asDate(f.to, 'filters.to');
  if (filters.from && filters.to && filters.from > filters.to) {
    throw new SpecError('filters.from nao pode ser posterior a filters.to');
  }
  if (f.categories !== undefined) filters.categories = asStringArray(f.categories, 'filters.categories');
  if (f.merchants !== undefined) filters.merchants = asStringArray(f.merchants, 'filters.merchants');
  if (f.text !== undefined) filters.text = asString(f.text, 'filters.text');
  if (f.source !== undefined) {
    const source = asString(f.source, 'filters.source');
    if (source !== 'sample' && source !== 'imported') {
      throw new SpecError('"filters.source" deve ser "sample" ou "imported"');
    }
    filters.source = source;
  }
  if (f.account !== undefined) filters.account = asString(f.account, 'filters.account');
  if (f.invoice !== undefined) {
    // aceita "2026-10", "10/2026" e "outubro de 2026": a mesma forma que a tela usa
    const invoice = normalizeInvoiceMonth(asString(f.invoice, 'filters.invoice'));
    if (!invoice) throw new SpecError('"filters.invoice" deve ser o mes da fatura (aaaa-mm), ex: "2026-10"');
    filters.invoice = invoice;
  }
  if (f.includeInternal !== undefined) {
    if (typeof f.includeInternal !== 'boolean') throw new SpecError('"filters.includeInternal" deve ser booleano');
    filters.includeInternal = f.includeInternal;
  }

  if (f.direction !== undefined) {
    const direction = asString(f.direction, 'filters.direction') as Direction;
    if (!DIRECTIONS.includes(direction)) {
      throw new SpecError(`"filters.direction" deve ser um de: ${DIRECTIONS.join(', ')}`);
    }
    filters.direction = direction;
  }

  for (const key of ['minCents', 'maxCents'] as const) {
    const value = f[key];
    if (value === undefined) continue;
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      throw new SpecError(`"filters.${key}" deve ser numero em centavos`);
    }
    filters[key] = Math.round(value);
  }

  const spec: QuerySpec = { intent, filters };

  if (raw.groupBy !== undefined) {
    const groupBy = asString(raw.groupBy, 'groupBy') as GroupBy;
    if (!GROUP_BYS.includes(groupBy)) {
      throw new SpecError(`"groupBy" deve ser um de: ${GROUP_BYS.join(', ')}`);
    }
    spec.groupBy = groupBy;
  }

  if (raw.orderBy !== undefined) {
    const orderBy = asString(raw.orderBy, 'orderBy');
    if (orderBy !== 'amount' && orderBy !== 'label') {
      throw new SpecError('"orderBy" deve ser "amount" ou "label"');
    }
    spec.orderBy = orderBy;
  }

  if (raw.limit !== undefined) {
    if (typeof raw.limit !== 'number' || !Number.isInteger(raw.limit) || raw.limit < 1 || raw.limit > 100) {
      throw new SpecError('"limit" deve ser inteiro entre 1 e 100');
    }
    spec.limit = raw.limit;
  }

  if (intent === 'breakdown' && !spec.groupBy) spec.groupBy = 'category';
  if (spec.groupBy && intent !== 'breakdown') {
    throw new SpecError('"groupBy" so faz sentido com intent "breakdown"');
  }
  // "limit" so faz sentido para listas; num total ele nao muda o numero.
  if (spec.limit !== undefined && intent !== 'breakdown' && intent !== 'list') delete spec.limit;

  return spec;
}

/** Forma canonica, usada pelo eval para comparar specs sem se importar com defaults. */
export function canonicalSpec(spec: QuerySpec): string {
  const f = spec.filters;
  return JSON.stringify({
    intent: spec.intent,
    filters: {
      from: f.from ?? null,
      to: f.to ?? null,
      categories: [...(f.categories ?? [])].map((s) => s.toLowerCase()).sort(),
      merchants: [...(f.merchants ?? [])].map((s) => s.toLowerCase()).sort(),
      text: f.text ?? null,
      direction: f.direction ?? 'any',
      minCents: f.minCents ?? null,
      maxCents: f.maxCents ?? null,
       source: f.source ?? null,
       account: f.account ?? null,
       invoice: f.invoice ?? null,
       includeInternal: f.includeInternal ?? false,
    },
    groupBy: spec.groupBy ?? null,
    orderBy: spec.orderBy ?? null,
    limit: spec.limit ?? null,
  });
}
