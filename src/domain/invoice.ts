/**
 * Fatura de cartão: o mês da fatura não é o mês da compra.
 *
 * Um lançamento de cartão guarda `posted_at` (quando a compra aconteceu) e
 * `invoice_month` (em qual fatura ela cai). Assim o recorte "fatura de outubro"
 * e a compra parcelada continuam somando uma única vez.
 */

export interface Installment {
  no: number;
  total: number;
}

const INSTALLMENT_PATTERNS = [
  /parcela\s*(\d{1,2})\s*\/\s*(\d{1,2})/i,
  /parcela\s*(\d{1,2})\s*de\s*(\d{1,2})/i,
  /\(\s*(\d{1,2})\s*\/\s*(\d{1,2})\s*\)/,
  /\s(\d{1,2})\/(\d{1,2})$/,
];

/** "PARCELA 3/10" no fim da descrição, sem confundir com uma data. */
export function parseInstallment(description: string): Installment | null {
  for (const pattern of INSTALLMENT_PATTERNS) {
    const match = pattern.exec(description);
    if (!match) continue;
    const no = Number(match[1]);
    const total = Number(match[2]);
    if (!Number.isInteger(no) || !Number.isInteger(total)) continue;
    if (no < 1 || total < 2 || total > 48 || no > total) continue;
    return { no, total };
  }
  return null;
}

/** Remove "parcela 3/10" do nome do estabelecimento, mantendo o resto da descrição. */
export function stripInstallment(description: string): string {
  return description
    .replace(/parcela\s*\d{1,2}\s*\/\s*\d{1,2}/i, ' ')
    .replace(/parcela\s*\d{1,2}\s*de\s*\d{1,2}/i, ' ')
    .replace(/\(\s*\d{1,2}\s*\/\s*\d{1,2}\s*\)/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** "2026-10", "10/2026" e "outubro de 2026" viram "2026-10". */
export function normalizeInvoiceMonth(value: string): string | null {
  const trimmed = value.trim();
  if (/^\d{4}-\d{2}$/.test(trimmed)) return trimmed;

  const numeric = /^(\d{1,2})\s*\/\s*(\d{4})$/.exec(trimmed);
  if (numeric) return `${numeric[2]}-${numeric[1]!.padStart(2, '0')}`;

  const named = /([a-zç]+)\s+de\s+(\d{4})/i.exec(trimmed.normalize('NFD').replace(/[\u0300-\u036f]/g, ''));
  if (named) {
    const months = [
      'janeiro', 'fevereiro', 'marco', 'abril', 'maio', 'junho',
      'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro',
    ];
    const index = months.indexOf(named[1]!.toLowerCase());
    if (index >= 0) return `${named[2]}-${String(index + 1).padStart(2, '0')}`;
  }
  return null;
}

/**
 * O vencimento é a âncora mais confiável da fatura: a compra pode ser de maio e
 * a fatura vencer em junho. Aceita "vencimento 10/06/2026" e "vencimento: 10/06".
 */
export function invoiceMonthFromText(text: string, fallbackYear: number): string | null {
  const normalized = text.replace(/\s+/g, ' ');
  const withYear = /vencimento[^0-9]{0,20}(\d{1,2})\s*\/\s*(\d{1,2})(?:\s*\/\s*(\d{2,4}))?/i.exec(normalized);
  if (withYear) {
    const month = Number(withYear[2]);
    if (month < 1 || month > 12) return null;
    const rawYear = withYear[3];
    // ano de 2 digitos no vencimento e o mesmo seculo do extrato
    const year = rawYear ? (rawYear.length === 2 ? 2000 + Number(rawYear) : Number(rawYear)) : fallbackYear;
    return `${year}-${String(month).padStart(2, '0')}`;
  }
  const named = /fatura\s+(?:de\s+)?([a-zç]+)(?:\s+de\s+(\d{4}))?/i.exec(normalized);
  if (named) {
    return normalizeInvoiceMonth(named[2] ? `${named[1]} de ${named[2]}` : `${named[1]} de ${fallbackYear}`);
  }
  return null;
}

/** Marcas de que o arquivo é uma fatura, não um extrato de conta. */
export function looksLikeCardStatement(text: string): boolean {
  const head = text.slice(0, 8000).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  const hasCard = /cartao de credito|cartao final|final \d{4}/.test(head);
  const hasInvoice = /fatura|vencimento|limite disponivel|pagamento minimo/.test(head);
  return hasCard && hasInvoice;
}
