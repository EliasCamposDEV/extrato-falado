import { randomUUID } from 'node:crypto';
import type { Db } from './db.ts';
import type { Scope } from './privacy.ts';

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
  createdAt: string;
  updatedAt: string;
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
  createdAt: string;
}

export interface ManualInput {
  amount: number; // centavos, positivo
  direction?: 'in' | 'out';
  postedAt: string;
  category: string;
  description?: string;
  tags?: string[];
  account?: string;
  recurringTemplateId?: string | null;
}

export interface RecurringInput {
  amount: number;
  direction?: 'in' | 'out';
  category: string;
  description?: string;
  frequency: 'weekly' | 'monthly';
  dayOfMonth?: number | null;
  weekday?: number | null;
  startDate: string;
  endDate?: string | null;
  active?: boolean;
}

export interface ManualFilters {
  from?: string;
  to?: string;
  month?: string;
  category?: string;
  tag?: string;
  direction?: 'in' | 'out';
  account?: string;
  limit?: number;
  offset?: number;
}

/** NULL compara com NULL: fora da demo as linhas antigas continuam visíveis. */
function scopeSql(scope: Scope): { sql: string; hash: string | null } {
  return { sql: 'session_hash IS ?', hash: scope.sessionHash ?? null };
}

const MAX_TAGS = 20;
const MAX_TAG_LEN = 40;
const MAX_DESC = 200;
const MAX_CAT = 60;

function validateDate(s: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s));
}

function validateManual(input: ManualInput): void {
  if (!Number.isInteger(input.amount) || input.amount <= 0) throw new Error('amount deve ser inteiro positivo (centavos)');
  if (input.direction && input.direction !== 'in' && input.direction !== 'out') throw new Error('direction inválida');
  if (!validateDate(input.postedAt)) throw new Error('postedAt inválida (aaaa-mm-dd)');
  if (!input.category || input.category.length > MAX_CAT) throw new Error('category inválida');
  if (input.description && input.description.length > MAX_DESC) throw new Error('description muito longa');
  if (input.tags) {
    if (!Array.isArray(input.tags) || input.tags.length > MAX_TAGS) throw new Error('tags inválidas');
    for (const t of input.tags) {
      if (typeof t !== 'string' || t.length === 0 || t.length > MAX_TAG_LEN) throw new Error('tag inválida');
    }
  }
  if (input.account && input.account.length > 60) throw new Error('account inválida');
}

function rowToManual(r: any): ManualEntry {
  let tags: string[] = [];
  try { tags = JSON.parse(r.tags ?? '[]'); } catch { tags = []; }
  return {
    id: String(r.id),
    amountCents: Number(r.amount_cents),
    direction: r.direction === 'in' ? 'in' : 'out',
    postedAt: String(r.posted_at),
    category: String(r.category),
    description: String(r.description ?? ''),
    tags,
    account: String(r.account ?? 'principal'),
    recurringTemplateId: r.recurring_template_id == null ? null : String(r.recurring_template_id),
    createdAt: String(r.created_at),
    updatedAt: String(r.updated_at),
  };
}

function rowToTemplate(r: any): RecurringTemplate {
  return {
    id: String(r.id),
    amountCents: Number(r.amount_cents),
    direction: r.direction === 'in' ? 'in' : 'out',
    category: String(r.category),
    description: String(r.description ?? ''),
    frequency: r.frequency === 'weekly' ? 'weekly' : 'monthly',
    dayOfMonth: r.day_of_month == null ? null : Number(r.day_of_month),
    weekday: r.weekday == null ? null : Number(r.weekday),
    startDate: String(r.start_date),
    endDate: r.end_date == null ? null : String(r.end_date),
    active: Number(r.active) === 1,
    createdAt: String(r.created_at),
  };
}

