import { createHash } from 'node:crypto';

export function stripAccents(value: string): string {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

/**
 * "R$ 1.234,56" -> 123456 | "-58,90" -> -5890 | "1234.56" -> 123456
 * Dinheiro em centavos (inteiro) para nunca somar float.
 */
export function parseAmountToCents(input: string): number {
  let s = input.trim().replace(/[\s\u00a0]/g, '').replace(/R\$/gi, '');
  // cada banco desenha o menos do seu jeito: PicPay usa U+2212 (−R$ 5,00) e o
  // Santander poe o sinal depois do numero (200,00-). Normaliza antes de ler.
  s = s.replace(/[\u2212\u2013\u2014]/g, '-');
  let negative = false;

  if (s.startsWith('-')) {
    negative = true;
    s = s.slice(1);
  }
  if (s.endsWith('-')) {
    negative = true;
    s = s.slice(0, -1);
  }
  if (s.startsWith('(') && s.endsWith(')')) {
    negative = true;
    s = s.slice(1, -1);
  }
  s = s.replace(/^\+/, '');

  if (s.includes(',')) {
    s = s.replace(/\./g, '').replace(',', '.');
  } else if (/^\d{1,3}(\.\d{3})+$/.test(s)) {
    // 1.234.567 sem virgula: ponto e separador de milhar
    s = s.replace(/\./g, '');
  }

  const value = Number.parseFloat(s);
  if (!Number.isFinite(value)) {
    throw new Error(`Valor monetario invalido: "${input}"`);
  }
  const cents = Math.round(value * 100);
  return negative ? -cents : cents;
}

/** Aceita dd/mm/aaaa, dd-mm-aaaa e aaaa-mm-dd. Retorna ISO (aaaa-mm-dd). */
export function parseDateToISO(input: string): string {
  const raw = input.trim().slice(0, 10);
  let day: number, month: number, year: number;

  let m = /^(\d{2})[/-](\d{2})[/-](\d{4})$/.exec(raw);
  if (m) {
    day = Number(m[1]);
    month = Number(m[2]);
    year = Number(m[3]);
  } else {
    m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw);
    if (!m) throw new Error(`Data invalida: "${input}"`);
    year = Number(m[1]);
    month = Number(m[2]);
    day = Number(m[3]);
  }

  if (month < 1 || month > 12 || day < 1 || day > 31) {
    throw new Error(`Data invalida: "${input}"`);
  }
  const iso = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  if (Number.isNaN(Date.parse(`${iso}T00:00:00Z`))) {
    throw new Error(`Data invalida: "${input}"`);
  }
  return iso;
}

const NOISE = /\b(pix|ted|doc|compra|cartao|debito|credito|pagamento|pag|boleto|ltda|me|sa|eireli|via|app)\b/g;

/**
 * Extratos brasileiros embrulham o estabelecimento num texto fixo:
 *   "Transferencia enviada pelo Pix - JANISLEYDE SILVA CAMPOS - ..."
 *   "Compra no debito - DROGASIL 3978"
 * Sem separar o "assunto" do embrulho, o merchant vira a frase inteira e
 * toda compra cai em "Transferencias".
 */
function extractSubject(deaccented: string): string | null {
  const text = deaccented.trim();
  const pix = /^transferencia\s+(?:enviada|recebida)\s+pel[oa]\s+pix\s*[-\u2013]\s*(.+)$/i.exec(text);
  if (pix?.[1]) return pix[1].split(/\s+[-\u2013]\s+/)[0] ?? pix[1];

  const card = /^compra\s+no\s+(?:debito|credito)\s*[-\u2013]\s*(.+)$/i.exec(text);
  if (card?.[1]) return card[1];

  const boleto = /^pagamento\s+de\s+boleto\s*[-\u2013]\s*(.+)$/i.exec(text);
  if (boleto?.[1]) return boleto[1];

  return null;
}

/** "IFOOD *RESTAURANTE 1234" -> "Ifood Restaurante" */
export function normalizeMerchant(raw: string): string {
  const deaccented = stripAccents(raw);
  const subject = extractSubject(deaccented) ?? deaccented;
  const cleaned = subject
    .toLowerCase()
    .replace(/[*_|]/g, ' ')
    .replace(/\b\d{1,2}\/\d{1,2}(\/\d{2,4})?\b/g, ' ') // datas
    .replace(/\b\d{4,}\b/g, ' ')                        // ids, agencias, codigos
    .replace(NOISE, ' ')
    .replace(/[^a-z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  return cleaned
    .split(' ')
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

export function transactionId(account: string, postedAt: string, amountCents: number, merchant: string): string {
  return createHash('sha1')
    .update([account, postedAt, amountCents, merchant].join('|'))
    .digest('hex')
    .slice(0, 16);
}
