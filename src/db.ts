import { DatabaseSync } from 'node:sqlite';

export type Db = DatabaseSync;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS transactions (
  id              TEXT PRIMARY KEY,
  fitid           TEXT,
  account         TEXT NOT NULL DEFAULT 'principal',
  posted_at       TEXT NOT NULL,
  amount_cents    INTEGER NOT NULL,
  description     TEXT NOT NULL,
  merchant        TEXT NOT NULL,
  category        TEXT NOT NULL,
  category_source TEXT NOT NULL,
  source          TEXT NOT NULL DEFAULT 'sample',
  is_internal_transfer INTEGER NOT NULL DEFAULT 0,
  invoice_month   TEXT,
  installment_no  INTEGER,
  installment_total INTEGER,
  is_refund       INTEGER NOT NULL DEFAULT 0,
  transfer_manual INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS account_balances (
  account       TEXT PRIMARY KEY,
  balance_cents INTEGER NOT NULL,
  as_of         TEXT NOT NULL
);
`;

export interface TransactionRow {
  id: string;
  fitid?: string | null;
  account: string;
  postedAt: string;
  amountCents: number;
  description: string;
  merchant: string;
  category: string;
  categorySource: 'rule' | 'model' | 'manual';
  source?: 'sample' | 'imported';
  isInternalTransfer?: boolean;
  /** mes da fatura (aaaa-mm) quando o lancamento veio do cartao */
  invoiceMonth?: string | null;
  installmentNo?: number | null;
  installmentTotal?: number | null;
  /** estorno: credito que cancela um debito, nao conta como receita */
  isRefund?: boolean;
  /** marcacao manual de transferencia: +1 forca transferencia, -1 forca nao */
  transferManual?: number;
}

export function openDb(file = ':memory:'): Db {
  const db = new DatabaseSync(file);
  if (file !== ':memory:') db.exec('PRAGMA journal_mode = WAL;');
  db.exec(SCHEMA);
  db.exec('CREATE TABLE IF NOT EXISTS category_overrides (merchant TEXT PRIMARY KEY, category TEXT NOT NULL, updated_at TEXT NOT NULL DEFAULT (datetime(\'now\')))');
  db.exec('CREATE TABLE IF NOT EXISTS budgets (id INTEGER PRIMARY KEY AUTOINCREMENT, category TEXT NOT NULL, month TEXT NOT NULL, limit_cents INTEGER NOT NULL, UNIQUE(category, month))');
  // migracao: bancos antigos sem a coluna source
  const cols = db.prepare("PRAGMA table_info(transactions)").all() as { name: string }[];
  const names = new Set(cols.map((c) => c.name));
  if (!names.has('source')) {
    db.exec("ALTER TABLE transactions ADD COLUMN source TEXT NOT NULL DEFAULT 'sample'");
  }
  if (!names.has('is_internal_transfer')) {
    db.exec('ALTER TABLE transactions ADD COLUMN is_internal_transfer INTEGER NOT NULL DEFAULT 0');
  }
  // fatura de cartao: o mes da fatura atravessa o mes da compra
  if (!names.has('invoice_month')) {
    db.exec('ALTER TABLE transactions ADD COLUMN invoice_month TEXT');
  }
  if (!names.has('installment_no')) {
    db.exec('ALTER TABLE transactions ADD COLUMN installment_no INTEGER');
  }
  if (!names.has('installment_total')) {
    db.exec('ALTER TABLE transactions ADD COLUMN installment_total INTEGER');
  }
  if (!names.has('is_refund')) {
    db.exec('ALTER TABLE transactions ADD COLUMN is_refund INTEGER NOT NULL DEFAULT 0');
  }
  if (!names.has('transfer_manual')) {
    db.exec('ALTER TABLE transactions ADD COLUMN transfer_manual INTEGER NOT NULL DEFAULT 0');
  }
  // indices (criados depois da migracao para nao falhar em bases antigas)
  db.exec('CREATE INDEX IF NOT EXISTS idx_tx_date ON transactions (posted_at)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_tx_category ON transactions (category)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_tx_source ON transactions (source)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_tx_merchant ON transactions (merchant)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_tx_invoice ON transactions (invoice_month)');
  // o id ja e derivado de (conta, data, valor, estabelecimento). Um indice unico nessa
  // mesma tupla apagava compras legitimamente repetidas (duas passagens iguais no mesmo
  // dia); quem garante o dedupe do reimport e o id + o fitid.
  db.exec('DROP INDEX IF EXISTS ux_tx_dedupe');
  // bancos entregam um identificador estavel por lancamento (FITID / "Identificador").
  // Quando existe, ele manda no dedupe: mudar a descricao nao cria linha nova.
  db.exec(`DELETE FROM transactions WHERE fitid IS NOT NULL AND rowid NOT IN (
    SELECT MIN(rowid) FROM transactions WHERE fitid IS NOT NULL GROUP BY account, fitid
  )`);
  db.exec('CREATE UNIQUE INDEX IF NOT EXISTS ux_tx_fitid ON transactions (account, fitid) WHERE fitid IS NOT NULL');
  return db;
}

/** Insere ignorando duplicatas (mesma conta, data, valor e estabelecimento). */
export function insertTransactions(db: Db, rows: TransactionRow[]): { inserted: number; duplicates: number } {
  const stmt = db.prepare(`
    INSERT OR IGNORE INTO transactions
      (id, fitid, account, posted_at, amount_cents, description, merchant, category, category_source, source, is_internal_transfer, invoice_month, installment_no, installment_total, is_refund, transfer_manual)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  let inserted = 0;
  db.exec('BEGIN');
  try {
    for (const r of rows) {
      const res = stmt.run(
        r.id, r.fitid ?? null, r.account, r.postedAt, r.amountCents,
        r.description, r.merchant, r.category, r.categorySource, r.source ?? 'sample', r.isInternalTransfer ? 1 : 0,
        r.invoiceMonth ?? null, r.installmentNo ?? null, r.installmentTotal ?? null,
        r.isRefund ? 1 : 0, r.transferManual ?? 0,
      );
      inserted += Number(res.changes);
    }
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
  return { inserted, duplicates: rows.length - inserted };
}

export function countTransactions(db: Db): number {
  const row = db.prepare('SELECT COUNT(*) AS n FROM transactions').get() as { n: number };
  return Number(row.n);
}

export function countBySource(db: Db): { sample: number; imported: number } {
  const rows = db.prepare('SELECT source, COUNT(*) AS n FROM transactions GROUP BY source').all() as { source: string; n: number }[];
  const out = { sample: 0, imported: 0 };
  for (const r of rows) {
    if (r.source === 'imported') out.imported = Number(r.n);
    else out.sample += Number(r.n);
  }
  return out;
}

export function deleteImported(db: Db): number {
  const res = db.prepare("DELETE FROM transactions WHERE source = 'imported'").run();
  return Number(res.changes);
}

export function getAccountBalance(db: Db, account: string): { balanceCents: number; asOf: string } | null {
  const row = db.prepare('SELECT balance_cents, as_of FROM account_balances WHERE account = ?').get(account) as { balance_cents: number; as_of: string } | undefined;
  if (!row) return null;
  return { balanceCents: Number(row.balance_cents), asOf: String(row.as_of) };
}

export function setAccountBalance(db: Db, account: string, balanceCents: number, asOf: string): void {
  db.prepare('INSERT INTO account_balances (account, balance_cents, as_of) VALUES (?, ?, ?) ON CONFLICT(account) DO UPDATE SET balance_cents = excluded.balance_cents, as_of = excluded.as_of').run(account, balanceCents, asOf);
}

export function countCrossAccountDuplicates(db: Db): number {
  const row = db.prepare(`
    SELECT COUNT(DISTINCT a.id) AS n
    FROM transactions a
    JOIN transactions b ON a.posted_at = b.posted_at
      AND a.amount_cents = b.amount_cents
      AND a.merchant = b.merchant
      AND a.account <> b.account
  `).get() as { n: number };
  return Number(row.n);
}

export function distinctAccounts(db: Db): string[] {
  const rows = db.prepare('SELECT DISTINCT account FROM transactions ORDER BY account').all() as { account: string }[];
  return rows.map((r) => String(r.account));
}

/** Marca pares de lancamentos que parecem transferencia entre contas proprias. */
export function detectInternalTransfers(db: Db): number {
  // reset only automatic ones; manual marks survive re-detection
  db.exec('UPDATE transactions SET is_internal_transfer = 0 WHERE transfer_manual = 0');
  const rows = db
    .prepare('SELECT id, account, posted_at, amount_cents, merchant, transfer_manual FROM transactions')
    .all() as { id: string; account: string; posted_at: string; amount_cents: number; merchant: string; transfer_manual: number }[];
  const byKey = new Map<string, typeof rows>();
  for (const r of rows) {
    const key = `${Math.abs(r.amount_cents)}`;
    if (!byKey.has(key)) byKey.set(key, []);
    byKey.get(key)!.push(r);
  }
  const pairs: string[][] = [];
  const used = new Set<string>();
  for (const group of byKey.values()) {
    if (group.length < 2) continue;
    for (let i = 0; i < group.length; i++) {
      for (let j = i + 1; j < group.length; j++) {
        const a = group[i]!;
        const b = group[j]!;
        if (a.account === b.account) continue;
        if (a.transfer_manual !== 0 || b.transfer_manual !== 0) continue;
        if (used.has(a.id) || used.has(b.id)) continue;
        if (Math.sign(a.amount_cents) === Math.sign(b.amount_cents)) continue;
        const da = new Date(a.posted_at).getTime();
        const dbt = new Date(b.posted_at).getTime();
        if (Math.abs(da - dbt) > 3 * 86400000) continue;
const ma = a.merchant.toLowerCase().replace(/^enviado\s+/, '');
        const mb = b.merchant.toLowerCase().replace(/^enviado\s+/, '');
        const related = ma.length > 0 && mb.length > 0 && (ma === mb || ma.includes(mb) || mb.includes(ma));
        if (!related) continue;
        pairs.push([a.id, b.id]);
        used.add(a.id);
        used.add(b.id);
      }
    }
  }
  db.exec('BEGIN');
  try {
    const stmt = db.prepare('UPDATE transactions SET is_internal_transfer = 1 WHERE id = ?');
    for (const pair of pairs) {
      const a = pair[0]!;
      const b = pair[1]!;
      stmt.run(a);
      stmt.run(b);
    }
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
  return pairs.length;
}

/** Marca manualmente um lançamento como transferência interna (ou desfaz). */
export function markInternalTransfer(db: Db, id: string, value: boolean): boolean {
  const row = db.prepare('SELECT id FROM transactions WHERE id = ?').get(id) as { id: string } | undefined;
  if (!row) return false;
  db.prepare('UPDATE transactions SET is_internal_transfer = ?, transfer_manual = ? WHERE id = ?').run(value ? 1 : 0, value ? 1 : -1, id);
  return true;
}

/** Marca um crédito como estorno: sai do total de receitas. */
export function markRefund(db: Db, id: string, value: boolean): boolean {
  const row = db.prepare('SELECT id FROM transactions WHERE id = ?').get(id) as { id: string } | undefined;
  if (!row) return false;
  db.prepare('UPDATE transactions SET is_refund = ? WHERE id = ?').run(value ? 1 : 0, id);
  return true;
}

export function getOverrideCategory(db: Db, merchant: string): string | null {
  const row = db.prepare('SELECT category FROM category_overrides WHERE merchant = ?').get(merchant) as { category: string } | undefined;
  return row?.category ?? null;
}

export function setOverrideCategory(db: Db, merchant: string, category: string): void {
  db.prepare('INSERT INTO category_overrides (merchant, category) VALUES (?, ?) ON CONFLICT(merchant) DO UPDATE SET category = excluded.category, updated_at = datetime(\'now\')').run(merchant, category);
}

export function applyOverridesToTransactions(db: Db, merchant: string, category: string): number {
  const res = db.prepare('UPDATE transactions SET category = ?, category_source = \'manual\' WHERE merchant = ?').run(category, merchant);
  return Number(res.changes ?? 0);
}
export function listBudgets(db: Db, month: string): { category: string; limitCents: number }[] {
  return db.prepare('SELECT category, limit_cents AS limitCents FROM budgets WHERE month = ?').all(month) as { category: string; limitCents: number }[];
}
export function upsertBudget(db: Db, category: string, month: string, limitCents: number): void {
  db.prepare('INSERT INTO budgets (category, month, limit_cents) VALUES (?, ?, ?) ON CONFLICT(category, month) DO UPDATE SET limit_cents = excluded.limit_cents').run(category, month, limitCents);
}
export function deleteBudget(db: Db, category: string, month: string): void {
  db.prepare('DELETE FROM budgets WHERE category = ? AND month = ?').run(category, month);
}