export function createManualEntry(db: Db, input: ManualInput, scope: Scope = {}): ManualEntry {
  validateManual(input);
  const id = `manual-${randomUUID()}`;
  const direction = input.direction ?? 'out';
  const tags = input.tags ?? [];
  const account = input.account ?? 'principal';
  const now = new Date().toISOString();
  db.prepare(`INSERT INTO manual_entries
    (id, amount_cents, direction, posted_at, category, description, tags, account, recurring_template_id, session_hash, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
    id, input.amount, direction, input.postedAt, input.category, input.description ?? '', JSON.stringify(tags),
    account, input.recurringTemplateId ?? null, scope.sessionHash ?? null, now, now,
  );
  const row = db.prepare('SELECT * FROM manual_entries WHERE id = ?').get(id);
  return rowToManual(row);
}

export function getManualEntry(db: Db, id: string, scope: Scope = {}): ManualEntry | null {
  const scoped = scopeSql(scope);
  const row = db.prepare(`SELECT * FROM manual_entries WHERE id = ? AND ${scoped.sql}`).get(id, scoped.hash);
  return row ? rowToManual(row) : null;
}

export function listManualEntries(db: Db, filters: ManualFilters = {}, scope: Scope = {}): ManualEntry[] {
  const scoped = scopeSql(scope);
  const where: string[] = [scoped.sql];
  const params: unknown[] = [scoped.hash];
  if (filters.from) { where.push('posted_at >= ?'); params.push(filters.from); }
  if (filters.to) { where.push('posted_at <= ?'); params.push(filters.to); }
  if (filters.month) { where.push("substr(posted_at,1,7) = ?"); params.push(filters.month); }
  if (filters.category) { where.push('category = ?'); params.push(filters.category); }
  if (filters.direction) { where.push('direction = ?'); params.push(filters.direction); }
  if (filters.account) { where.push('account = ?'); params.push(filters.account); }
  if (filters.tag) {
    where.push("EXISTS (SELECT 1 FROM json_each(tags) WHERE value = ?)");
    params.push(filters.tag);
  }
  const sql = `SELECT * FROM manual_entries ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY posted_at DESC, id DESC`;
  // o teto publico de 500 e aplicado na rota /api/manual; totalizadores internos pedem 100000
  const limit = Math.min(Math.max(filters.limit ?? 200, 1), 100000);
  const offset = Math.max(filters.offset ?? 0, 0);
  const rows = (db.prepare(`${sql} LIMIT ? OFFSET ?`) as any).all(...params, limit, offset) as any[];
  return rows.map(rowToManual);
}

export function updateManualEntry(db: Db, id: string, patch: Partial<ManualInput>, scope: Scope = {}): ManualEntry | null {
  const existing = getManualEntry(db, id, scope);
  if (!existing) return null;
  const merged: ManualInput = {
    amount: patch.amount ?? existing.amountCents,
    direction: (patch.direction ?? existing.direction ?? 'out') as 'in' | 'out',
    postedAt: patch.postedAt ?? existing.postedAt,
    category: patch.category ?? existing.category,
    description: patch.description ?? existing.description,
    tags: patch.tags ?? existing.tags,
    account: patch.account ?? existing.account,
    recurringTemplateId: patch.recurringTemplateId ?? existing.recurringTemplateId,
  };
  validateManual(merged);
  const now = new Date().toISOString();
  (db.prepare(`UPDATE manual_entries SET amount_cents=?, direction=?, posted_at=?, category=?, description=?, tags=?, account=?, recurring_template_id=?, updated_at=? WHERE id=?`) as any).run(
    merged.amount, merged.direction, merged.postedAt, merged.category, merged.description ?? '', JSON.stringify(merged.tags ?? []), merged.account ?? 'principal', merged.recurringTemplateId ?? null, now, id,
  );
  return getManualEntry(db, id, scope);
}

export function deleteManualEntry(db: Db, id: string, scope: Scope = {}): boolean {
  const scoped = scopeSql(scope);
  const res = db.prepare(`DELETE FROM manual_entries WHERE id = ? AND ${scoped.sql}`).run(id, scoped.hash);
  return Number(res.changes ?? 0) > 0;
}

// ---- Recurring templates ----

function validateRecurring(input: RecurringInput): void {
  if (!Number.isInteger(input.amount) || input.amount <= 0) throw new Error('amount deve ser inteiro positivo (centavos)');
  if (input.direction && input.direction !== 'in' && input.direction !== 'out') throw new Error('direction inválida');
  if (!input.category || input.category.length > MAX_CAT) throw new Error('category inválida');
  if (input.description && input.description.length > MAX_DESC) throw new Error('description muito longa');
  if (input.frequency !== 'weekly' && input.frequency !== 'monthly') throw new Error('frequency inválida');
  if (!validateDate(input.startDate)) throw new Error('startDate inválida');
  if (input.endDate && !validateDate(input.endDate)) throw new Error('endDate inválida');
  if (input.frequency === 'monthly' && (input.dayOfMonth == null || input.dayOfMonth < 1 || input.dayOfMonth > 31)) throw new Error('dayOfMonth inválido');
  if (input.frequency === 'weekly' && (input.weekday == null || input.weekday < 0 || input.weekday > 6)) throw new Error('weekday inválido');
}

export function createRecurringTemplate(db: Db, input: RecurringInput, scope: Scope = {}): RecurringTemplate {
  validateRecurring(input);
  const id = `rec-${randomUUID()}`;
  const direction = input.direction ?? 'out';
  const now = new Date().toISOString();
  db.prepare(`INSERT INTO recurring_templates
    (id, amount_cents, direction, category, description, frequency, day_of_month, weekday, start_date, end_date, active, session_hash, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
    id, input.amount, direction, input.category, input.description ?? '', input.frequency,
    input.dayOfMonth ?? null, input.weekday ?? null, input.startDate, input.endDate ?? null,
    input.active === false ? 0 : 1, scope.sessionHash ?? null, now,
  );
  const row = db.prepare('SELECT * FROM recurring_templates WHERE id = ?').get(id);
  return rowToTemplate(row);
}

export function getRecurringTemplate(db: Db, id: string, scope: Scope = {}): RecurringTemplate | null {
  const scoped = scopeSql(scope);
  const row = db.prepare(`SELECT * FROM recurring_templates WHERE id = ? AND ${scoped.sql}`).get(id, scoped.hash);
  return row ? rowToTemplate(row) : null;
}

export function listRecurringTemplates(db: Db, activeOnly = false, scope: Scope = {}): RecurringTemplate[] {
  const scoped = scopeSql(scope);
  const active = activeOnly ? 'active = 1 AND ' : '';
  const rows = db.prepare(`SELECT * FROM recurring_templates WHERE ${active}${scoped.sql} ORDER BY created_at DESC`)
    .all(scoped.hash) as any[];
  return rows.map(rowToTemplate);
}

export function updateRecurringTemplate(db: Db, id: string, patch: Partial<RecurringInput & { active?: boolean }>, scope: Scope = {}): RecurringTemplate | null {
  const existing = getRecurringTemplate(db, id, scope);
  if (!existing) return null;
  const merged: RecurringInput = {
    amount: patch.amount ?? existing.amountCents,
    direction: (patch.direction ?? existing.direction ?? 'out') as 'in' | 'out',
    category: patch.category ?? existing.category,
    description: patch.description ?? existing.description,
    frequency: patch.frequency ?? existing.frequency,
    dayOfMonth: patch.dayOfMonth ?? existing.dayOfMonth,
    weekday: patch.weekday ?? existing.weekday,
    startDate: patch.startDate ?? existing.startDate,
    endDate: patch.endDate ?? existing.endDate,
    active: patch.active ?? existing.active,
  };
  validateRecurring(merged);
  (db.prepare(`UPDATE recurring_templates SET amount_cents=?, direction=?, category=?, description=?, frequency=?, day_of_month=?, weekday=?, start_date=?, end_date=?, active=? WHERE id=?`) as any).run(
    merged.amount, merged.direction, merged.category, merged.description ?? '', merged.frequency,
    merged.dayOfMonth ?? null, merged.weekday ?? null, merged.startDate, merged.endDate ?? null,
    merged.active === false ? 0 : 1, id,
  );
  return getRecurringTemplate(db, id, scope);
}

export function deleteRecurringTemplate(db: Db, id: string, scope: Scope = {}): boolean {
  const scoped = scopeSql(scope);
  const res = db.prepare(`DELETE FROM recurring_templates WHERE id = ? AND ${scoped.sql}`).run(id, scoped.hash);
  return Number(res.changes ?? 0) > 0;
}

// ---- Virtual entries from recurring templates ----

function daysInMonth(y: number, m: number): number {
  return new Date(y, m, 0).getDate();
}

function clampDay(y: number, m: number, day: number): number {
  return Math.min(day, daysInMonth(y, m));
}

function weeklyDates(start: string, end: string | null, weekday: number): string[] {
  const out: string[] = [];
  const s = new Date(start + 'T00:00:00');
  const e = end ? new Date(end + 'T00:00:00') : null;
  // find first date >= start with given weekday
  const cur = new Date(s);
  while (cur.getDay() !== weekday) cur.setDate(cur.getDate() + 1);
  while (true) {
    if (e && cur > e) break;
    const iso = cur.toISOString().slice(0, 10);
    if (iso >= start) out.push(iso);
    cur.setDate(cur.getDate() + 7);
    if (out.length > 53) break;
  }
  return out;
}

function monthlyDates(start: string, end: string | null, dayOfMonth: number): string[] {
  const out: string[] = [];
  const s = new Date(start + 'T00:00:00');
  const e = end ? new Date(end + 'T00:00:00') : null;
  let y = s.getFullYear();
  let m = s.getMonth() + 1;
  const endY = e ? e.getFullYear() : y + 5;
  const endM = e ? e.getMonth() + 1 : 12;
  while (y < endY || (y === endY && m <= endM)) {
    const day = clampDay(y, m, dayOfMonth);
    const iso = `${y}-${String(m).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    if (iso >= start && (!e || iso <= (e as Date).toISOString().slice(0, 10))) out.push(iso);
    m++;
    if (m > 12) { m = 1; y++; }
    if (out.length > 62) break;
  }
  return out;
}

export function virtualEntriesForMonth(db: Db, month: string, scope: Scope = {}): ManualEntry[] {
  // month: aaaa-mm
  const templates = listRecurringTemplates(db, true, scope);
  const parts = month.split('-').map(Number);
  const y = parts[0]!;
  const m = parts[1]!;
  const monthStart = `${month}-01`;
  const monthEnd = `${month}-${String(new Date(y, m, 0).getDate()).padStart(2, '0')}`;
  const out: ManualEntry[] = [];
  // existing manual entries linked to templates in this month (to avoid dup), por data
  const scoped = scopeSql(scope);
  const linked = new Set(
    (db.prepare(`SELECT recurring_template_id, posted_at FROM manual_entries WHERE substr(posted_at,1,7) = ? AND recurring_template_id IS NOT NULL AND ${scoped.sql}`)
      .all(month, scoped.hash) as any[])
      .map((r) => `${String(r.recurring_template_id)}|${String(r.posted_at)}`),
  );
  for (const t of templates) {
    if (t.startDate > monthEnd || (t.endDate && t.endDate < monthStart)) continue;
    const dates = t.frequency === 'weekly'
      ? weeklyDates(t.startDate, t.endDate, t.weekday ?? 0)
      : monthlyDates(t.startDate, t.endDate, t.dayOfMonth ?? 1);
    for (const d of dates) {
      if (d.slice(0, 7) !== month) continue;
      if (linked.has(`${t.id}|${d}`)) continue; // materialized already
      out.push({
        id: `virtual-${t.id}-${d}`,
        amountCents: t.amountCents,
        direction: t.direction,
        postedAt: d,
        category: t.category,
        description: t.description,
        tags: ['recorrente'],
        account: 'principal',
        recurringTemplateId: t.id,
        createdAt: t.createdAt,
        updatedAt: t.createdAt,
      });
    }
  }
  return out;
}

export function virtualEntriesForPeriod(db: Db, from: string, to: string, scope: Scope = {}): ManualEntry[] {
  // Itera apenas sobre os meses que os templates recorrentes realmente cobrem,
  // em vez de todos os meses entre from/to (que pode ser anos).
  const fromMonth = from.slice(0, 7);
  const toMonth = to.slice(0, 7);
  const months = new Set<string>();
  const templates = listRecurringTemplates(db, true, scope);
  for (const t of templates) {
    // compara meses com meses: startDate/endDate são datas completas
    const start = t.startDate.slice(0, 7) > fromMonth ? t.startDate.slice(0, 7) : fromMonth;
    const end = (t.endDate && t.endDate.slice(0, 7) < toMonth) ? t.endDate.slice(0, 7) : toMonth;
    if (start > end) continue;
    let y = Number(start.slice(0, 4));
    let m = Number(start.slice(5, 7));
    const endY = Number(end.slice(0, 4));
    const endM = Number(end.slice(5, 7));
    let guard = 0;
    while ((y < endY || (y === endY && m <= endM)) && guard < 240) {
      months.add(`${y}-${String(m).padStart(2, '0')}`);
      m++;
      if (m > 12) { m = 1; y++; }
      guard++;
    }
  }
  // inclui meses que ja tem lancamentos manuais vinculados
  const scoped = scopeSql(scope);
  const manualRows = db.prepare(`SELECT DISTINCT substr(posted_at,1,7) AS m FROM manual_entries WHERE ${scoped.sql}`)
    .all(scoped.hash) as { m: string }[];
  for (const r of manualRows) {
    const mm = String(r.m);
    if (mm >= fromMonth && mm <= toMonth) months.add(mm);
  }
  const out: ManualEntry[] = [];
  for (const mo of [...months].sort()) out.push(...virtualEntriesForMonth(db, mo, scope));
  return out.filter((e) => e.postedAt >= from && e.postedAt <= to);
}

export function manualTotalsAndCategories(db: Db, from: string, to: string, scope: Scope = {}): {
  outCents: number; inCents: number; count: number;
  categories: { label: string; totalCents: number; count: number }[];
  allCategories: string[];
} {
  const real = listManualEntries(db, { from, to, limit: 100000 }, scope);
  const virtuals = virtualEntriesForPeriod(db, from, to, scope);
  const all = [...real, ...virtuals];
  let outCents = 0, inCents = 0;
  const catMap = new Map<string, { total: number; count: number }>();
  const catSet = new Set<string>();
  for (const e of all) {
    if (e.direction === 'out') outCents += e.amountCents;
    else inCents += e.amountCents;
    catSet.add(e.category);
    const cur = catMap.get(e.category) ?? { total: 0, count: 0 };
    cur.total += e.amountCents;
    cur.count += 1;
    catMap.set(e.category, cur);
  }
  const categories = [...catMap.entries()]
    .map(([label, v]) => ({ label, totalCents: v.total, count: v.count }))
    .sort((a, b) => b.totalCents - a.totalCents);
  return { outCents, inCents, count: all.length, categories, allCategories: [...catSet].sort() };
}

export interface ManualSummary {
  outCents: number;
  inCents: number;
  count: number;
  categories: { label: string; totalCents: number; count: number }[];
  months: string[];
  allCategories: string[];
}

export function manualSummary(db: Db, month?: string, scope: Scope = {}): ManualSummary {
  const from = month ? `${month}-01` : '0000-01-01';
  const to = month ? `${month}-${String(new Date(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0).getDate()).padStart(2, '0')}` : '9999-12-31';
  const real = listManualEntries(db, { from, to, limit: 100000 }, scope);
  const virtuals = month ? virtualEntriesForMonth(db, month, scope) : virtualEntriesForPeriod(db, from, to, scope);
  const all = [...real, ...virtuals];
  let outCents = 0, inCents = 0;
  const catMap = new Map<string, { total: number; count: number }>();
  const monthSet = new Set<string>();
  const catSet = new Set<string>();
  for (const e of all) {
    if (e.direction === 'out') outCents += e.amountCents;
    else inCents += e.amountCents;
    catSet.add(e.category);
    const cur = catMap.get(e.category) ?? { total: 0, count: 0 };
    cur.total += e.amountCents;
    cur.count += 1;
    catMap.set(e.category, cur);
    monthSet.add(e.postedAt.slice(0, 7));
  }
  const categories = [...catMap.entries()]
    .map(([label, v]) => ({ label, totalCents: v.total, count: v.count }))
    .sort((a, b) => Math.abs(b.totalCents) - Math.abs(a.totalCents));
  return { outCents, inCents, count: all.length, categories, months: [...monthSet].sort(), allCategories: [...catSet].sort() };
}

export function listManualWithVirtual(db: Db, filters: ManualFilters = {}, scope: Scope = {}): ManualEntry[] {
  // busca todos os reais antes de paginar: o recorte final acontece depois de juntar os virtuais
  const real = listManualEntries(db, { ...filters, limit: 100000, offset: 0 }, scope);
  const virtuals = filters.month
    ? virtualEntriesForMonth(db, filters.month, scope)
    : virtualEntriesForPeriod(db, filters.from ?? '0000-01-01', filters.to ?? '9999-12-31', scope);
  let v = virtuals;
  if (filters.month) v = v.filter((e) => e.postedAt.slice(0, 7) === filters.month);
  if (filters.from) v = v.filter((e) => e.postedAt >= filters.from!);
  if (filters.to) v = v.filter((e) => e.postedAt <= filters.to!);
  if (filters.category) v = v.filter((e) => e.category === filters.category);
  if (filters.direction) v = v.filter((e) => e.direction === filters.direction);
  if (filters.account) v = v.filter((e) => e.account === filters.account);
  if (filters.tag) v = v.filter((e) => e.tags.includes(filters.tag!));
  const all = [...real, ...v].sort((a, b) =>
    (a.postedAt < b.postedAt ? 1 : a.postedAt > b.postedAt ? -1 : 0) ||
    (a.id < b.id ? 1 : a.id > b.id ? -1 : 0),
  );
  const offset = Math.max(filters.offset ?? 0, 0);
  const limit = Math.max(filters.limit ?? 200, 1);
  return all.slice(offset, offset + limit);
}