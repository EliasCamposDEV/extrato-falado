import type { QuerySpec } from './spec.ts';

export interface CompiledQuery {
  sql: string;
  params: (string | number)[];
}

/**
 * Spec -> SQL parametrizado. Nenhum valor vindo da pergunta entra na string:
 * tudo vai como parametro do prepared statement.
 */
export function compileSpec(spec: QuerySpec): CompiledQuery {
  const where = buildWhere(spec);
  const limit = spec.limit ?? 10;

  switch (spec.intent) {
    case 'sum':
      return {
        sql: `SELECT COALESCE(SUM(amount_cents), 0) AS total_cents, COUNT(*) AS n
              FROM transactions ${where.sql}`,
        params: where.params,
      };

    case 'count':
      return {
        sql: `SELECT COUNT(*) AS n FROM transactions ${where.sql}`,
        params: where.params,
      };

    case 'average':
      return {
        sql: `SELECT COALESCE(ROUND(AVG(ABS(amount_cents))), 0) AS avg_cents, COUNT(*) AS n
              FROM transactions ${where.sql}`,
        params: where.params,
      };

    case 'breakdown': {
      const groupBy = spec.groupBy ?? 'category';
      const label = {
        category: 'category',
        merchant: 'merchant',
        month: "substr(posted_at, 1, 7)",
        day: 'posted_at',
      }[groupBy];
      const order = spec.orderBy === 'label' ? 'label ASC' : 'total_cents DESC';
      return {
        // SUM(...) OVER () le o conjunto agrupado inteiro, antes do LIMIT:
        // o total da resposta e o total de verdade, nao a soma das N linhas exibidas.
        sql: `SELECT ${label} AS label, ABS(SUM(amount_cents)) AS total_cents, COUNT(*) AS n,
                     SUM(ABS(SUM(amount_cents))) OVER () AS grand_total
              FROM transactions ${where.sql}
              GROUP BY label ORDER BY ${order} LIMIT ?`,
        params: [...where.params, limit],
      };
    }

    case 'list':
      return {
        sql: `SELECT posted_at, description, merchant, category, amount_cents
              FROM transactions ${where.sql}
              ORDER BY posted_at DESC, ABS(amount_cents) DESC LIMIT ?`,
        params: [...where.params, limit],
      };
  }
}

function buildWhere(spec: QuerySpec): { sql: string; params: (string | number)[] } {
  const f = spec.filters;
  const clauses: string[] = [];
  const params: (string | number)[] = [];

  if (f.from) {
    clauses.push('posted_at >= ?');
    params.push(f.from);
  }
  if (f.to) {
    clauses.push('posted_at <= ?');
    params.push(f.to);
  }
  if (f.categories?.length) {
    clauses.push(`category IN (${f.categories.map(() => '?').join(', ')})`);
    params.push(...f.categories);
  }
  if (f.merchants?.length) {
    clauses.push(`(${f.merchants.map(() => 'LOWER(merchant) LIKE ?').join(' OR ')})`);
    params.push(...f.merchants.map((merchant) => `%${merchant.toLowerCase()}%`));
  }
  if (f.text) {
    clauses.push('LOWER(description) LIKE ?');
    params.push(`%${f.text.toLowerCase()}%`);
  }
  if (f.direction === 'out') clauses.push('amount_cents < 0');
  if (f.direction === 'in') clauses.push('amount_cents > 0');
  if (f.source) {
    clauses.push('source = ?');
    params.push(f.source);
  }
  if (f.account) {
    clauses.push('account = ?');
    params.push(f.account);
  }
  if (!f.includeInternal) {
    clauses.push('is_internal_transfer = 0');
  }
  if (typeof f.minCents === 'number') {
    clauses.push('ABS(amount_cents) >= ?');
    params.push(f.minCents);
  }
  if (typeof f.maxCents === 'number') {
    clauses.push('ABS(amount_cents) <= ?');
    params.push(f.maxCents);
  }

  return { sql: clauses.length ? `WHERE ${clauses.join(' AND ')}` : '', params };
}
