import { parseAmountToCents } from './normalize.ts';
import type { ParsedRow } from './csv.ts';

function tag(block: string, name: string): string | null {
  const match = new RegExp(`<${name}>\\s*([^<\\r\\n]+)`, 'i').exec(block);
  return match?.[1]?.trim() ?? null;
}

/** Parser minimo de OFX/SGML (o que os bancos exportam de verdade). */
export function parseOfx(text: string): ParsedRow[] {
  const rows: ParsedRow[] = [];
  const blocks = text.match(/<STMTTRN>[\s\S]*?<\/STMTTRN>/gi) ?? [];

  for (const block of blocks) {
    const rawDate = tag(block, 'DTPOSTED');
    const rawAmount = tag(block, 'TRNAMT');
    const description = tag(block, 'MEMO') ?? tag(block, 'NAME') ?? 'Lancamento';
    if (!rawDate || !rawAmount) continue;

    const iso = `${rawDate.slice(0, 4)}-${rawDate.slice(4, 6)}-${rawDate.slice(6, 8)}`;
    try {
      rows.push({
        postedAt: iso,
        amountCents: parseAmountToCents(rawAmount),
        description,
        fitid: tag(block, 'FITID') ?? undefined,
      });
    } catch {
      // transacao corrompida no arquivo: segue importando o resto
    }
  }
  return rows;
}

export function parseOfxBalance(text: string): number | null {
  const m = /<LEDGERBAL>[\s\S]*?<BALAMT>\s*([^<\r\n]+)/i.exec(text);
  if (!m?.[1]) return null;
  try { return parseAmountToCents(m[1].trim()); } catch { return null; }
}
