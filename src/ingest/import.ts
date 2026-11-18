import { insertTransactions, getAccountBalance, setAccountBalance, countCrossAccountDuplicates, detectInternalTransfers, getOverrideCategory, type Db } from '../db.ts';
import { classify } from '../categorize/classify.ts';
import { parseCsv, parseCsvBalance, type ParsedRow } from './csv.ts';
import { parseOfx, parseOfxBalance } from './ofx.ts';
import { parsePdfDocument } from './pdf.ts';
import { normalizeMerchant, transactionId } from './normalize.ts';
import {
  invoiceMonthFromText,
  looksLikeCardStatement,
  parseInstallment,
  stripInstallment,
} from '../domain/invoice.ts';

/** Fatura de cartao: quando a pessoa sabe o mes, ou quando o proprio arquivo diz. */
export interface ImportOptions {
  /** 'card' forca fatura; 'account' forca extrato de conta; vazio detecta pelo texto. */
  kind?: 'account' | 'card';
  /** mes da fatura (aaaa-mm): vence qualquer deteccao */
  invoiceMonth?: string | null;
}

export interface ImportResult {
  read: number;
  inserted: number;
  duplicates: number;
  format: 'csv' | 'ofx' | 'pdf';
  /** conta em que os lancamentos foram gravados (detectada ou escolhida) */
  account: string;
  /** mes (aaaa-mm) do proprio arquivo, para o recibo nao mostrar o mes de outro extrato */
  month: string;
  /** 'ocr' quando o PDF era so imagem e o texto veio do reconhecimento */
  via?: 'texto' | 'ocr';
  /** valores que o OCR nao leu e foram recuperados pela diferenca de saldo */
  ocrCorrections?: number;
  reportedBalanceCents?: number | null;
  computedSumCents?: number;
  balanceOk?: boolean | null;
  balanceMessage?: string;
  crossAccountDuplicates?: number;
  transfers?: number;
  /** mes da fatura (aaaa-mm) quando o arquivo era fatura de cartao */
  invoiceMonth?: string | null;
  /** quantos lancamentos eram parcelas */
  installments?: number;
}

export function importExtrato(
  db: Db,
  text: string,
  account = 'principal',
  importSource: 'sample' | 'imported' = 'imported',
  options: ImportOptions = {},
): ImportResult {
  if (text.trimStart().startsWith('%PDF-')) {
    throw new Error('esse arquivo e um PDF: envie o conteudo em base64 no campo "base64"');
  }
  const format: 'csv' | 'ofx' = /<OFX/i.test(text) ? 'ofx' : 'csv';
  const parsed = format === 'ofx' ? parseOfx(text) : parseCsv(text);
  if (parsed.length === 0) {
    throw new Error(
      format === 'ofx'
        ? 'o OFX nao tem nenhum lancamento (STMTTRN): confira se o arquivo veio vazio ou se e o extrato certo'
        : 'o CSV nao tem nenhum lancamento: cada linha precisa de data, descricao e valor',
    );
  }
  const reportedBalanceCents = format === 'ofx' ? parseOfxBalance(text) : parseCsvBalance(text);
  // fatura de cartao: o mes da fatura atravessa o mes da compra, entao ele vem
  // do vencimento declarado no arquivo (ou da escolha da pessoa), nao de posted_at
  const invoiceMonth = resolveInvoiceMonth(text, parsed, options);
  return persist(db, parsed, account, importSource, format, reportedBalanceCents, null, invoiceMonth);
}

function latestYear(parsed: ParsedRow[]): number {
  const latest = parsed.reduce((max, row) => (row.postedAt > max ? row.postedAt : max), '');
  return Number(latest.slice(0, 4)) || new Date().getFullYear();
}

/**
 * Mes da fatura: escolha explicita > vencimento no arquivo. So existe fatura
 * quando a pessoa disse que e cartao ou o texto parece fatura; extrato de conta
 * comum continua com invoice_month nulo e e recortado por posted_at.
 */
function resolveInvoiceMonth(
  text: string,
  parsed: ParsedRow[],
  options: ImportOptions,
  knownCard?: boolean,
): string | null {
  if (options.invoiceMonth) return options.invoiceMonth;
  const card = options.kind === 'card' || (options.kind !== 'account' && (knownCard ?? looksLikeCardStatement(text)));
  if (!card) return null;
  const declared = invoiceMonthFromText(text, latestYear(parsed));
  if (declared) return declared;
  const latest = parsed.reduce((max, row) => (row.postedAt > max ? row.postedAt : max), '');
  return latest.slice(0, 7) || null;
}

/** 8 MB de PDF: o mesmo teto que a tela aplica antes de mandar em base64. */
export const MAX_PDF_BYTES = 8 * 1024 * 1024;

function assertPdfBytes(buffer: Uint8Array): void {
  if (buffer.length === 0) throw new Error('PDF vazio');
  if (buffer.length > MAX_PDF_BYTES) throw new Error('PDF maior que 8 MB');
  // assinatura do formato: o nome do arquivo e so um rotulo, nao prova nada
  if (Buffer.from(buffer.subarray(0, 5)).toString('latin1') !== '%PDF-') {
    throw new Error('o arquivo enviado nao e um PDF valido (falta a assinatura %PDF-)');
  }
}

/**
 * PDF: texto quando existe camada de texto, OCR quando o arquivo e so imagem
 * (extrato da Caixa). O saldo corrente de cada linha e conferido contra a soma:
 * se o OCR leu um digito errado, o import para em vez de gravar numero torto.
 */
