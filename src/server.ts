import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { createHash, timingSafeEqual } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

import { openDb, countTransactions, countBySource, deleteImported, distinctAccounts, detectInternalTransfers, applyOverridesToTransactions, setOverrideCategory, upsertBudget, deleteBudget, markInternalTransfer, markRefund, type Db } from './db.ts';
import { importExtrato, importPdf } from './ingest/import.ts';
import { guessAccount } from './ingest/account.ts';
import { parseDateToISO } from './ingest/normalize.ts';
import { explainClassification } from './categorize/classify.ts';
import { compileSpec } from './query/compile.ts';
import { executeSpec } from './query/execute.ts';
import { renderAnswer } from './query/render.ts';
import { monthFromIso, shiftMonth } from './domain/dates.ts';
import { MAX_QUESTION_LENGTH, looksLikeInjection, sanitizeQuestion } from './domain/question.ts';
import { normalizeInvoiceMonth } from './domain/invoice.ts';
import { parseSpec, type QuerySpec } from './query/spec.ts';
import { applyEntityGuard } from './query/guard.ts';
import { isFollowUp, mergeFollowUp } from './query/context.ts';
import { heuristicPlanner, OutOfScopeError, type Planner } from './planner/fake.ts';
import { buildPlanner } from './planner/openai.ts';
import { loadEnvFile } from './env.ts';
import {
  budgetsForPeriod,
  comparePeriods,
  invoices,
  previousPeriod,
  summary,
  transactions,
  type Period,
} from './stats.ts';
import { buildProofPdf, buildStatementPdf, type AskPayload } from './export-pdf.ts';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
// Na Vercel o unico diretorio gravavel e /tmp (e ele nao sobrevive a um cold
// start): o banco vira uma demo efemera, semeada com o extrato de exemplo.
const EPHEMERAL = process.env.VERCEL === '1';
// EXTRATO_DB aponta o banco para outro arquivo (testes de API usam um temporario)
const DB_PATH = process.env.EXTRATO_DB ?? (EPHEMERAL ? '/tmp/extrato.db' : join(ROOT, 'data', 'extrato.db'));
const DIST = join(ROOT, 'web', 'dist');
const SAMPLE = join(ROOT, 'data', 'sample-extrato.csv');
// PORT=0 ou vazio cai no padrao: o vite faz proxy de /api para 8787, entao porta aleatoria quebraria a UI
const PORT = Number(process.env.PORT) || 8787;
// import carrega base64 (+33%) de um PDF de ate 8 MB; as demais rotas so
// recebem JSON pequeno (pergunta, spec, modo do reset)
const MAX_IMPORT_BODY = 12 * 1024 * 1024;
const MAX_JSON_BODY = 256 * 1024;
const MAX_ACCOUNT_LENGTH = 40;

/**
 * Senha opcional para deploy público. Localmente fica desligada (a API escuta
 * só em loopback); no container ela evita que qualquer visitante leia o extrato.
 * O navegador mostra o prompt nativo do HTTP Basic.
 */
const AUTH_USER = process.env.APP_USER?.trim() || 'extrato';
const AUTH_PASSWORD = process.env.APP_PASSWORD ?? '';
const AUTH_ENABLED = AUTH_PASSWORD.length > 0;

function safeEqual(a: string, b: string): boolean {
  // hash antes de comparar: timingSafeEqual exige o mesmo tamanho
  const left = createHash('sha256').update(a).digest();
  const right = createHash('sha256').update(b).digest();
  return timingSafeEqual(left, right);
}

function authorized(req: IncomingMessage): boolean {
  if (!AUTH_ENABLED) return true;
  const header = req.headers.authorization ?? '';
  if (!header.startsWith('Basic ')) return false;
  const decoded = Buffer.from(header.slice(6), 'base64').toString('utf8');
  const colon = decoded.indexOf(':');
  if (colon < 0) return false;
  return safeEqual(decoded.slice(0, colon), AUTH_USER) && safeEqual(decoded.slice(colon + 1), AUTH_PASSWORD);
}

