import { parseAmountToCents, parseDateToISO, stripAccents } from './normalize.ts';

export interface ParsedRow {
  postedAt: string;
  amountCents: number;
  description: string;
  fitid?: string;
}

function splitLine(line: string, delimiter: string): string[] {
  const out: string[] = [];
  let current = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]!;
    if (ch === '"') {
      if (quoted && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        quoted = !quoted;
      }
    } else if (ch === delimiter && !quoted) {
      out.push(current);
      current = '';
    } else {
      current += ch;
    }
  }
  out.push(current);
  return out.map((cell) => cell.trim().replace(/^"|"$/g, ''));
}

function detectDelimiter(header: string): string {
  const counts = new Map([
    [';', (header.match(/;/g) ?? []).length],
    ['\t', (header.match(/\t/g) ?? []).length],
    [',', (header.match(/,/g) ?? []).length],
  ]);
  let best = ';';
  let bestCount = 0;
  for (const [delimiter, count] of counts) {
    if (count > bestCount) {
      best = delimiter;
      bestCount = count;
    }
  }
  return bestCount === 0 ? ';' : best;
}

const DATE_KEYS = ['data', 'date', 'dt'];
const DESC_KEYS = ['descricao', 'descricao ', 'historico', 'desc', 'memo', 'lancamento'];
const AMOUNT_KEYS = ['valor', 'amount', 'value', 'quantia'];
const BALANCE_KEYS = ['saldo', 'balance', 'saldo atual', 'saldo final'];

function findColumn(headers: string[], keys: string[], fallback: number): number {
  const index = headers.findIndex((h) => keys.includes(stripAccents(h)));
  return index >= 0 ? index : fallback;
}

/**
 * Le CSV de extrato com cabecalho (data / descricao / valor) ou, sem cabecalho,
 * assumindo as tres primeiras colunas nessa ordem.
 */
export function parseCsv(text: string): ParsedRow[] {
  const lines = text
    .replace(/^\uFEFF/, '')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  if (lines.length === 0) return [];

  const delimiter = detectDelimiter(lines[0]!);
  const firstCells = splitLine(lines[0]!, delimiter).map((c) => stripAccents(c.toLowerCase()));
  const hasHeader = DATE_KEYS.concat(AMOUNT_KEYS).some((k) => firstCells.includes(k));

  const headers = hasHeader ? firstCells : [];
  const dateCol = findColumn(headers, DATE_KEYS, 0);
  const descCol = findColumn(headers, DESC_KEYS, 1);
  const amountCol = findColumn(headers, AMOUNT_KEYS, 2);
  const fitidCol = findColumn(headers, ['identificador', 'id', 'fitid', 'transaction id'], -1);

  const rows: ParsedRow[] = [];
  for (const line of lines.slice(hasHeader ? 1 : 0)) {
    const cells = splitLine(line, delimiter);
    const rawDate = cells[dateCol];
    const rawDesc = cells[descCol];
    const rawAmount = cells[amountCol];
    if (!rawDate || !rawDesc || !rawAmount) continue;
    try {
      rows.push({
        postedAt: parseDateToISO(rawDate),
        amountCents: parseAmountToCents(rawAmount),
        description: rawDesc,
        fitid: fitidCol >= 0 ? cells[fitidCol] : undefined,
      });
    } catch {
      // linha invalida (rodape de saldo, linha em branco): ignora em vez de quebrar o import
    }
  }
  return rows;
}

export function parseCsvBalance(text: string): number | null {
  const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/).map((l) => l.trim()).filter((l) => l.length > 0);
  if (lines.length === 0) return null;
  const delimiter = detectDelimiter(lines[0]!);
  const firstCells = splitLine(lines[0]!, delimiter).map((c) => stripAccents(c.toLowerCase()));
  const hasHeader = DATE_KEYS.concat(AMOUNT_KEYS).some((k) => firstCells.includes(k));
  const headers = hasHeader ? firstCells : [];
  const balanceCol = findColumn(headers, BALANCE_KEYS, -1);
  if (balanceCol < 0) return null;
  let last: string | null = null;
  for (const line of lines.slice(hasHeader ? 1 : 0)) {
    const cells = splitLine(line, delimiter);
    const v = cells[balanceCol];
    if (v) last = v;
  }
  if (!last) return null;
  try { return parseAmountToCents(last); } catch { return null; }
}
