import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { extname, join, normalize, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

import { openDb, countTransactions, countBySource, deleteImported, distinctAccounts, detectInternalTransfers, applyOverridesToTransactions, setOverrideCategory, listBudgets, upsertBudget, deleteBudget, type Db } from './db.ts';
import { importExtrato, importPdf } from './ingest/import.ts';
import { parseDateToISO } from './ingest/normalize.ts';
import { compileSpec } from './query/compile.ts';
import { executeSpec } from './query/execute.ts';
import { renderAnswer, brl, describePeriod, shortDate } from './query/render.ts';
import { MONTHS } from './domain/vocab.ts';
import { monthFromIso, shiftMonth } from './domain/dates.ts';
import { MAX_QUESTION_LENGTH, looksLikeInjection, sanitizeQuestion } from './domain/question.ts';
import { parseSpec, type QuerySpec } from './query/spec.ts';
import { applyEntityGuard } from './query/guard.ts';
import { isFollowUp, mergeFollowUp } from './query/context.ts';
import { heuristicPlanner, OutOfScopeError, type Planner } from './planner/fake.ts';
import { buildPlanner } from './planner/openai.ts';
import { loadEnvFile } from './env.ts';
import PDFDocument from 'pdfkit';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
// EXTRATO_DB aponta o banco para outro arquivo (testes de API usam um temporario)
const DB_PATH = process.env.EXTRATO_DB ?? join(ROOT, 'data', 'extrato.db');
const DIST = join(ROOT, 'web', 'dist');
const SAMPLE = join(ROOT, 'data', 'sample-extrato.csv');
// PORT=0 ou vazio cai no padrao: o vite faz proxy de /api para 8787, entao porta aleatoria quebraria a UI
const PORT = Number(process.env.PORT) || 8787;
// import carrega base64 (+33%) de um PDF de ate 8 MB; as demais rotas so
// recebem JSON pequeno (pergunta, spec, modo do reset)
const MAX_IMPORT_BODY = 12 * 1024 * 1024;
const MAX_JSON_BODY = 256 * 1024;
const MAX_ACCOUNT_LENGTH = 40;
const SECURITY_HEADERS = {
  'content-security-policy':
    "default-src 'self'; base-uri 'none'; object-src 'none'; frame-ancestors 'none'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'; font-src 'self' data:; connect-src 'self'",
  'x-content-type-options': 'nosniff',
  'x-frame-options': 'DENY',
  'referrer-policy': 'no-referrer',
  'permissions-policy': 'camera=(), microphone=(), geolocation=()',
};

/** Erro com status HTTP proprio: evita transformar tudo em 400. */
class HttpError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

function hostnameOf(value: string): string | null {
  try {
    return new URL(value.includes('://') ? value : `http://${value}`).hostname.toLowerCase();
  } catch {
    return null;
  }
}

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '::1']);

/** Host/Origin de loopback: `localhost:5173`, `127.0.0.1:8787`, `[::1]:1`. */
function isLoopback(value: string): boolean {
  const hostname = hostnameOf(value);
  if (!hostname) return false;
  const bare = hostname.replace(/^\[|\]$/g, '');
  return LOOPBACK_HOSTS.has(bare) || bare.endsWith('.localhost');
}

loadEnvFile(join(ROOT, '.env'));

const planner: Planner = buildPlanner();
const db: Db = openDb(DB_PATH);

if (countTransactions(db) === 0) {
  const result = importExtrato(db, readFileSync(SAMPLE, 'utf8'), 'principal', 'sample');
  console.log(`seed: ${result.inserted} lancamentos de exemplo importados`);
}

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.woff2': 'font/woff2',
  '.ico': 'image/x-icon',
};

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const data = JSON.stringify(body);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(data),
    'cache-control': 'no-store',
  });
  res.end(data);
}

async function readJson(req: IncomingMessage, maxBytes = MAX_JSON_BODY): Promise<Record<string, unknown>> {
  const type = String(req.headers['content-type'] ?? '').toLowerCase();
  // POST de site externo nao consegue mandar application/json sem passar por
  // preflight: exigir o tipo tambem fecha a porta do formulario cross-site
  if (!type.startsWith('application/json')) {
    throw new HttpError(415, 'envie o corpo como application/json');
  }

  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > maxBytes) throw new HttpError(413, `corpo da requisicao maior que ${Math.round(maxBytes / 1024)} KB`);
    chunks.push(chunk as Buffer);
  }
  const text = Buffer.concat(chunks).toString('utf8');
  if (!text.trim()) return {};
  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    throw new Error('JSON invalido no corpo da requisicao');
  }
}

