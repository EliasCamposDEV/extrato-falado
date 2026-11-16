import type { Db } from '../db.ts';
import { compileSpec } from './compile.ts';
import type { QuerySpec } from './spec.ts';

export interface BreakdownRow {
  label: string;
  totalCents: number;
  count: number;
  /** Soma corrente das linhas exibidas; a ultima e o total do topo, nao o total geral. */
  accumCents: number;
}

export interface ListRow {
  postedAt: string;
  description: string;
  merchant: string;
  category: string;
  amountCents: number;
}

export type QueryOutcome =
  | { kind: 'sum'; totalCents: number; count: number }
  | { kind: 'count'; count: number }
  | { kind: 'average'; averageCents: number; count: number }
  | { kind: 'breakdown'; rows: BreakdownRow[]; totalCents: number }
  | { kind: 'list'; rows: ListRow[] };

export function executeSpec(db: Db, spec: QuerySpec): QueryOutcome {
  const { sql, params } = compileSpec(spec);
  const statement = db.prepare(sql);

  switch (spec.intent) {
    case 'sum': {
      const row = statement.get(...params) as { total_cents: number; n: number };
      return { kind: 'sum', totalCents: Number(row.total_cents), count: Number(row.n) };
    }
    case 'count': {
      const row = statement.get(...params) as { n: number };
      return { kind: 'count', count: Number(row.n) };
    }
    case 'average': {
      const row = statement.get(...params) as { avg_cents: number; n: number };
      return { kind: 'average', averageCents: Number(row.avg_cents), count: Number(row.n) };
    }
    case 'breakdown': {
      const rows = statement.all(...params) as {
        label: string;
        total_cents: number;
        n: number;
        grand_total: number;
      }[];
      let running = 0;
      const mapped = rows.map((row) => {
        const totalCents = Number(row.total_cents);
        running += totalCents;
        return {
          label: String(row.label),
          totalCents,
          count: Number(row.n),
          accumCents: running,
        };
      });
      // Total do conjunto filtrado, nao so das linhas que couberam no limite.
      const totalCents = rows.length > 0 ? Number(rows[0]!.grand_total) : 0;
      return { kind: 'breakdown', rows: mapped, totalCents };
    }
    case 'list': {
      const rows = statement.all(...params) as {
        posted_at: string;
        description: string;
        merchant: string;
        category: string;
        amount_cents: number;
      }[];
      return {
        kind: 'list',
        rows: rows.map((row) => ({
          postedAt: String(row.posted_at),
          description: String(row.description),
          merchant: String(row.merchant),
          category: String(row.category),
          amountCents: Number(row.amount_cents),
        })),
      };
    }
  }
}