export async function importPdf(
  db: Db,
  buffer: Uint8Array,
  account = 'principal',
  importSource: 'sample' | 'imported' = 'imported',
  options: ImportOptions = {},
): Promise<ImportResult> {
  assertPdfBytes(buffer);
  const doc = await parsePdfDocument(buffer);
  // extrato reconhecido que declara saldo mas nao teve movimento no periodo e valido:
  // so e erro quando nao deu para reconhecer nada
  if (doc.rows.length === 0 && doc.saldoFinalCents === null) {
    throw new Error('nao encontrei lancamentos no PDF: cada linha precisa ter data, descricao e valor');
  }

  // rede de seguranca da cadeia de saldo: com a cadeia certa isso nunca dispara
  const sum = doc.rows.reduce((total, row) => total + row.amountCents, 0);
  const brl = (cents: number) => (cents / 100).toFixed(2);
  if (doc.saldoAnteriorCents !== null && doc.saldoFinalCents !== null && doc.saldoAnteriorCents + sum !== doc.saldoFinalCents) {
    throw new Error(
      `saldo do PDF nao fecha: ${brl(doc.saldoAnteriorCents)} + ${brl(sum)} != ${brl(doc.saldoFinalCents)}; confira se o arquivo esta completo`,
    );
  }

  // a conta que o extrato declara vence o nome do arquivo: dois PDFs do mesmo
  // mes tem nomes diferentes e precisam cair na mesma conta
  const resolved = doc.accountHint ?? account;
  const invoiceMonth = resolveInvoiceMonth(doc.text, doc.rows, options);

  return {
    ...persist(db, doc.rows, resolved, importSource, 'pdf', doc.saldoFinalCents, doc.saldoAnteriorCents, invoiceMonth),
    via: doc.via,
    ocrCorrections: doc.corrections,
  };
}

function persist(
  db: Db,
  parsed: ParsedRow[],
  account: string,
  importSource: 'sample' | 'imported',
  format: ImportResult['format'],
  reportedBalanceCents: number | null,
  openingBalanceCents: number | null = null,
  invoiceMonth: string | null = null,
): ImportResult {
  // duas compras iguais no mesmo dia geram o mesmo id: a segunda ganha um sufixo.
  // Reimportar o mesmo arquivo produz os mesmos sufixos na mesma ordem e nao duplica.
  const occurrences = new Map<string, number>();
  let installments = 0;
  const rows = parsed.map((row) => {
    // "PARCELA 3/10" e metadata, nao nome da loja: sai da descricao e vira coluna
    const installment = invoiceMonth ? parseInstallment(row.description) : null;
    const description = installment ? stripInstallment(row.description) : row.description;
    if (installment) installments += 1;
    const merchant = normalizeMerchant(description);
    const { category: classified, source } = classify(description, merchant);
    const override = getOverrideCategory(db, merchant);
    const category = override ?? classified;
    const categorySource = (override ? 'manual' : source) as 'rule' | 'model' | 'manual';
    const base = transactionId(account, row.postedAt, row.amountCents, merchant);
    const occurrence = (occurrences.get(base) ?? 0) + 1;
    occurrences.set(base, occurrence);
    return {
      id: occurrence === 1 ? base : `${base}#${occurrence}`,
      fitid: row.fitid ?? null,
      account,
      postedAt: row.postedAt,
      amountCents: row.amountCents,
      description,
      merchant,
      category,
      categorySource,
      source: importSource,
      invoiceMonth,
      installmentNo: installment?.no ?? null,
      installmentTotal: installment?.total ?? null,
    };
  });

  const { inserted, duplicates } = insertTransactions(db, rows);
  const computedSumCents = rows.reduce((acc, r) => acc + r.amountCents, 0);

  const previous = getAccountBalance(db, account);
  let balanceOk: boolean | null = null;
  let balanceMessage: string | undefined;
  if (reportedBalanceCents !== null) {
    // o saldo anterior declarado pelo proprio extrato vence o saldo guardado do
    // banco: reimportar o mesmo PDF nao pode acusar inconsistencia por isso.
    if (openingBalanceCents !== null) {
      const expected = openingBalanceCents + computedSumCents;
      balanceOk = Math.abs(expected - reportedBalanceCents) <= 1;
      if (!balanceOk) {
        balanceMessage = `saldo inconsistente: esperado ${expected / 100}, informado ${reportedBalanceCents / 100}`;
      }
    } else if (previous) {
      const expected = previous.balanceCents + computedSumCents;
      balanceOk = Math.abs(expected - reportedBalanceCents) <= 1;
      if (!balanceOk) balanceMessage = `saldo inconsistente: esperado ${expected / 100}, informado ${reportedBalanceCents / 100}`;
    } else {
      balanceMessage = 'saldo informado registrado (sem saldo anterior para conferir)';
    }
    setAccountBalance(db, account, reportedBalanceCents, new Date().toISOString().slice(0, 10));
  }

  const transfers = detectInternalTransfers(db);
  const crossAccountDuplicates = countCrossAccountDuplicates(db);

  const month = parsed.reduce((latest, row) => (row.postedAt > latest ? row.postedAt : latest), '').slice(0, 7);

  return {
    read: parsed.length,
    inserted,
    duplicates,
    format,
    account,
    month: month || new Date().toISOString().slice(0, 7),
    reportedBalanceCents,
    computedSumCents,
    balanceOk,
    balanceMessage,
    crossAccountDuplicates,
    transfers,
    invoiceMonth,
    installments: installments || undefined,
  };
}