function currentMonth(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function validMonth(value: string): boolean {
  return /^\d{4}-(0[1-9]|1[0-2])$/.test(value);
}

/** Recorte de datas: o mês das abas ou um período livre (de/até). */
interface Period {
  from: string;
  to: string;
}

/** de/até na query vencem o mês; sem nenhum dos dois, cai no mês corrente. */
function periodFromQuery(url: URL): Period {
  const from = url.searchParams.get('from');
  const to = url.searchParams.get('to');
  if (!from && !to) {
    const month = url.searchParams.get('month') ?? currentMonth();
    if (!validMonth(month)) throw new HttpError(400, 'mes invalido (use YYYY-MM)');
    return monthFromIso(month);
  }

  const start = from ? parseDateToISO(from) : '0000-01-01';
  const end = to ? parseDateToISO(to) : '9999-12-31';
  if (start > end) throw new Error('periodo invertido: "de" precisa vir antes de "ate"');
  return { from: start, to: end };
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
function previousPeriod({ from, to }: Period): Period {
  const days = daysBetween(from, to);
  const previousTo = addDays(from, -1);
  return { from: addDays(previousTo, -(days - 1)), to: previousTo };
}

/** Painéis de comparação/orçamento precisam de início e fim explícitos. */
function strictPeriod(url: URL): Period {
  const from = url.searchParams.get('from');
  const to = url.searchParams.get('to');
  if (!from || !to) throw new HttpError(400, 'informe "de" e "ate" juntos');
  const start = parseDateToISO(from);
  const end = parseDateToISO(to);
  if (start > end) throw new Error('periodo invertido: "de" precisa vir antes de "ate"');
  return { from: start, to: end };
}

function monthOrPeriodFromQuery(url: URL): Period {
  const from = url.searchParams.get('from');
  const to = url.searchParams.get('to');
  if (!from && !to) {
    const month = url.searchParams.get('month') ?? currentMonth();
    if (!validMonth(month)) throw new HttpError(400, 'mes invalido (use YYYY-MM)');
    return monthFromIso(month);
  }
  return strictPeriod(url);
}

function compareScope(url: URL): { period: Period; previous: Period } {
  if (url.searchParams.get('from') || url.searchParams.get('to')) {
    const period = strictPeriod(url);
    return { period, previous: previousPeriod(period) };
  }
  const month = url.searchParams.get('month') ?? currentMonth();
  if (!validMonth(month)) throw new HttpError(400, 'mes invalido (use YYYY-MM)');
  // mês compara com o mês fechado anterior, não com "30 dias antes"
  return { period: monthFromIso(month), previous: monthFromIso(shiftMonth(month, -1).from.slice(0, 7)) };
}

function categoriesForPeriod({ from, to }: Period, source?: string, account?: string, includeInternal?: boolean): { label: string; totalCents: number; count: number }[] {
  const clauses: string[] = ['posted_at >= ?', 'posted_at <= ?', 'amount_cents < 0'];
  const params: (string | number)[] = [from, to];
  if (source) { clauses.push('source = ?'); params.push(source); }
  if (account) { clauses.push('account = ?'); params.push(account); }
  if (!includeInternal) clauses.push('is_internal_transfer = 0');
  const rows = db
    .prepare(`SELECT category AS label, ABS(SUM(amount_cents)) AS total_cents, COUNT(*) AS n FROM transactions WHERE ${clauses.join(' AND ')} GROUP BY category ORDER BY total_cents DESC`)
    .all(...params) as { label: string; total_cents: number; n: number }[];
  return rows.map((r) => ({ label: r.label, totalCents: Number(r.total_cents), count: Number(r.n) }));
}

function totalsForPeriod({ from, to }: Period, source?: string, account?: string, includeInternal?: boolean): { outCents: number; inCents: number; count: number } {
  const clauses: string[] = ['posted_at >= ?', 'posted_at <= ?'];
  const params: (string | number)[] = [from, to];
  if (source) { clauses.push('source = ?'); params.push(source); }
  if (account) { clauses.push('account = ?'); params.push(account); }
  if (!includeInternal) clauses.push('is_internal_transfer = 0');
  const row = db
    .prepare(`SELECT COALESCE(SUM(CASE WHEN amount_cents < 0 THEN amount_cents END), 0) AS out_cents, COALESCE(SUM(CASE WHEN amount_cents > 0 THEN amount_cents END), 0) AS in_cents, COUNT(*) AS n FROM transactions WHERE ${clauses.join(' AND ')}`)
    .get(...params) as { out_cents: number; in_cents: number; n: number };
  return { outCents: Math.abs(Number(row.out_cents)), inCents: Number(row.in_cents), count: Number(row.n) };
}

function comparePeriods(period: Period, previous: Period, source?: string, account?: string, includeInternal?: boolean) {
  const month = period.to.slice(0, 7);
  const previousMonth = previous.to.slice(0, 7);
  const currentTotal = totalsForPeriod(period, source, account, includeInternal);
  const previousTotal = totalsForPeriod(previous, source, account, includeInternal);

  const currentCats = categoriesForPeriod(period, source, account, includeInternal);
  const previousCats = categoriesForPeriod(previous, source, account, includeInternal);
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
  const clauses: string[] = ['posted_at >= ?', 'posted_at <= ?', 'amount_cents < 0', 'is_internal_transfer = 0'];
  const params: (string | number)[] = [from6, to6];
  if (source) { clauses.push('source = ?'); params.push(source); }
  if (account) { clauses.push('account = ?'); params.push(account); }
  const rows = db
    .prepare(`SELECT merchant, substr(posted_at,1,7) AS m, ABS(SUM(amount_cents)) AS total_cents, MAX(posted_at) AS last_at FROM transactions WHERE ${clauses.join(' AND ')} GROUP BY merchant, substr(posted_at,1,7)`)
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

function summary({ from, to }: Period, source?: string, account?: string, includeInternal?: boolean) {
  const clauses: string[] = ['posted_at >= ?', 'posted_at <= ?'];
  const params: (string | number)[] = [from, to];
  if (source) { clauses.push('source = ?'); params.push(source); }
  if (account) { clauses.push('account = ?'); params.push(account); }
  if (!includeInternal) clauses.push('is_internal_transfer = 0');
  const where = 'WHERE ' + clauses.join(' AND ');
  const totals = db
    .prepare(
      `SELECT COALESCE(SUM(CASE WHEN amount_cents < 0 THEN amount_cents END), 0) AS out_cents,
              COALESCE(SUM(CASE WHEN amount_cents > 0 THEN amount_cents END), 0) AS in_cents,
              COUNT(*) AS n
       FROM transactions ${where}`,
    )
    .get(...params) as { out_cents: number; in_cents: number; n: number };
  const categories = db
    .prepare(
      `SELECT category AS label, ABS(SUM(amount_cents)) AS total_cents, COUNT(*) AS n
       FROM transactions ${where} AND amount_cents < 0
       GROUP BY category ORDER BY total_cents DESC`,
    )
    .all(...params) as { label: string; total_cents: number; n: number }[];

  const monthsWhere = [source && 'source = ?', account && 'account = ?'].filter(Boolean).join(' AND ');
  const months = (db
    .prepare(`SELECT DISTINCT substr(posted_at, 1, 7) AS m FROM transactions ${monthsWhere ? `WHERE ${monthsWhere}` : ''} ORDER BY m DESC`)
    .all(...[source, account].filter(Boolean) as string[]) as { m: string }[]).map((row) => row.m);

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
    planner: planner.name,
    source: source ?? 'all',
    sources: countBySource(db),
    accounts: distinctAccounts(db),
  };
}

function transactions({ from, to }: Period, limit: number, source?: string, account?: string, includeInternal?: boolean) {
  const clauses = ['posted_at >= ?', 'posted_at <= ?'];
  const params: (string | number)[] = [from, to];
  if (source) { clauses.push('source = ?'); params.push(source); }
  if (account) { clauses.push('account = ?'); params.push(account); }
  if (!includeInternal) clauses.push('is_internal_transfer = 0');
  params.push(limit);
  const rows = db
    .prepare(
      `SELECT id, posted_at, description, merchant, category, amount_cents, account
       FROM transactions WHERE ${clauses.join(' AND ')}
       ORDER BY posted_at DESC, ABS(amount_cents) DESC LIMIT ?`,
    )
    .all(...(params as any)) as {
      id: string;
      posted_at: string;
      description: string;
      merchant: string;
      category: string;
      amount_cents: number;
    }[];

  return rows.map((row) => ({
    id: String(row.id),
    postedAt: String(row.posted_at),
    description: String(row.description),
    merchant: String(row.merchant),
    category: String(row.category),
    amountCents: Number(row.amount_cents),
  }));
}

interface StatementRow {
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
function budgetsForPeriod(period: Period, source?: string, account?: string, includeInternal?: boolean) {
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

  const spentMap = new Map(categoriesForPeriod(period, source, account, includeInternal).map((c) => [c.label, c.totalCents]));
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

function monthLabel(month: string): string {
  const [year, number] = month.split('-');
  return `${MONTHS[Number(number) - 1] ?? number} de ${year}`;
}

function money(cents: number): string {
  const value = (Math.abs(cents) / 100).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return `${cents < 0 ? '-' : '+'} R$ ${value}`;
}

/** Valor sem sinal, para linhas que já dizem entradas/saídas. */
const magnitude = (cents: number) => money(Math.abs(cents)).replace('+ ', '');

function pdfToBuffer(build: (doc: PDFKit.PDFDocument) => void): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 40 });
    const chunks: Buffer[] = [];
    doc.on('data', (chunk: Buffer) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    try {
      build(doc);
      doc.end();
    } catch (err) {
      reject(err);
    }
  });
}