/**
 * Modo dono: quando OWNER_KEY esta definido, o deploy e uma demo publica
 * somente leitura. Quem abrir o site com `?chave=<OWNER_KEY>` troca a chave por
 * um cookie e passa a importar/editar; visitante comum nunca escreve.
 * Sem OWNER_KEY (uso local), todo mundo e dono.
 */
const OWNER_KEY = (process.env.OWNER_KEY ?? '').trim();
const OWNER_ENABLED = OWNER_KEY.length >= 8;
const OWNER_COOKIE = 'extrato_owner';
const OWNER_TOKEN = OWNER_ENABLED ? createHash('sha256').update(OWNER_KEY).digest('hex') : '';

function cookieValue(req: IncomingMessage, name: string): string {
  for (const part of (req.headers.cookie ?? '').split(';')) {
    const index = part.indexOf('=');
    if (index > 0 && part.slice(0, index).trim() === name) {
      return decodeURIComponent(part.slice(index + 1).trim());
    }
  }
  return '';
}

function isOwner(req: IncomingMessage): boolean {
  if (!OWNER_ENABLED) return true;
  return safeEqual(cookieValue(req, OWNER_COOKIE), OWNER_TOKEN);
}

// POST tambem serve leitura (consulta e PDFs de prova); o resto que nao e GET
// grava no banco e so o dono pode.
const READ_ONLY_POST = new Set(['/api/ask', '/api/export/proof', '/api/spec-check']);

function isMutation(method: string | undefined, pathname: string): boolean {
  if (!method || method === 'GET' || method === 'HEAD' || method === 'OPTIONS') return false;
  return !READ_ONLY_POST.has(pathname);
}
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

/**
 * Domínios públicos aceitos além do loopback (deploy atrás do proxy: o Host
 * chega como `app.onrender.com`). Vazio = só loopback, como no uso local.
 */
// A Vercel expoe a URL do deploy em variaveis de ambiente: sem elas o Host do
// proprio dominio seria recusado pelo guard de DNS rebinding.
const PLATFORM_HOSTS = [
  process.env.VERCEL_URL,
  process.env.VERCEL_BRANCH_URL,
  process.env.VERCEL_PROJECT_PRODUCTION_URL,
]
  .filter((host): host is string => Boolean(host))
  .map((host) => host.toLowerCase());

const PUBLIC_HOSTS = new Set(
  [...PLATFORM_HOSTS, ...(process.env.PUBLIC_HOSTS ?? '').split(',')]
    .map((host) => host.trim().toLowerCase())
    .filter(Boolean),
);

/** Host/Origin de loopback: `localhost:5173`, `127.0.0.1:8787`, `[::1]:1`. */
function allowedHost(value: string): boolean {
  const hostname = hostnameOf(value);
  if (!hostname) return false;
  const bare = hostname.replace(/^\[|\]$/g, '');
  return LOOPBACK_HOSTS.has(bare) || bare.endsWith('.localhost') || PUBLIC_HOSTS.has(bare);
}

loadEnvFile(join(ROOT, '.env'));

const planner: Planner = buildPlanner();
const db: Db = openDb(DB_PATH);

