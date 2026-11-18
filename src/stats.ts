import {
  countBySource,
  countTransactions,
  distinctAccounts,
  listBudgets,
  type Db,
} from './db.ts';
import { monthFromIso, shiftMonth } from './domain/dates.ts';

/** Recorte de datas: o mês das abas ou um período livre (de/até). */
export interface Period {
  from: string;
  to: string;
}

/** Filtros de escopo que atravessam todas as consultas de resumo. */
interface Scope {
  source?: string;
  account?: string;
  invoice?: string;
  includeInternal?: boolean;
}

/** Monta o WHERE comum a todas as consultas de resumo. */
function scopeWhere(period: Period, scope: Scope, extra: string[] = []): { where: string; params: (string | number)[] } {
  const clauses: string[] = ['posted_at >= ?', 'posted_at <= ?'];
  const params: (string | number)[] = [period.from, period.to];
  if (scope.source && scope.source !== 'all') { clauses.push('source = ?'); params.push(scope.source); }
  if (scope.account) { clauses.push('account = ?'); params.push(scope.account); }
  if (scope.invoice) { clauses.push('invoice_month = ?'); params.push(scope.invoice); }
  if (!scope.includeInternal) clauses.push('is_internal_transfer = 0');
  for (const e of extra) clauses.push(e);
  return { where: clauses.join(' AND '), params };
}

/** Dias corridos entre duas datas ISO, contando as duas pontas. */
function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86400000) + 1;
}