/**
 * Super extrato: todos os lancamentos, ordenados por mes, conta e data,
 * com subtotal por mes e resumo por conta. E o papel que fecha o mes.
 */
function buildStatementPdf(options?: { source?: string; from?: string; to?: string; account?: string; includeInternal?: boolean }): Promise<Buffer> {
  const source = options?.source;
  const account = options?.account;
  const includeInternal = options?.includeInternal;
  const clauses: string[] = [];
  const params: (string | number)[] = [];
  if (source && source !== 'all') { clauses.push('source = ?'); params.push(source); }
  if (account) { clauses.push('account = ?'); params.push(account); }
  if (options?.from) { clauses.push('posted_at >= ?'); params.push(options.from); }
  if (options?.to) { clauses.push('posted_at <= ?'); params.push(options.to); }
  if (!includeInternal) clauses.push('is_internal_transfer = 0');
  const where = clauses.length ? 'WHERE ' + clauses.join(' AND ') : '';
  const rows = db
    .prepare(
      `SELECT posted_at, account, description, merchant, category, amount_cents
       FROM transactions ${where}
       ORDER BY posted_at ASC, account ASC, ABS(amount_cents) DESC`,
    )
    .all(...params) as unknown as StatementRow[];

  return pdfToBuffer((doc) => {
    const left = 40;
    const right = 555;
    const pageBottom = 772;
    const columns = { date: 40, account: 112, desc: 186, category: 372, value: 468 };

    let y = 0;

    const tableHeader = () => {
      doc.font('Helvetica-Bold').fontSize(8).fillColor('#5F6F63');
      doc.text('DATA', columns.date, y, { lineBreak: false });
      doc.text('CONTA', columns.account, y, { lineBreak: false });
      doc.text('DESCRIÇÃO', columns.desc, y, { lineBreak: false });
      doc.text('CATEGORIA', columns.category, y, { lineBreak: false });
      doc.text('VALOR', columns.value, y, { width: right - columns.value, align: 'right' });
      doc.moveTo(left, y + 12).lineTo(right, y + 12).strokeColor('#CFC6B2').stroke();
      y += 20;
    };

    const addPage = () => {
      doc.addPage();
      y = 48;
      tableHeader();
    };

    const ensure = (needed: number) => {
      if (y + needed > pageBottom) addPage();
    };

    // capa
    doc.font('Helvetica-Bold').fontSize(18).fillColor('#1A2536').text('Onde foi o meu dinheiro?', left, 40);
    doc.font('Helvetica').fontSize(10).fillColor('#454F5E').text('Super extrato — lançamentos consolidados', left, 64);
    // periodo do papel: o recorte pedido ou, sem recorte, a primeira e a ultima data do banco
    const period = options?.from && options?.to
      ? `${shortDate(options.from)} a ${shortDate(options.to)}`
      : rows.length
        ? `${shortDate(rows[0]!.posted_at)} a ${shortDate(rows[rows.length - 1]!.posted_at)}`
        : 'sem lançamentos';
    doc.fontSize(9).fillColor('#5F6F63').text(
      `Gerado em ${new Date().toLocaleString('pt-BR')} · ${rows.length} lançamentos · ${period}`,
      left,
      80,
    );

    // resumo geral
    let totalIn = 0;
    let totalOut = 0;
    for (const row of rows) {
      if (row.amount_cents > 0) totalIn += row.amount_cents;
      else totalOut += row.amount_cents;
    }

    y = 108;
    doc.font('Helvetica-Bold').fontSize(10).fillColor('#1A2536').text('Resumo', left, y);
    y += 16;
    doc.font('Helvetica').fontSize(9).fillColor('#454F5E');
    doc.text(`Entradas: ${magnitude(totalIn)}`, left, y, { lineBreak: false });
    doc.text(`Saídas: ${magnitude(totalOut)}`, left + 170, y, { lineBreak: false });
    doc.text(`Saldo: ${money(totalIn + totalOut)}`, left + 340, y, { lineBreak: false });
    y += 14;

    // resumo por conta
    const accounts = new Map<string, { n: number; inCents: number; outCents: number }>();
    for (const row of rows) {
      const entry = accounts.get(row.account) ?? { n: 0, inCents: 0, outCents: 0 };
      entry.n += 1;
      if (row.amount_cents > 0) entry.inCents += row.amount_cents;
      else entry.outCents += row.amount_cents;
      accounts.set(row.account, entry);
    }
    for (const [account, entry] of accounts) {
      doc.fillColor('#5F6F63').text(
        `${account} · ${entry.n} lançamentos · entradas ${magnitude(entry.inCents)} · saídas ${magnitude(entry.outCents)}`,
        left,
        y,
        { lineBreak: false },
      );
      y += 12;
    }

    // totais por mes numa passada: antes cada virada de mes filtrava a lista inteira
    const monthTotals = new Map<string, { n: number; inCents: number; outCents: number }>();
    for (const row of rows) {
      const key = row.posted_at.slice(0, 7);
      const entry = monthTotals.get(key) ?? { n: 0, inCents: 0, outCents: 0 };
      entry.n += 1;
      if (row.amount_cents > 0) entry.inCents += row.amount_cents;
      else entry.outCents += row.amount_cents;
      monthTotals.set(key, entry);
    }

    // lancamentos agrupados por mes
    let currentMonth = '';
    for (let index = 0; index < rows.length; index++) {
      const row = rows[index]!;
      const rowMonth = row.posted_at.slice(0, 7);

      if (rowMonth !== currentMonth) {
        currentMonth = rowMonth;
        const month = monthTotals.get(rowMonth)!;

        ensure(96);
        y += 16;
        doc.moveTo(left, y).lineTo(right, y).strokeColor('#CFC6B2').stroke();
        y += 10;
        doc.font('Helvetica-Bold').fontSize(11).fillColor('#1A2536').text(monthLabel(rowMonth), left, y);
        doc.font('Helvetica').fontSize(8).fillColor('#5F6F63').text(
          `${month.n} lançamentos · entradas ${magnitude(month.inCents)} · saídas ${magnitude(month.outCents)} · saldo ${money(month.inCents + month.outCents)}`,
          left,
          y + 14,
        );
        y += 32;
        tableHeader();
      }

      ensure(14);
      doc.font('Helvetica').fontSize(8).fillColor('#1A2536');
      doc.text(shortDate(row.posted_at), columns.date, y, { width: 66, lineBreak: false });
      doc.text(String(row.account).slice(0, 14), columns.account, y, { width: 68, lineBreak: false });
      doc.text(String(row.merchant || row.description).slice(0, 38), columns.desc, y, { width: 180, lineBreak: false });
      doc.text(String(row.category).slice(0, 18), columns.category, y, { width: 92, lineBreak: false });
      doc.text(money(row.amount_cents), columns.value, y, { width: right - columns.value, align: 'right', lineBreak: false });
      y += 13;
    }

    ensure(30);
    y += 10;
    doc.moveTo(left, y).lineTo(right, y).strokeColor('#CFC6B2').stroke();
    y += 10;
    doc.font('Helvetica-Bold').fontSize(9).fillColor('#1A2536').text('Total geral', left, y);
    doc.text(`${money(totalIn + totalOut)}`, columns.value, y, { width: right - columns.value, align: 'right' });
    y += 18;
    doc.font('Helvetica').fontSize(8).fillColor('#5F6F63').text(
      'Gerado pelo Onde foi o meu dinheiro? — nenhum token somado; todo valor veio do SQLite.',
      left,
      y,
      { width: right - left },
    );
  });
}

