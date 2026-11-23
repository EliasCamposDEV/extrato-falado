import { createHash, randomBytes } from 'node:crypto';
import type { Db } from './db.ts';

/** Escopo de titular. No deploy publico ele e o hash da sessao anonima do navegador. */
export interface Scope {
  sessionHash?: string;
}

/** Identificador opaco da sessao: nunca e gravado, apenas seu hash. */
export function newSessionId(): string {
  return randomBytes(24).toString('hex');
}

export function hashSession(sid: string): string {
  return createHash('sha256').update(sid).digest('hex');
}

/**
 * Minimizacao (art. 6, II da LGPD): CPF, e-mail, telefone e sequencias longas
 * de digitos nao precisam ficar numa descricao de lancamento. Nomes de
 * terceiros podem permanecer, risco residual documentado em docs/RIPD.md.
 */
export function redactDescription(text: string): string {
  return text
    .replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, '[EMAIL]')
    // telefone com DDD: sem pontos, para nao confundir com CPF pontuado
    .replace(/(?<![\d.])(?:\+?55[\s.-]?)?\(?\d{2}\)?[\s-]?9?\d{4}[\s-]?\d{4}(?![\d.-])/g, '[TELEFONE]')
    .replace(/\b\d{3}\.\d{3}\.\d{3}-\d{2}\b|\b\d{11}\b/g, '[CPF]')
    .replace(/\d{8,}/g, '[NUMERO]');
}

export function ensurePrivacyTables(db: Db): void {
  db.exec(`CREATE TABLE IF NOT EXISTS consents (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_hash TEXT NOT NULL,
    privacy INTEGER NOT NULL,
    over18 INTEGER NOT NULL,
    share_notice INTEGER NOT NULL,
    llm INTEGER NOT NULL,
    created_at TEXT NOT NULL,
    revoked_at TEXT
  )`);
  db.exec('CREATE INDEX IF NOT EXISTS idx_consents_session ON consents (session_hash, created_at DESC)');
}

export interface Consent {
  privacy: boolean;
  over18: boolean;
  shareNotice: boolean;
  llm: boolean;
  createdAt: string;
  revokedAt: string | null;
}

export interface ConsentInput {
  privacy: boolean;
  over18: boolean;
  shareNotice: boolean;
  llm: boolean;
}

function rowToConsent(row: any): Consent {
  return {
    privacy: Number(row.privacy) === 1,
    over18: Number(row.over18) === 1,
    shareNotice: Number(row.share_notice) === 1,
    llm: Number(row.llm) === 1,
    createdAt: String(row.created_at),
    revokedAt: row.revoked_at == null ? null : String(row.revoked_at),
  };
}

export function recordConsent(db: Db, sessionHash: string, input: ConsentInput): Consent {
  const createdAt = new Date().toISOString();
  db.prepare(`INSERT INTO consents (session_hash, privacy, over18, share_notice, llm, created_at)
    VALUES (?, ?, ?, ?, ?, ?)`).run(
    sessionHash,
    input.privacy ? 1 : 0,
    input.over18 ? 1 : 0,
    input.shareNotice ? 1 : 0,
    input.llm ? 1 : 0,
    createdAt,
  );
  const row = db.prepare(`SELECT * FROM consents WHERE session_hash = ? AND created_at = ? ORDER BY id DESC LIMIT 1`)
    .get(sessionHash, createdAt);
  return rowToConsent(row);
}

export function currentConsent(db: Db, sessionHash: string): Consent | null {
  const row = db.prepare(`SELECT * FROM consents WHERE session_hash = ? AND revoked_at IS NULL ORDER BY created_at DESC, id DESC LIMIT 1`)
    .get(sessionHash);
  return row ? rowToConsent(row) : null;
}

/** Retirada do consentimento: o registro da retirada fica para accountability. */
export function revokeConsent(db: Db, sessionHash: string): boolean {
  const res = db.prepare('UPDATE consents SET revoked_at = ? WHERE session_hash = ? AND revoked_at IS NULL')
    .run(new Date().toISOString(), sessionHash);
  return Number(res.changes ?? 0) > 0;
}

export interface SessionData {
  consent: Consent | null;
  manualEntries: unknown[];
  recurringTemplates: unknown[];
  budgets: unknown[];
}

/** Portabilidade (art. 18, V): devolve os dados da sessao em formato estruturado. */
export function sessionData(db: Db, sessionHash: string): SessionData {
  const manualEntries = db.prepare('SELECT * FROM manual_entries WHERE session_hash = ? ORDER BY posted_at DESC, id DESC')
    .all(sessionHash) as unknown[];
  const recurringTemplates = db.prepare('SELECT * FROM recurring_templates WHERE session_hash = ? ORDER BY created_at DESC')
    .all(sessionHash) as unknown[];
  const budgets = db.prepare('SELECT * FROM budgets WHERE session_hash = ? ORDER BY month DESC, category')
    .all(sessionHash) as unknown[];
  return { consent: currentConsent(db, sessionHash), manualEntries, recurringTemplates, budgets };
}

/** Exclusao (art. 18, VI) de todos os dados associados a sessao. */
export function deleteSessionData(db: Db, sessionHash: string): Record<string, number> {
  const removed: Record<string, number> = {};
  for (const table of ['manual_entries', 'recurring_templates', 'budgets', 'consents']) {
    const res = db.prepare(`DELETE FROM ${table} WHERE session_hash = ?`).run(sessionHash);
    removed[table] = Number(res.changes ?? 0);
  }
  return removed;
}

/** Retencao: dados de sessao mais velhos que `days` sao descartados. */
export function deleteExpiredSessionData(db: Db, days = 30): number {
  const cutoff = new Date(Date.now() - days * 86400000).toISOString().slice(0, 19).replace('T', ' ');
  let total = 0;
  for (const table of ['manual_entries', 'recurring_templates', 'budgets', 'consents']) {
    const res = db.prepare(`DELETE FROM ${table} WHERE session_hash IS NOT NULL AND created_at < ?`).run(cutoff);
    total += Number(res.changes ?? 0);
  }
  return total;
}

/** Usado por /api/reset no modo "all": limita o escopo a esta instalacao. */
export function clearAllUserData(db: Db): Record<string, number> {
  const removed: Record<string, number> = {};
  for (const table of ['transactions', 'account_balances', 'manual_entries', 'recurring_templates', 'budgets', 'category_overrides', 'consents']) {
    const res = db.prepare(`DELETE FROM ${table}`).run();
    removed[table] = Number(res.changes ?? 0);
  }
  return removed;
}
