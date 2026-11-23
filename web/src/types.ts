export type Source = 'all' | 'sample' | 'imported' | 'manual';

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

export interface BreakdownRow {
  label: string;
  totalCents: number;
  count: number;
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

export interface AskResponse {
  question: string;
  spec: QuerySpec;
  sql: string;
  params: (string | number)[];
  outcome: QueryOutcome;
  answer: string;
  ms: number;
  planner: string;
  /** true quando a pergunta continuou a anterior ("e em setembro?"). */
  followUp?: boolean;
  /** contraparte reconhecida no extrato quando o planner nao filtrou por ela. */
  guard?: string;
}

export interface Range {
  from: string;
  to: string;
}

export interface BudgetItem {
  category: string;
  limitCents: number;
  spentCents: number;
  pct: number;
  expectedPct: number;
  status: 'ok' | 'warn' | 'over';
}

export interface MonthCompare {
  month: string;
  previousMonth: string;
  from: string;
  to: string;
  previousFrom: string;
  previousTo: string;
  current: { month: string; from: string; to: string; outCents: number; inCents: number; count: number; categories: { label: string; totalCents: number; count: number }[] };
  previous: { month: string; from: string; to: string; outCents: number; inCents: number; count: number; categories: { label: string; totalCents: number; count: number }[] };
  deltas: { label: string; currentCents: number; previousCents: number; deltaCents: number; deltaPct: number }[];
  recurrences: { merchant: string; months: number; avgCents: number; lastAt: string }[];
}
export interface ManualEntry {
  id: string;
  amountCents: number;
  direction: 'in' | 'out';
  postedAt: string;
  category: string;
  description: string;
  tags: string[];
  account: string;
  recurringTemplateId: string | null;
}

export interface RecurringTemplate {
  id: string;
  amountCents: number;
  direction: 'in' | 'out';
  category: string;
  description: string;
  frequency: 'weekly' | 'monthly';
  dayOfMonth: number | null;
  weekday: number | null;
  startDate: string;
  endDate: string | null;
  active: boolean;
}

export interface ManualSummary {
  outCents: number;
  inCents: number;
  count: number;
  categories: { label: string; totalCents: number; count: number }[];
  months: string[];
  allCategories: string[];
}

export interface MonthSummary {
  month: string;
  from: string;
  to: string;
  outCents: number;
  inCents: number;
  count: number;
  categories: { label: string; totalCents: number; count: number }[];
  allCategories?: string[];
  months: string[];
  totalTransactions: number;
  planner: string;
  source?: string;
  sources?: { sample: number; imported: number };
  accounts?: string[];
  invoiceMonths?: string[];
  origins?: { imported: { outCents: number; inCents: number; count: number }; manual: { outCents: number; inCents: number; count: number } };
  includeManual?: boolean;
}

export interface Transaction {
  id?: string;
  postedAt: string;
  description: string;
  merchant: string;
  category: string;
  amountCents: number;
  isInternalTransfer?: boolean;
  isRefund?: boolean;
}

export interface ImportResult {
  read: number;
  inserted: number;
  duplicates: number;
  format: 'csv' | 'ofx' | 'pdf';
  account?: string;
  via?: 'texto' | 'ocr';
  ocrCorrections?: number;
  month: string;
  summary: MonthSummary;
  transfers?: number;
  accounts?: string[];
  reportedBalanceCents?: number | null;
  computedSumCents?: number;
  balanceOk?: boolean | null;
  balanceMessage?: string;
  crossAccountDuplicates?: number;
  invoiceMonth?: string | null;
  installments?: number;
}