interface AskPayload {
  question: string;
  spec: QuerySpec;
  sql: string;
  params: (string | number)[];
  outcome: ReturnType<typeof executeSpec>;
  answer: string;
  ms: number;
  planner: string;
  followUp: boolean;
  guard?: string;
}

async function answerQuestion(body: Record<string, unknown>): Promise<AskPayload> {
  const rawQuestion = typeof body.question === 'string' ? body.question : '';
  if (rawQuestion.trim().length > MAX_QUESTION_LENGTH) throw new Error('pergunta longa demais (max 300 caracteres)');
  const question = sanitizeQuestion(rawQuestion);
  if (!question) throw new Error('envie {"question": "..."}');
  if (looksLikeInjection(question)) throw new Error('pergunta bloqueada por seguranca');

  const started = performance.now();

  // A folha de prova reenvia a spec exibida: o PDF tem que provar o numero que
  // estava na tela, nao o que o modelo responderia de novo.
  const pinned = body.spec !== undefined && body.spec !== null ? parseSpec(body.spec) : null;
  const followUp = !pinned && isFollowUp(question) && typeof body.context === 'object' && body.context !== null;

  const today = new Date().toISOString().slice(0, 10);
  // período escolhido na tela já é filtro: "quanto gastei" deixa de ser pergunta sem recorte
  const hasRange = Boolean(
    (typeof body.from === 'string' && body.from) || (typeof body.to === 'string' && body.to),
  );

  let planned: QuerySpec;
  let usedPlanner: string;
  if (pinned) {
    planned = pinned;
    usedPlanner = 'spec da consulta (sem replanejamento)';
  } else if (followUp) {
    // o complemento ("e no mes anterior?") e curto e depende do anterior:
    // o heuristico entende periodo/categoria sem deixar o modelo adivinhar.
    planned = await heuristicPlanner.plan({ question, today, allowEmpty: true });
    usedPlanner = `${heuristicPlanner.name} · continuação`;
  } else {
    try {
      planned = await planner.plan({ question, today });
    } catch (error) {
      if (!hasRange || !(error instanceof OutOfScopeError)) throw error;
      planned = await planner.plan({ question, today, allowEmpty: true });
    }
    usedPlanner = planner.name;
  }

  // "e em setembro?" / "e no mes anterior?" continuam a consulta anterior
  let spec = followUp ? mergeFollowUp(parseSpec(body.context), planned, question) : planned;

  const source = typeof body.source === 'string' && body.source !== 'all' ? body.source : undefined;
  if (source) spec.filters.source = source as 'sample' | 'imported';
  if (typeof body.account === 'string' && body.account) spec.filters.account = body.account;
  if (typeof body.includeInternal === 'boolean') spec.filters.includeInternal = body.includeInternal;

  // período livre escolhido na tela manda no recorte da pergunta (a spec fixada, da folha de prova, não é tocada)
  if (!pinned && (typeof body.from === 'string' || typeof body.to === 'string')) {
    const from = typeof body.from === 'string' && body.from ? parseDateToISO(body.from) : undefined;
    const to = typeof body.to === 'string' && body.to ? parseDateToISO(body.to) : undefined;
    if (from) spec.filters.from = from;
    if (to) spec.filters.to = to;
    if (spec.filters.from && spec.filters.to && spec.filters.from > spec.filters.to) {
      throw new Error('periodo invertido: "de" precisa vir antes de "ate"');
    }
  }

  const guarded = applyEntityGuard(db, spec, question);
  spec = guarded.spec;

  const { sql, params } = compileSpec(spec);
  const outcome = executeSpec(db, spec);
  const elapsed = Math.round(performance.now() - started);

  return {
    question,
    spec,
    sql,
    params,
    outcome,
    answer: renderAnswer(spec, outcome),
    ms: elapsed,
    planner: usedPlanner,
    followUp,
    guard: guarded.matched,
  };
}