if (countTransactions(db) === 0) {
  try {
    const result = importExtrato(db, readFileSync(SAMPLE, 'utf8'), 'principal', 'sample');
    console.log(`seed: ${result.inserted} lancamentos de exemplo importados`);
  } catch (error) {
    // a amostra vai junto da funcao (ver includeFiles no vercel.json); se o
    // arquivo faltar, a demo abre vazia em vez de derrubar o handler inteiro
    console.warn(`seed indisponivel em ${SAMPLE}:`, error instanceof Error ? error.message : error);
  }
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

/** `invoice=2026-10` (ou `outubro de 2026`) → "2026-10"; inválido é erro 400. */
function invoiceMonthParam(url: URL): string | undefined {
  const raw = url.searchParams.get('invoice');
  if (!raw) return undefined;
  const month = normalizeInvoiceMonth(raw);
  if (!month) throw new HttpError(400, 'fatura invalida (use YYYY-MM)');
  return month;
}

function compareScope(url: URL): { period: Period; previous: Period } {  if (url.searchParams.get('from') || url.searchParams.get('to')) {
    const period = strictPeriod(url);
    return { period, previous: previousPeriod(period) };
  }
  const month = url.searchParams.get('month') ?? currentMonth();
  if (!validMonth(month)) throw new HttpError(400, 'mes invalido (use YYYY-MM)');
  // mês compara com o mês fechado anterior, não com "30 dias antes"
  return { period: monthFromIso(month), previous: monthFromIso(shiftMonth(month, -1).from.slice(0, 7)) };
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
  if (typeof body.invoice === 'string' && body.invoice) {
    const invoice = normalizeInvoiceMonth(body.invoice);
    if (!invoice) throw new Error('fatura invalida: use o mes no formato aaaa-mm');
    spec.filters.invoice = invoice;
  }
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

/**
 * Handler compartilhado entre o servidor local (`npm start`) e a funcao
 * serverless da Vercel (`api/index.mjs`). Nao sobe porta sozinho: quem decide
 * e o bloco de main no fim do arquivo.
 */
export async function handler(req: IncomingMessage, res: ServerResponse): Promise<void> {
  for (const [name, value] of Object.entries(SECURITY_HEADERS)) res.setHeader(name, value);

  try {
    // DNS rebinding: um site externo que resolve para 127.0.0.1 chega aqui com
    // o Host do dominio dele. A API so atende loopback (ou o dominio declarado
    // em PUBLIC_HOSTS, quando roda atras do proxy do deploy).
    if (req.headers.host && !allowedHost(req.headers.host)) {
      throw new HttpError(403, 'host nao permitido: a API so atende loopback');
    }
    if (req.method === 'POST' && req.headers.origin !== undefined && !allowedHost(req.headers.origin)) {
      throw new HttpError(403, 'origem nao permitida');
    }

    const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);

    // ?chave=OWNER_KEY vira cookie e sai da URL: depois do primeiro acesso o
    // segredo nao fica no historico do navegador nem no Referer.
    const key = url.searchParams.get('chave');
    if (OWNER_ENABLED && key !== null) {
      if (!safeEqual(key, OWNER_KEY)) throw new HttpError(403, 'chave do dono invalida');
      url.searchParams.delete('chave');
      const proto = String(req.headers['x-forwarded-proto'] ?? '').toLowerCase();
      res.setHeader(
        'set-cookie',
        `${OWNER_COOKIE}=${OWNER_TOKEN}; Path=/; HttpOnly; SameSite=Lax; Max-Age=2592000${proto === 'https' ? '; Secure' : ''}`,
      );
      res.writeHead(303, { location: `${url.pathname}${url.search}` });
      res.end();
      return;
    }

    // demo publica: visitante le tudo, mas so o dono importa/edita
    if (OWNER_ENABLED && !isOwner(req) && isMutation(req.method, url.pathname)) {
      throw new HttpError(403, 'demo somente leitura: importar e editar ficam no modo dono (abra o link com ?chave=...)');
    }

    // health fica aberto para o health check da plataforma (e sem detalhes
    // quando há senha); todo o resto exige a credencial
    if (!authorized(req) && url.pathname !== '/api/health') {
      res.setHeader('www-authenticate', 'Basic realm="extrato", charset="UTF-8"');
      res.writeHead(401, { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' });
      res.end('autenticacao necessaria');
      return;
    }

    if (url.pathname === '/api/health') {
      // a Vercel corta o corpo em ~4,5 MB: o PDF em base64 nao pode passar de ~3 MB
      const limits = { maxUploadBytes: EPHEMERAL ? 3 * 1024 * 1024 : null };
      const access = { ownerMode: OWNER_ENABLED, readOnly: OWNER_ENABLED && !isOwner(req) };
      if (AUTH_ENABLED) return sendJson(res, 200, { ok: true, ephemeral: EPHEMERAL, limits, ...access });
      return sendJson(res, 200, { ok: true, ephemeral: EPHEMERAL, limits, ...access, planner: planner.name, transactions: countTransactions(db), sources: countBySource(db), accounts: distinctAccounts(db) });
    }

    if (url.pathname === '/api/summary' && req.method === 'GET') {
      const source = url.searchParams.get('source') ?? undefined;
      const account = url.searchParams.get('account') ?? undefined;
      const includeInternal = url.searchParams.get('includeInternal') === '1';
      return sendJson(res, 200, summary(db, periodFromQuery(url), planner.name, source && source !== 'all' ? source : undefined, account, includeInternal, invoiceMonthParam(url)));
    }

    if (url.pathname === '/api/invoices' && req.method === 'GET') {
      const source = url.searchParams.get('source') ?? undefined;
      const account = url.searchParams.get('account') ?? undefined;
      return sendJson(res, 200, {
        items: invoices(db, source && source !== 'all' ? source : undefined, account ?? undefined),
      });
    }

    if (url.pathname === '/api/compare' && req.method === 'GET') {
      const { period, previous } = compareScope(url);
      const source = url.searchParams.get('source') ?? undefined;
      const account = url.searchParams.get('account') ?? undefined;
      const includeInternal = url.searchParams.get('includeInternal') === '1';
      return sendJson(res, 200, comparePeriods(db, period, previous, source && source !== 'all' ? source : undefined, account, includeInternal));
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
        items: budgetsForPeriod(db, period, source && source !== 'all' ? source : undefined, account, includeInternal),
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
        items: transactions(db, period, limit, source && source !== 'all' ? source : undefined, account, includeInternal, invoiceMonthParam(url)),
      });
    }

    const recatMatch = url.pathname.match(/^\/api\/transactions\/([^/]+)$/);
    const explainMatch = url.pathname.match(/^\/api\/transactions\/([^/]+)\/explain$/);
    if (explainMatch && req.method === 'GET') {
      const id = decodeURIComponent(explainMatch[1] ?? '');
      if (!id) throw new HttpError(400, 'id obrigatorio');
      const row = db.prepare('SELECT description, merchant, category, category_source FROM transactions WHERE id = ?').get(id) as
        | { description: string; merchant: string; category: string; category_source: string }
        | undefined;
      if (!row) throw new HttpError(404, 'lancamento nao encontrado');
      const explanation = explainClassification(row.description, row.merchant);
      const reason = row.category_source === 'manual'
        ? `correção manual (categoria fixada em "${row.category}")`
        : explanation.reason;
      return sendJson(res, 200, {
        id,
        category: row.category,
        source: row.category_source,
        reason,
      });
    }
    if (recatMatch && req.method === 'PATCH') {
      const id = decodeURIComponent(recatMatch[1] ?? '');
      if (!id) throw new HttpError(400, 'id obrigatorio');
      const body = await readJson(req);
      const category = typeof body.category === 'string' ? body.category : '';
      const applyAll = body.applyAll === true;
      const internalTransfer = typeof body.internalTransfer === 'boolean' ? body.internalTransfer : null;
      const refund = typeof body.refund === 'boolean' ? body.refund : null;
      if (internalTransfer !== null) {
        const ok = markInternalTransfer(db, id, internalTransfer);
        if (!ok) throw new HttpError(404, 'lancamento nao encontrado');
        return sendJson(res, 200, { ok: true, id, internalTransfer });
      }
      if (refund !== null) {
        const ok = markRefund(db, id, refund);
        if (!ok) throw new HttpError(404, 'lancamento nao encontrado');
        return sendJson(res, 200, { ok: true, id, refund });
      }
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
      const explicit = typeof body.account === 'string' ? body.account.trim() : '';
      if (explicit.length > MAX_ACCOUNT_LENGTH) {
        throw new HttpError(400, `nome da conta longo demais (max ${MAX_ACCOUNT_LENGTH} caracteres)`);
      }
      // ordem: escolha da pessoa > assinatura do conteúdo/nome > 'principal'.
      // Sem isso, CSV de bancos diferentes virava tudo 'principal' e a
      // transferência interna (que exige contas diferentes) nunca era achada.
      const guess = base64 ? null : guessAccount(filename, content);
      let account = explicit || guess?.account || 'principal';
      account = account.replace(/[\u0000-\u001f\u007f]/g, '');
      if (!account) account = 'principal';

      // fatura de cartão: mês explícito ou detecção pelo texto do próprio arquivo.
      // 'kind' existe para forçar quando o arquivo não se anuncia.
      const kind = body.kind === 'card' ? 'card' : body.kind === 'account' ? 'account' : undefined;
      const invoiceMonth = typeof body.invoiceMonth === 'string' && body.invoiceMonth.trim()
        ? normalizeInvoiceMonth(body.invoiceMonth)
        : null;
      if (body.invoiceMonth && !invoiceMonth) {
        throw new HttpError(400, 'mês da fatura inválido (use YYYY-MM ou MM/AAAA)');
      }
      const result = base64
        ? await importPdf(db, Buffer.from(base64, 'base64'), account, 'imported', { kind, invoiceMonth })
        : importExtrato(db, content, account, 'imported', { kind, invoiceMonth });
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
        summary: summary(db, monthFromIso(importedMonth), planner.name, source),
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
        return sendJson(res, 200, { removed, sources: countBySource(db), summary: summary(db, monthFromIso(currentMonth()), planner.name), accounts: distinctAccounts(db) });
      }
      if (mode === 'sample') {
        db.exec('DELETE FROM transactions');
        const result = importExtrato(db, readFileSync(SAMPLE, 'utf8'), 'principal', 'sample');
        return sendJson(res, 200, { removed: result.inserted, sources: countBySource(db), summary: summary(db, monthFromIso(currentMonth()), planner.name) });
      }
      const removed = countTransactions(db);
      db.exec('DELETE FROM transactions');
      return sendJson(res, 200, { removed, sources: countBySource(db), summary: summary(db, monthFromIso(currentMonth()), planner.name) });
    }

    if (url.pathname === '/api/export/pdf' && req.method === 'GET') {
      const source = url.searchParams.get('source') ?? undefined;
      const account = url.searchParams.get('account') ?? undefined;
      const includeInternal = url.searchParams.get('includeInternal') === '1';
      // só aplica período quando a tela mandou um recorte: sem isso, o PDF continua cobrindo tudo
      const hasPeriod = Boolean(url.searchParams.get('from') || url.searchParams.get('to') || url.searchParams.get('month'));
      const period = hasPeriod ? periodFromQuery(url) : null;
      const buffer = await buildStatementPdf(db, {
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
}

// `node src/server.ts` sobe o servidor; importado por uma funcao serverless,
// apenas exporta o handler (nada de porta aberta).
const isMain =
  !EPHEMERAL && process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMain) {
  // em container o proxy precisa alcançar: HOST=0.0.0.0. Local continua loopback.
  const HOST = process.env.HOST || '127.0.0.1';
  createServer(handler).listen(PORT, HOST, () => {
    console.log(`api   http://${HOST}:${PORT}`);
    console.log(`planner: ${planner.name}${EPHEMERAL ? ' · demo efemera (/tmp)' : ''}`);
  });
}