function addDays(iso: string, delta: number): string {
  const date = new Date(`${iso}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + delta);
  return date.toISOString().slice(0, 10);
}

/** Meses (aaaa-mm) tocados por um período. */
function monthsInRange(from: string, to: string): string[] {
  const months: string[] = [];
  let year = Number(from.slice(0, 4));
  let month = Number(from.slice(5, 7));
  const endYear = Number(to.slice(0, 4));
  const endMonth = Number(to.slice(5, 7));
  while (year < endYear || (year === endYear && month <= endMonth)) {
    months.push(`${year}-${String(month).padStart(2, '0')}`);
    month += 1;
    if (month > 12) {
      month = 1;
      year += 1;
    }
  }
  return months;
}

/** Período anterior de mesmo tamanho: é ele que um recorte livre compara. */
export function previousPeriod({ from, to }: Period): Period {
  const days = daysBetween(from, to);
  const previousTo = addDays(from, -1);
  return { from: addDays(previousTo, -(days - 1)), to: previousTo };
}

function categoriesForPeriod(db: Db, { from, to }: Period, source?: string, account?: string, includeInternal?: boolean): { label: string; totalCents: number; count: number }[] {
  const { where, params } = scopeWhere({ from, to }, { source, account, includeInternal }, ['amount_cents < 0']);
  const rows = db
    .prepare(`SELECT category AS label, ABS(SUM(amount_cents)) AS total_cents, COUNT(*) AS n FROM transactions WHERE ${where} GROUP BY category ORDER BY total_cents DESC`)
    .all(...params) as { label: string; total_cents: number; n: number }[];
  return rows.map((r) => ({ label: r.label, totalCents: Number(r.total_cents), count: Number(r.n) }));
}

function totalsForPeriod(db: Db, { from, to }: Period, source?: string, account?: string, includeInternal?: boolean): { outCents: number; inCents: number; count: number } {
  const { where, params } = scopeWhere({ from, to }, { source, account, includeInternal });
  const row = db
    .prepare(`SELECT COALESCE(SUM(CASE WHEN amount_cents < 0 THEN amount_cents END), 0) AS out_cents, COALESCE(SUM(CASE WHEN amount_cents > 0 AND is_refund = 0 THEN amount_cents END), 0) AS in_cents, COUNT(*) AS n FROM transactions WHERE ${where}`)
    .get(...params) as { out_cents: number; in_cents: number; n: number };
  return { outCents: Math.abs(Number(row.out_cents)), inCents: Number(row.in_cents), count: Number(row.n) };
}

export function comparePeriods(db: Db, period: Period, previous: Period, source?: string, account?: string, includeInternal?: boolean) {
  const month = period.to.slice(0, 7);
  const previousMonth = previous.to.slice(0, 7);
  const currentTotal = totalsForPeriod(db, period, source, account, includeInternal);
  const previousTotal = totalsForPeriod(db, previous, source, account, includeInternal);

  const currentCats = categoriesForPeriod(db, period, source, account, includeInternal);
  const previousCats = categoriesForPeriod(db, previous, source, account, includeInternal);
  const prevMap = new Map(previousCats.map((c) => [c.label, c.totalCents]));

  const deltas = currentCats.map((c) => {
    const prev = prevMap.get(c.label) ?? 0;
    const delta = c.totalCents - prev;
    const pct = prev > 0 ? Math.round((delta / prev) * 100) : (c.totalCents > 0 ? 100 : 0);
    return { label: c.label, currentCents: c.totalCents, previousCents: prev, deltaCents: delta, deltaPct: pct };
  });
  // categorias que sumiram este mes
  for (const pc of previousCats) {
    if (!currentCats.some((c) => c.label === pc.label)) {
      deltas.push({ label: pc.label, currentCents: 0, previousCents: pc.totalCents, deltaCents: -pc.totalCents, deltaPct: -100 });
    }
  }
  deltas.sort((a, b) => Math.abs(b.deltaCents) - Math.abs(a.deltaCents));

  // recorrencias: merchants em >=3 dos ultimos 6 meses
  const months6 = Array.from({ length: 6 }, (_, i) => shiftMonth(month, -i).from.slice(0, 7));
  const from6 = `${months6[months6.length - 1]}-01`;
  const to6 = `${month}-31`;
  const { where, params } = scopeWhere({ from: from6, to: to6 }, { source, account, includeInternal: false }, ['amount_cents < 0']);
  const rows = db
    .prepare(`SELECT merchant, substr(posted_at,1,7) AS m, ABS(SUM(amount_cents)) AS total_cents, MAX(posted_at) AS last_at FROM transactions WHERE ${where} GROUP BY merchant, substr(posted_at,1,7)`)
    .all(...params) as { merchant: string; m: string; total_cents: number; last_at: string }[];

  const byMerchant = new Map<string, { months: Set<string>; total: number; lastAt: string }>();
  for (const r of rows) {
    const entry = byMerchant.get(r.merchant) ?? { months: new Set(), total: 0, lastAt: '' };
    entry.months.add(r.m);
    entry.total += Number(r.total_cents);
    if (r.last_at > entry.lastAt) entry.lastAt = r.last_at;
    byMerchant.set(r.merchant, entry);
  }
  const recurrences = [...byMerchant.entries()]
    .filter(([, v]) => v.months.size >= 3)
    .map(([merchant, v]) => ({ merchant, months: v.months.size, avgCents: Math.round(v.total / v.months.size), lastAt: v.lastAt }))
    .sort((a, b) => b.months - a.months || b.avgCents - a.avgCents)
    .slice(0, 8);

  return {
    month,
    previousMonth,
    from: period.from,
    to: period.to,
    previousFrom: previous.from,
    previousTo: previous.to,
    current: { month, from: period.from, to: period.to, ...currentTotal, categories: currentCats },
    previous: { month: previousMonth, from: previous.from, to: previous.to, ...previousTotal, categories: previousCats },
    deltas,
    recurrences,
  };
}

export function summary(db: Db, { from, to }: Period, plannerName: string, source?: string, account?: string, includeInternal?: boolean, invoice?: string) {
  const { where, params } = scopeWhere({ from, to }, { source, account, includeInternal, invoice });
  const totals = db
    .prepare(
      `SELECT COALESCE(SUM(CASE WHEN amount_cents < 0 THEN amount_cents END), 0) AS out_cents,
              COALESCE(SUM(CASE WHEN amount_cents > 0 AND is_refund = 0 THEN amount_cents END), 0) AS in_cents,
              COUNT(*) AS n
       FROM transactions WHERE ${where}`,
    )
    .get(...params) as { out_cents: number; in_cents: number; n: number };
  const categories = db
    .prepare(
      `SELECT category AS label, ABS(SUM(amount_cents)) AS total_cents, COUNT(*) AS n
       FROM transactions WHERE ${where} AND amount_cents < 0
       GROUP BY category ORDER BY total_cents DESC`,
    )
    .all(...params) as { label: string; total_cents: number; n: number }[];

  const monthsWhere = [
    source && 'source = ?',
    account && 'account = ?',
    invoice && 'invoice_month = ?',
  ].filter(Boolean).join(' AND ');
  const months = (db
    .prepare(`SELECT DISTINCT substr(posted_at, 1, 7) AS m FROM transactions ${monthsWhere ? `WHERE ${monthsWhere}` : ''} ORDER BY m DESC`)
    .all(...[source, account, invoice].filter(Boolean) as string[]) as { m: string }[]).map((row) => row.m);

  return {
    month: to.slice(0, 7),
    from,
    to,
    outCents: Math.abs(Number(totals.out_cents)),
    inCents: Number(totals.in_cents),
    count: Number(totals.n),
    categories: categories.map((row) => ({
      label: row.label,
      totalCents: Number(row.total_cents),
      count: Number(row.n),
    })),
    months,
    totalTransactions: source ? (source === 'imported' ? countBySource(db).imported : countBySource(db).sample) : countTransactions(db),
    planner: plannerName,
    source: source ?? 'all',
    sources: countBySource(db),
    accounts: distinctAccounts(db),
    invoiceMonths: invoices(db, source, account).map((row) => row.month),
  };
}

export function transactions(db: Db, { from, to }: Period, limit: number, source?: string, account?: string, includeInternal?: boolean, invoice?: string) {
  const { where, params } = scopeWhere({ from, to }, { source, account, includeInternal, invoice });
  params.push(limit);
  const rows = db
    .prepare(
      `SELECT id, posted_at, description, merchant, category, amount_cents, account, is_internal_transfer, is_refund
       FROM transactions WHERE ${where}
       ORDER BY posted_at DESC, ABS(amount_cents) DESC LIMIT ?`,
    )
    .all(...(params as any)) as {
      id: string;
      posted_at: string;
      description: string;
      merchant: string;
      category: string;
      amount_cents: number;
      is_internal_transfer: number;
      is_refund: number;
    }[];

  return rows.map((row) => ({
    id: String(row.id),
    postedAt: String(row.posted_at),
    description: String(row.description),
    merchant: String(row.merchant),
    category: String(row.category),
    amountCents: Number(row.amount_cents),
    isInternalTransfer: Number(row.is_internal_transfer) === 1,
    isRefund: Number(row.is_refund) === 1,
  }));
}

/**
 * Meses de fatura presentes no banco. A fatura nao se confunde com o mes da
 * compra: uma parcela comprada em agosto aparece na fatura de outubro.
 */
export function invoices(db: Db, source?: string, account?: string) {
  const clauses: string[] = ['invoice_month IS NOT NULL'];
  const params: string[] = [];
  if (source && source !== 'all') { clauses.push('source = ?'); params.push(source); }
  if (account) { clauses.push('account = ?'); params.push(account); }
  const rows = db
    .prepare(
      `SELECT invoice_month AS month, COUNT(*) AS n,
              ABS(SUM(amount_cents)) AS total_cents,
              SUM(CASE WHEN installment_no IS NOT NULL THEN 1 ELSE 0 END) AS installments
       FROM transactions WHERE ${clauses.join(' AND ')}
       GROUP BY invoice_month ORDER BY invoice_month DESC`,
    )
    .all(...params) as { month: string; n: number; total_cents: number; installments: number }[];
  return rows.map((row) => ({
    month: String(row.month),
    count: Number(row.n),
    totalCents: Number(row.total_cents),
    installments: Number(row.installments),
  }));
}

export interface StatementRow {
  posted_at: string;
  account: string;
  description: string;
  merchant: string;
  category: string;
  amount_cents: number;
}

/** Progresso esperado do período: 100% se já terminou, 0% se ainda não começou. */
function expectedPctForPeriod({ from, to }: Period): number {
  const today = new Date().toISOString().slice(0, 10);
  if (today < from) return 0;
  if (today > to) return 100;
  return Math.round((daysBetween(from, today) / daysBetween(from, to)) * 100);
}

/**
 * Orçamento é mensal, mas o painel acompanha o período escolhido: o limite de
 * cada mês entra rateado pelos dias daquele mês que caem no recorte.
 */
export function budgetsForPeriod(db: Db, period: Period, source?: string, account?: string, includeInternal?: boolean) {
  const startMonth = period.from.slice(0, 7);
  const endMonth = period.to.slice(0, 7);
  const limits = new Map<string, number>();
  for (const month of monthsInRange(period.from, period.to)) {
    const bounds = monthFromIso(month);
    const coveredFrom = month === startMonth ? period.from : bounds.from;
    const coveredTo = month === endMonth ? period.to : bounds.to;
    const covered = daysBetween(coveredFrom, coveredTo);
    const total = daysBetween(bounds.from, bounds.to);
    for (const budget of listBudgets(db, month)) {
      const prorated = Math.round((budget.limitCents * covered) / total);
      limits.set(budget.category, (limits.get(budget.category) ?? 0) + prorated);
    }
  }

  const spentMap = new Map(categoriesForPeriod(db, period, source, account, includeInternal).map((c) => [c.label, c.totalCents]));
  const expectedPct = expectedPctForPeriod(period);

  return [...limits.entries()].map(([category, limitCents]) => {
    const spentCents = spentMap.get(category) ?? 0;
    const pct = limitCents > 0 ? Math.round((spentCents / limitCents) * 100) : 0;
    let status: 'ok' | 'warn' | 'over' = 'ok';
    if (pct >= 100) status = 'over';
    else if (pct > expectedPct + 10) status = 'warn';
    return { category, limitCents, spentCents, pct, expectedPct, status };
  });
}