function buildProofPdf(payload: AskPayload): Promise<Buffer> {
  return pdfToBuffer((doc) => {
    const left = 40;
    const right = 555;
    let y = 40;

    doc.font('Helvetica-Bold').fontSize(9).fillColor('#5F6F63').text('ONDE FOI O MEU DINHEIRO?', left, y);
    y += 18;
    doc.font('Helvetica-Bold').fontSize(18).fillColor('#1A2536').text('Folha de prova', left, y);
    y += 26;
    doc.font('Helvetica').fontSize(9).fillColor('#5F6F63').text(
      `Emitida em ${new Date().toLocaleString('pt-BR')}`,
      left,
      y,
    );
    y += 22;

    const field = (label: string, value: string, options: { mono?: boolean } = {}) => {
      doc.font('Helvetica-Bold').fontSize(8).fillColor('#5F6F63').text(label.toUpperCase(), left, y);
      y += 12;
      doc.font(options.mono ? 'Courier' : 'Helvetica').fontSize(9).fillColor('#1A2536').text(value, left, y, { width: right - left });
      y = doc.y + 12;
    };

    field('Pergunta', payload.question);
    field('Resposta', payload.answer);

    const direction = payload.spec.filters.direction ?? 'any';
    const scope = describePeriod(payload.spec.filters.from, payload.spec.filters.to);
    if (payload.outcome.kind === 'sum') {
      field('Número apurado', `${brl(payload.outcome.totalCents)} · ${payload.outcome.count} lançamentos · ${direction === 'in' ? 'entradas' : direction === 'out' ? 'saídas' : 'saldo'} · ${scope}`);
    } else if (payload.outcome.kind === 'count') {
      field('Número apurado', `${payload.outcome.count} lançamentos · ${scope}`);
    } else if (payload.outcome.kind === 'average') {
      field('Número apurado', `${brl(payload.outcome.averageCents)} por lançamento · ${payload.outcome.count} lançamentos · ${scope}`);
    } else if (payload.outcome.kind === 'list') {
      const rows = payload.outcome.rows
        .slice(0, 12)
        .map((row, index) => `${String(index + 1).padStart(2)}. ${row.postedAt} · ${row.merchant} — ${brl(row.amountCents)}`)
        .join('\n');
      field('Lançamentos', `${payload.outcome.rows.length} no recorte · ${scope}\n${rows}`);
    } else {
      const rows = payload.outcome.rows.slice(0, 12).map((row, index) => `${String(index + 1).padStart(2)}. ${row.label} — ${brl(row.totalCents)}`).join('\n');
      field('Número apurado', `${brl(payload.outcome.totalCents)} no total · ${scope}\n${rows}`);
    }

    field('SQL executado', payload.sql.replace(/\s+/g, ' ').trim(), { mono: true });
    field('Parâmetros', JSON.stringify(payload.params), { mono: true });
    field('QuerySpec', JSON.stringify(payload.spec, null, 2), { mono: true });
    field(
      'Como foi apurado',
      `planner: ${payload.planner}\ntempo: ${payload.ms} ms\ntokens somados: 0\nfonte do valor: SQLite${payload.followUp ? '\ncontexto: continuacao da pergunta anterior' : ''}${payload.guard ? `\nfiltro de contraparte aplicado: ${payload.guard}` : ''}`,
    );

    doc.font('Helvetica').fontSize(8).fillColor('#5F6F63').text(
      'O modelo não calcula: ele só traduz a pergunta em filtros. A soma acontece no banco.',
      left,
      Math.min(y + 8, 780),
      { width: right - left },
    );
  });
}


async function serveStatic(pathname: string, res: ServerResponse): Promise<void> {
  const relative = normalize(decodeURIComponent(pathname)).replace(/^[\\/]+/, '');
  const file = join(DIST, relative);
  if (file !== DIST && !file.startsWith(DIST + sep)) {
    res.writeHead(403).end('forbidden');
    return;
  }

  const candidates = relative === '' ? [join(DIST, 'index.html')] : [file, join(DIST, 'index.html')];
  for (const candidate of candidates) {
    try {
      const info = await stat(candidate);
      if (!info.isFile()) continue;
      const body = await readFile(candidate);
      res.writeHead(200, {
        'content-type': MIME[extname(candidate).toLowerCase()] ?? 'application/octet-stream',
        'content-length': body.length,
        'cache-control': extname(candidate) === '.html' ? 'no-cache' : 'public, max-age=31536000, immutable',
      });
      res.end(body);
      return;
    } catch {
      // tenta o proximo candidato
    }
  }

  res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
  res.end('UI nao construida. Rode `npm run build` ou use `npm run dev`.');
}

const server = createServer(async (req, res) => {
  for (const [name, value] of Object.entries(SECURITY_HEADERS)) res.setHeader(name, value);

  try {
    // DNS rebinding: um site externo que resolve para 127.0.0.1 chega aqui com
    // o Host do dominio dele. A API so atende quem se apresenta como loopback.
    if (req.headers.host && !isLoopback(req.headers.host)) {
      throw new HttpError(403, 'host nao permitido: a API so atende loopback');
    }
    if (req.method === 'POST' && req.headers.origin !== undefined && !isLoopback(req.headers.origin)) {
      throw new HttpError(403, 'origem nao permitida');
    }

    const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);

    if (url.pathname === '/api/health') {
      return sendJson(res, 200, { ok: true, planner: planner.name, transactions: countTransactions(db), sources: countBySource(db), accounts: distinctAccounts(db) });
    }

    if (url.pathname === '/api/summary' && req.method === 'GET') {
      const source = url.searchParams.get('source') ?? undefined;
      const account = url.searchParams.get('account') ?? undefined;
      const includeInternal = url.searchParams.get('includeInternal') === '1';
      return sendJson(res, 200, summary(periodFromQuery(url), source && source !== 'all' ? source : undefined, account, includeInternal));
    }

    if (url.pathname === '/api/compare' && req.method === 'GET') {
      const { period, previous } = compareScope(url);
      const source = url.searchParams.get('source') ?? undefined;
      const account = url.searchParams.get('account') ?? undefined;
      const includeInternal = url.searchParams.get('includeInternal') === '1';
      return sendJson(res, 200, comparePeriods(period, previous, source && source !== 'all' ? source : undefined, account, includeInternal));
    }

    if (url.pathname === '/api/budgets' && req.method === 'GET') {
      const period = monthOrPeriodFromQuery(url);
      const source = url.searchParams.get('source') ?? undefined;
      const account = url.searchParams.get('account') ?? undefined;
      const includeInternal = url.searchParams.get('includeInternal') === '1';
      return sendJson(res, 200, {
        month: period.to.slice(0, 7),
        from: period.from,
        to: period.to,
        items: budgetsForPeriod(period, source && source !== 'all' ? source : undefined, account, includeInternal),
      });
    }

    if (url.pathname === '/api/budgets' && req.method === 'POST') {
      const body = await readJson(req);
      const category = typeof body.category === 'string' ? body.category : '';
      const month = typeof body.month === 'string' ? body.month : currentMonth();
      const limitCents = Number(body.limitCents);
      if (!category || !Number.isFinite(limitCents) || limitCents <= 0) throw new HttpError(400, 'categoria e limite obrigatorios');
      if (category.length > 60) throw new HttpError(400, 'categoria muito longa');
      if (!validMonth(month)) throw new HttpError(400, 'mes invalido (use YYYY-MM)');
      upsertBudget(db, category, month, Math.round(limitCents));
      return sendJson(res, 200, { ok: true });
    }

    if (url.pathname === '/api/budgets' && req.method === 'DELETE') {
      const category = url.searchParams.get('category') ?? '';
      const month = url.searchParams.get('month') ?? currentMonth();
      if (!validMonth(month)) throw new HttpError(400, 'mes invalido (use YYYY-MM)');
      if (category.length > 60) throw new HttpError(400, 'categoria muito longa');
      if (!category) throw new HttpError(400, 'categoria obrigatoria');
      deleteBudget(db, category, month);
      return sendJson(res, 200, { ok: true });
    }

    if (url.pathname === '/api/transactions' && req.method === 'GET') {
      // Teto generoso: "ver todos" num período livre é uma lista só, não uma paginação.
      const limit = Math.min(Number(url.searchParams.get('limit') ?? 12) || 12, 5000);
      const source = url.searchParams.get('source') ?? undefined;
      const account = url.searchParams.get('account') ?? undefined;
      const includeInternal = url.searchParams.get('includeInternal') === '1';
      const period = periodFromQuery(url);
      return sendJson(res, 200, {
        month: period.to.slice(0, 7),
        items: transactions(period, limit, source && source !== 'all' ? source : undefined, account, includeInternal),
      });
    }

    const recatMatch = url.pathname.match(/^\/api\/transactions\/([^/]+)$/);
    if (recatMatch && req.method === 'PATCH') {
      const id = decodeURIComponent(recatMatch[1] ?? '');
      if (!id) throw new HttpError(400, 'id obrigatorio');
      const body = await readJson(req);
      const category = typeof body.category === 'string' ? body.category : '';
      const applyAll = body.applyAll === true;
      if (!category) throw new HttpError(400, 'categoria obrigatoria');
      if (category.length > 60) throw new HttpError(400, 'categoria muito longa');
      const row = db.prepare('SELECT merchant FROM transactions WHERE id = ?').get(id) as { merchant: string } | undefined;
      if (!row) throw new HttpError(404, 'lancamento nao encontrado');
      // applyAll reclassifica TODAS as linhas do merchant em todos os meses (inclusive as
      // manualmente categorizadas de forma diferente). Comportamento intencional: "ensinar"
      // o app a partir de uma correcao. Para restringir, filtrar category_source <> 'manual'.
      if (applyAll) {
        const changed = applyOverridesToTransactions(db, row.merchant, category);
        setOverrideCategory(db, row.merchant, category);
        return sendJson(res, 200, { ok: true, id, category, applyAll, changes: changed });
      } else {
        const upd = db.prepare('UPDATE transactions SET category = ?, category_source = \'manual\' WHERE id = ?').run(category, id);
        return sendJson(res, 200, { ok: true, id, category, applyAll, changes: Number(upd.changes ?? 0) });
      }
    }

    if (url.pathname === '/api/ask' && req.method === 'POST') {
      const body = await readJson(req);
      return sendJson(res, 200, await answerQuestion(body));
    }

    if (url.pathname === '/api/export/proof' && req.method === 'POST') {
      const body = await readJson(req);
      const payload = await answerQuestion(body);
      const buffer = await buildProofPdf(payload);
      res.writeHead(200, {
        'content-type': 'application/pdf',
        'content-length': buffer.length,
        'content-disposition': 'attachment; filename="folha-de-prova.pdf"',
        'cache-control': 'no-store',
      });
      res.end(buffer);
      return;
    }

    if (url.pathname === '/api/import' && req.method === 'POST') {
      const body = await readJson(req, MAX_IMPORT_BODY);
      const content = typeof body.content === 'string' ? body.content : '';
      const base64 = typeof body.base64 === 'string' ? body.base64 : '';
      if (!content && !base64) throw new Error('envie {"filename": "...", "content": "<texto do arquivo>"} ou "base64" para PDF');
      const filename = typeof body.filename === 'string' ? body.filename.slice(0, 120) : '';
      let account = typeof body.account === 'string' && body.account.trim() ? body.account.trim() : 'principal';
      if (account.length > MAX_ACCOUNT_LENGTH) {
        throw new HttpError(400, `nome da conta longo demais (max ${MAX_ACCOUNT_LENGTH} caracteres)`);
      }
      account = account.replace(/[\u0000-\u001f\u007f]/g, '');
      if (!account) account = 'principal';
      if (account === 'principal' && filename) {
        const lower = filename.toLowerCase();
        if (lower.startsWith('nu_') || lower.includes('nubank')) account = 'nubank';
        else if (lower.includes('itau') || lower.includes('itaú')) account = 'itau';
        else if (lower.includes('inter')) account = 'inter';
        else if (lower.includes('bradesco')) account = 'bradesco';
        else if (lower.includes('santander')) account = 'santander';
        else if (lower.includes('caixa')) account = 'caixa';
        // arquivos sem banco reconhecido caem em 'principal' para nao fragmentar a conta
      }
      const result = base64 ? await importPdf(db, Buffer.from(base64, 'base64'), account) : importExtrato(db, content, account);
      // a partir de um arquivo reconhecido, deixa de usar dados ficticios. CSV
      // vazio ou binario aleatorio falham antes daqui e nao apagam a amostra.
      if (result.read > 0 || result.reportedBalanceCents !== null) {
        db.exec("DELETE FROM transactions WHERE source = 'sample'");
      }
      const transfers = detectInternalTransfers(db);
      const source = 'imported';
      // o recibo mostra o mes do arquivo importado, nao o mes corrente nem o de outro extrato
      const importedMonth = result.month;
      return sendJson(res, 200, {
        ...result,
        month: importedMonth,
        summary: summary(monthFromIso(importedMonth), source),
        sources: countBySource(db),
        transfers,
        accounts: distinctAccounts(db),
      });
    }

    if (url.pathname === '/api/reset' && req.method === 'POST') {
      const body = await readJson(req);
      const mode = typeof body.mode === 'string' ? body.mode : 'imported';
      if (mode === 'imported') {
        const removed = deleteImported(db);
        // reversivel: se nao sobrou nada, restaura a amostra ficticia
        if (countTransactions(db) === 0) {
          importExtrato(db, readFileSync(SAMPLE, 'utf8'), 'principal', 'sample');
        }
        return sendJson(res, 200, { removed, sources: countBySource(db), summary: summary(monthFromIso(currentMonth())), accounts: distinctAccounts(db) });
      }
      if (mode === 'sample') {
        db.exec('DELETE FROM transactions');
        const result = importExtrato(db, readFileSync(SAMPLE, 'utf8'), 'principal', 'sample');
        return sendJson(res, 200, { removed: result.inserted, sources: countBySource(db), summary: summary(monthFromIso(currentMonth())) });
      }
      const removed = countTransactions(db);
      db.exec('DELETE FROM transactions');
      return sendJson(res, 200, { removed, sources: countBySource(db), summary: summary(monthFromIso(currentMonth())) });
    }

    if (url.pathname === '/api/export/pdf' && req.method === 'GET') {
      const source = url.searchParams.get('source') ?? undefined;
      const account = url.searchParams.get('account') ?? undefined;
      const includeInternal = url.searchParams.get('includeInternal') === '1';
      // só aplica período quando a tela mandou um recorte: sem isso, o PDF continua cobrindo tudo
      const hasPeriod = Boolean(url.searchParams.get('from') || url.searchParams.get('to') || url.searchParams.get('month'));
      const period = hasPeriod ? periodFromQuery(url) : null;
      const buffer = await buildStatementPdf({
        source: source && source !== 'all' ? source : undefined,
        account,
        includeInternal,
        from: period?.from,
        to: period?.to,
      });
      res.writeHead(200, {
        'content-type': 'application/pdf',
        'content-length': buffer.length,
        'content-disposition': 'attachment; filename="super-extrato.pdf"',
        'cache-control': 'no-store',
      });
      res.end(buffer);
      return;
    }

    // Valida que uma spec crua (usada no modo "ver filtro") continua valida.
    if (url.pathname === '/api/spec-check' && req.method === 'POST') {
      return sendJson(res, 200, { spec: parseSpec(await readJson(req)) });
    }

    if (url.pathname.startsWith('/api/')) {
      return sendJson(res, 404, { error: 'rota inexistente' });
    }

    return await serveStatic(url.pathname, res);
  } catch (err) {
    if (err instanceof HttpError) {
      return sendJson(res, err.status, { error: err.message });
    }
    if (err instanceof OutOfScopeError) {
      return sendJson(res, 422, {
        error: 'Essa pergunta não parece ser sobre o extrato. Tente algo como "quanto gastei com mercado em outubro".',
      });
    }
    const message = err instanceof Error ? err.message : 'erro desconhecido';
    return sendJson(res, 400, { error: message });
  }
});

// escuta só em loopback: a API não tem autenticação e não deve ficar visível na rede local
server.listen(PORT, '127.0.0.1', () => {
  console.log(`api   http://127.0.0.1:${PORT}`);
  console.log(`planner: ${planner.name}`);
});
