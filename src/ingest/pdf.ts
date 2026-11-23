import { parseAmountToCents, parseDateToISO, stripAccents } from './normalize.ts';
import { MONTHS } from '../domain/vocab.ts';
import type { ParsedRow } from './csv.ts';

export interface PdfExtract {
  rows: ParsedRow[];
  saldoAnteriorCents: number | null;
  saldoFinalCents: number | null;
  /** quantos valores o OCR nao leu e precisaram sair da diferenca de saldo */
  corrections: number;
  /** conta que o proprio extrato declara ("Conta 0755 / 1288..."); vence o nome do arquivo */
  accountHint: string | null;
}

const NOTHING: PdfExtract = {
  rows: [],
  saldoAnteriorCents: null,
  saldoFinalCents: null,
  corrections: 0,
  accountHint: null,
};

/** Texto do PDF. pdf-parse entra por import dinamico: so carrega quando chega um PDF. */
export async function pdfToText(buffer: Uint8Array): Promise<string> {
  await loadDomGlobals();
  const { PDFParse } = await import('pdf-parse');
  // copia: pdf-parse transfere o array para o worker e o do chamador fica destacado,
  // o que quebraria um segundo import do mesmo arquivo
  const parser = new PDFParse({ data: new Uint8Array(buffer) });
  try {
    const result = await parser.getText();
    return result.text;
  } finally {
    await parser.destroy();
  }
}

/**
 * O pdf.js instancia um `DOMMatrix` global ao carregar, mesmo quando so vamos
 * extrair texto, e espera que o `@napi-rs/canvas` defina esse global. O
 * pdf-parse nao carrega o canvas sozinho: sem este import o binario nativo
 * nao entra no processo e o import de PDF morre com "DOMMatrix is not defined".
 */
async function loadDomGlobals(): Promise<void> {
  if (globalThis.DOMMatrix) return;
  const canvas = await import('@napi-rs/canvas');
  globalThis.DOMMatrix ??= canvas.DOMMatrix as unknown as typeof globalThis.DOMMatrix;
  globalThis.ImageData ??= canvas.ImageData as unknown as typeof globalThis.ImageData;
  globalThis.Path2D ??= canvas.Path2D as unknown as typeof globalThis.Path2D;
}

const JPEG_START = Buffer.from([0xff, 0xd8, 0xff]);
const JPEG_END = Buffer.from([0xff, 0xd9]);

/**
 * JPEGs embutidos no PDF. O extrato da Caixa vem como um print em JPEG dentro
 * do PDF (pdfmake), sem nenhuma fonte: sem isso nao ha o que ler.
 */
export function pdfImages(buffer: Uint8Array): Uint8Array[] {
  const bytes = Buffer.from(buffer);
  const images: Uint8Array[] = [];
  let from = 0;
  while (from < bytes.length) {
    const start = bytes.indexOf(JPEG_START, from);
    if (start < 0) break;
    const end = bytes.indexOf(JPEG_END, start + 2);
    if (end < 0) break;
    images.push(new Uint8Array(bytes.subarray(start, end + 2)));
    from = end + 2;
  }
  return images;
}

/** Texto do PDF normalizado: uma linha por elemento, sem espaco duplicado. */
function lines(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((raw) => raw.replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim())
    .filter(Boolean);
}

// linha de saldo/total nao e lancamento
const SKIP = /^(saldo|total|subtotal|totais)\b/i;
const isNoise = (description: string) => !description || SKIP.test(stripAccents(description));

/** D = saida (negativo), C = entrada (positivo). */
function signed(cents: number, marker: string): number {
  return marker.toUpperCase() === 'D' ? -Math.abs(cents) : Math.abs(cents);
}

/** Extrato quase sempre tem data sem ano (05/10); o ano sai do periodo do proprio PDF. */
function inferYear(text: string): number {
  const counts = new Map<number, number>();
  for (const match of text.matchAll(/\b\d{2}\/\d{2}\/(\d{4})\b/g)) {
    const year = Number(match[1]);
    counts.set(year, (counts.get(year) ?? 0) + 1);
  }
  let best = 0;
  let bestCount = 0;
  for (const [year, count] of counts) {
    if (count > bestCount) {
      best = year;
      bestCount = count;
    }
  }
  return best || new Date().getFullYear();
}

/** Aceita dd/mm/aaaa, dd/mm/aa e dd/mm (completando com o ano do extrato). */
function toIsoDate(rawDate: string, year: number): string {
  if (/^\d{2}\/\d{2}$/.test(rawDate)) return parseDateToISO(`${rawDate}/${year}`);
  if (/^\d{2}\/\d{2}\/\d{2}$/.test(rawDate)) return parseDateToISO(`${rawDate.slice(0, 6)}20${rawDate.slice(6)}`);
  return parseDateToISO(rawDate);
}

// data + descricao + valor (opcional R$, sinal e sufixo D/C)
const LINE =
  /^(\d{2}\/\d{2}(?:\/\d{2,4})?)\s+(.+?)\s+(-?\s?(?:R\$\s*)?\d{1,3}(?:\.\d{3})*,\d{2}|-?\s?(?:R\$\s*)?\d+,\d{2})\s*([DCdc])?$/;

/**
 * Marcadores que um extrato de verdade carrega no cabecalho. O parser generico
 * aceita qualquer "data + descricao + valor", entao sem essa guarda um boleto,
 * uma nota fiscal ou um contrato viraria lancamento.
 */
const STATEMENT_MARKER = /extrato|movimentacao|lancamentos|conta corrente/;

export function looksLikeStatement(text: string): boolean {
  return STATEMENT_MARKER.test(stripAccents(text).toLowerCase());
}

/**
 * Lancamentos de um extrato em PDF com camada de texto, linha a linha:
 *   05/10/2026 PIX ENVIADO JANISLEYDE 117,00 D
 *   07/10 DEPOSITO RECEBIDO 400,00 C
 * O que nao casa com o padrao (cabecalho, rodape, quebra de pagina) e ignorado.
 */
// shortcut: uma linha = um lancamento; descricao quebrada em duas linhas nao e remontada,
// porque sem as coordenadas da coluna nao da para saber onde o texto do banco termina.
export function parsePdfText(text: string): ParsedRow[] {
  const rows: ParsedRow[] = [];
  const year = inferYear(text);

  for (const line of lines(text)) {
    const match = LINE.exec(line);
    if (!match) continue;

    const description = match[2]!.trim();
    if (isNoise(description)) continue;

    try {
      const cents = parseAmountToCents(match[3]!);
      const amountCents = match[4] ? signed(cents, match[4]) : cents;
      // "Abertura R$ 0,00 R$ 0,00" e o saldo inicial, nao um lancamento
      if (amountCents === 0) continue;
      rows.push({ postedAt: toIsoDate(match[1]!, year), amountCents, description });
    } catch {
      // linha com cara de lancamento mas valor/data invalida: ignora em vez de quebrar o import
    }
  }
  return rows;
}

// 21/09/2026 - 12:00:24 211200 <historico favorecido CPF> 45,00 D 0,99 C
const CAIXA_HEAD = /^(\d{2}\/\d{2}\/\d{4})\s*-\s*(\d{2}:\d{2}:\d{2})\s+\d{4,8}\s+(.*)$/;
const CAIXA_SALDO = /(\d{1,3}(?:\.\d{3})*,\d{2})\s*([DC])\s*$/;
// o valor pode perder a virgula no OCR ("849D"); a conferencia de saldo reconstroi
const CAIXA_VALOR = /(\d[\d.]*(?:,\d{2})?)\s*([DC])\s*$/;
const CAIXA_ANTERIOR = /SALDO\s+ANTERIOR[^\d]*(\d{1,3}(?:\.\d{3})*,\d{2})\s*([DC])/i;
const CAIXA_CONTA = /\bConta\s+(\d{3,6})\s*\//i;

interface CaixaLine {
  postedAt: string;
  time: string;
  description: string;
  amountCents: number | null;
  saldoCents: number;
}

/**
 * Extrato da Caixa (texto extraido ou OCR): cada linha traz data, hora, numero
 * do documento, historico, favorecido/CPF, valor e o saldo corrente.
 * O favorecido e o CPF saem embaralhados no OCR, entao a descricao fica com o
 * historico em maiusculas e limita-se ao nome que estiver legivel.
 */
export function parseCaixaText(text: string): PdfExtract {
  const parsed: CaixaLine[] = [];

  for (const line of lines(text)) {
    const head = CAIXA_HEAD.exec(line);
    if (!head) continue;

    const saldo = CAIXA_SALDO.exec(head[3]!);
    if (!saldo) continue;

    const beforeSaldo = head[3]!.slice(0, saldo.index);
    const valor = CAIXA_VALOR.exec(beforeSaldo);
    const description = caixaDescription(valor ? beforeSaldo.slice(0, valor.index) : beforeSaldo);
    if (isNoise(description)) continue;

    try {
      parsed.push({
        postedAt: parseDateToISO(head[1]!),
        time: head[2]!,
        description,
        amountCents: valor ? signed(parseAmountToCents(valor[1]!), valor[2]!) : null,
        saldoCents: signed(parseAmountToCents(saldo[1]!), saldo[2]!),
      });
    } catch {
      // linha ilegivel: fica de fora e a conferencia de saldo acusa a diferenca
    }
  }

  const anterior = CAIXA_ANTERIOR.exec(text);
  const saldoAnteriorCents = anterior ? signed(parseAmountToCents(anterior[1]!), anterior[2]!) : null;

  // o extrato vem fora de ordem (blocos por dia, do mais recente para o mais antigo):
  // encadeia em ordem cronologica e tira o valor da diferenca de saldo, que e o
  // unico numero que o proprio banco conferiu duas vezes
  const ordered = [...parsed].sort(
    (a, b) => a.postedAt.localeCompare(b.postedAt) || a.time.localeCompare(b.time),
  );

  let corrections = 0;
  let previous = saldoAnteriorCents;
  for (const row of ordered) {
    if (previous !== null) {
      const delta = row.saldoCents - previous;
      if (row.amountCents !== delta) {
        row.amountCents = delta;
        corrections++;
      }
    }
    previous = row.saldoCents;
  }

  const conta = CAIXA_CONTA.exec(text);

  return {
    rows: ordered
      .filter((row): row is CaixaLine & { amountCents: number } => row.amountCents !== null)
      .map(({ saldoCents: _saldo, time: _time, ...row }) => row),
    saldoAnteriorCents,
    saldoFinalCents: ordered.at(-1)?.saldoCents ?? null,
    corrections,
    accountHint: conta ? `caixa-${conta[1]}` : null,
  };
}

const isAllCaps = (word: string) => /^[A-ZÀ-Ú0-9][A-ZÀ-Ú0-9./-]*$/.test(word);
const isCapitalized = (word: string) => /^[A-ZÀ-Ú][a-zà-ú]+$/.test(word);

/** Historico em maiusculas e, se estiver legivel, o favorecido como nome proprio. */
function caixaDescription(middle: string): string {
  const words = middle.split(' ');
  let end = 0;
  while (end < words.length && isAllCaps(words[end]!)) end++;
  while (end < words.length && isCapitalized(words[end]!)) end++;
  return words.slice(0, end).join(' ');
}

// 03/09/2026 5,07 (-) 13105 90301 Pix - Enviado   (o resto e lote, documento e historico)
const BB_HEAD = /^(\d{2}\/\d{2}\/\d{4})\s+(\d{1,3}(?:\.\d{3})*,\d{2})\s*\(([+-])\)\s*(.*)$/;
const BB_CONTA = /\bConta:\s*(\d+-\d+)/;
// em "Informacoes Adicionais" a celula vem sem data: "0,00 (+)  Saldo"
const BB_SALDO_CELL = /^(\d{1,3}(?:\.\d{3})*,\d{2})\s*\(([+-])\)\s*S\s?A\s?L\s?D\s?O\s*$/i;
// cabecalho de secao ou rodape: nao e continuacao de historico
const BB_SECTION = /^(extrato|cliente|ag[eê]ncia|lan[cç]amentos|dia\b|sem lan[cç]amentos|informa[cç][oõ]es|total|--)/i;
// hora que o BB repete antes do favorecido ("03/09 21:56 Elias Sousa Campos")
const BB_STAMP = /^\d{2}\/\d{2}\s+\d{2}:\d{2}\s+/;

/** "13105 90301 Pix - Enviado" -> "Pix - Enviado": lote e documento nao sao historico. */
function bbDescription(rest: string): string {
  const words = rest.split(' ');
  let start = 0;
  while (start < words.length && /^\d+$/.test(words[start]!)) start++;
  return words.slice(start).join(' ').trim();
}

/**
 * Extrato do Banco do Brasil com camada de texto:
 *   Dia Documento Valor  Lote Historico
 *   03/09/2026 5,07 (-)  13105 90301 Pix - Enviado
 *   03/09 21:56 Elias Sousa Campos          <- favorecido, sem valor
 *   30/09/2026 0,00 (+)  S A L D O          <- saldo final
 * "Saldo Anterior" abre a cadeia, "Saldo do dia" e fechamento parcial (ignorado)
 * e qualquer linha sem valor apenas completa o historico anterior.
 */
export function parseBbText(text: string): PdfExtract {
  const rows: ParsedRow[] = [];
  let anterior: number | null = null;
  let final: number | null = null;
  let current: ParsedRow | null = null;

  for (const line of lines(text)) {
    const cell = BB_SALDO_CELL.exec(line);
    if (cell) {
      const cents = parseAmountToCents(cell[1]!);
      final = cell[2] === '-' ? -Math.abs(cents) : Math.abs(cents);
      current = null;
      continue;
    }

    const head = BB_HEAD.exec(line);
    if (head) {
      const label = stripAccents(head[4]!).toUpperCase().replace(/\s+/g, '');
      const cents = parseAmountToCents(head[2]!);
      const value = head[3] === '-' ? -Math.abs(cents) : Math.abs(cents);

      if (label === 'SALDOANTERIOR') {
        anterior = value;
        current = null;
        continue;
      }
      if (label === 'SALDODODIA') {
        current = null;
        continue;
      }
      if (label === 'SALDO') {
        final = value;
        current = null;
        continue;
      }

      const description = bbDescription(head[4]!);
      if (!description) continue;
      current = { postedAt: parseDateToISO(head[1]!), amountCents: value, description };
      rows.push(current);
      continue;
    }

    if (!current || BB_SECTION.test(line)) continue;
    const extra = line.replace(BB_STAMP, '').trim();
    // o BB repete o historico na linha de baixo ("BB Rende Facil" / "Rende Facil")
    const seen = stripAccents(current.description).toLowerCase();
    if (extra && !seen.includes(stripAccents(extra).toLowerCase())) {
      current.description = `${current.description} ${extra}`;
    }
  }

  const conta = BB_CONTA.exec(text);

  return {
    rows,
    saldoAnteriorCents: anterior,
    saldoFinalCents: final,
    corrections: 0,
    accountHint: conta ? `bb-${conta[1]}` : null,
  };
}

/** 1..12 a partir do nome do mes em portugues, com ou sem acento. */
function monthIndex(name: string): number {
  const key = stripAccents(name).toLowerCase();
  return MONTHS.findIndex((month) => stripAccents(month).toLowerCase() === key) + 1;
}

/** Linhas cruas: nas tabelas de extrato cada celula chega separada por tabulacao. */
function rawLines(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.replace(/\u00a0/g, ' ').trim())
    .filter(Boolean);
}

const onlyDigits = (value: string) => value.replace(/\D/g, '');

/** "01.045830-1" / "01.045830.1" -> "conta-010458301" (as duas versoes Santander). */
function santanderAccountHint(text: string): string | null {
  const match = /\b\d{2}\.\d{6}[.\-]\d\b/.exec(text);
  return match ? `conta-${onlyDigits(match[0])}` : null;
}

// 14 de novembro 2026 Saldo ao final do dia: R$ 62,60
const PICPAY_DAY = /^(\d{1,2}) de (\S+) (\d{4})\s+Saldo ao final do dia:\s*R\$\s*([\d.,]+)/i;
// 21:28 Pix enviado −R$ 5,00	99 TECNOLOGIA LTDA Com saldo
const PICPAY_TX = /^(\d{2}:\d{2})\s+(.+?)\s+([−–+-]\s*R\$\s*[\d.,]+)\s*(.*)$/;
// rodape/cabecalho que fecha a descricao pendente
const PICPAY_NOISE =
  /^(documento emitido|d[uú]vidas\?|-- \d+ of \d+ --|\d+ de \d+$|cpf:|hora tipo valor|per[ií]odo$|extrato de conta|r\$ )/i;

/** "99 TECNOLOGIA LTDA Com saldo" -> { text: "99 TECNOLOGIA LTDA", done: true }. */
function withoutComSaldo(raw: string): { text: string; done: boolean } {
  const match = /\s*Com saldo\s*$/i.exec(raw);
  if (!match) return { text: raw.trim(), done: false };
  return { text: raw.slice(0, match.index).trim(), done: true };
}

/**
 * Extrato do PicPay: um cabecalho de dia com o saldo de fechamento e, abaixo,
 * as linhas de hora/tipo/valor. O documento e newest-first, a descricao pode
 * quebrar em duas ou tres linhas e o cabecalho do mesmo dia se repete no topo
 * de cada pagina (nao pode reiniciar o dia nem duplicar o saldo).
 */
export function parseNubankText(text: string): PdfExtract {
  const source = rawLines(text);
  if (!source.some((line) => /movimenta/i.test(line)) || !source.some((line) => /total de (entradas|saidas|saídas)/i.test(line))) {
    return { ...NOTHING };
  }

  const MONTHS_PT: Record<string, number> = {
    jan: 1, fev: 2, mar: 3, abr: 4, mai: 5, jun: 6,
    jul: 7, ago: 8, set: 9, out: 10, nov: 11, dez: 12,
  };

  const rows: ParsedRow[] = [];
  let currentDate: string | null = null;
  let direction: 'in' | 'out' | null = null;
  let description: string[] = [];

  const flush = () => {
    const desc = description.join(' ').replace(/\s+/g, ' ').trim();
    description = [];
    // amount is handled separately; this just clears
    void desc;
  };

  const amountRe = /^-?[\d.]+,\d{2}$/;
  const dateRe = /^(\d{2})\s+(JAN|FEV|MAR|ABR|MAI|JUN|JUL|AGO|SET|OUT|NOV|DEZ)\s+(\d{4})/i;

  for (const rawLine of source) {
    const line = rawLine.trim();
    if (!line) continue;

    // page header / footer / noise
    if (/extrato gerado|tem alguma duvida|ouvidoria|atendimento 24|valores em r\$|cpf|agencia conta|^movimenta|nubank\.com/i.test(line)) {
      continue;
    }
    if (/^(Elias|•)/.test(line)) continue;
    if (/^\d{1,2} de \d{1,2} de \d{4}/.test(line)) continue;

    const dateMatch = dateRe.exec(line);
    if (dateMatch) {
      // flush pending description without amount (shouldn't happen)
      description = [];
      const day = dateMatch[1]!;
      const mon = MONTHS_PT[dateMatch[2]!.toLowerCase().slice(0, 3)]!;
      const year = dateMatch[3]!;
      currentDate = `${year}-${String(mon).padStart(2, '0')}-${day}`;
      // same line may declare the section
      if (/total de entradas/i.test(line)) direction = 'in';
      else if (/total de sa[ií]das/i.test(line)) direction = 'out';
      continue;
    }

    if (/^total de entradas/i.test(line)) { direction = 'in'; continue; }
    if (/^total de sa[ií]das/i.test(line)) { direction = 'out'; continue; }

    // linha com descricao + valor no fim ("Deposito Recebido por Boleto 138,00")
    const inline = /^(.+?)\s+(-?[\d.]+,\d{2})$/.exec(line);
    if (inline && !/^total de/i.test(line)) {
      description.push(inline[1]!.trim());
      // process amount below
      const amtLine = inline[2]!;
      if (currentDate && direction && description.length > 0) {
        const cents = parseAmountToCents(amtLine);
        const signed = direction === 'out' ? -Math.abs(cents) : Math.abs(cents);
        const desc = description.join(' ').replace(/\s+/g, ' ').trim();
        if (desc.length > 0) rows.push({ postedAt: currentDate, description: desc, amountCents: signed });
      }
      description = [];
      continue;
    }

    if (amountRe.test(line)) {
      if (!currentDate || !direction || description.length === 0) {
        description = [];
        continue;
      }
      const cents = parseAmountToCents(line);
      const signed = direction === 'out' ? -Math.abs(cents) : Math.abs(cents);
      const desc = description.join(' ').replace(/\s+/g, ' ').trim();
      if (desc.length > 0) {
        rows.push({ postedAt: currentDate, description: desc, amountCents: signed });
      }
      description = [];
      continue;
    }

    // skip pure summary/total lines that slipped through
    if (/^total de/i.test(line)) continue;

    description.push(line);
  }

  if (rows.length === 0) return { ...NOTHING };
  return { rows, saldoAnteriorCents: null, saldoFinalCents: null, corrections: 0, accountHint: 'nubank' };
}

export function parsePicPayText(text: string): PdfExtract {
  const source = lines(text);
  if (!source.some((line) => PICPAY_DAY.test(line))) return { ...NOTHING };

  interface PicRow extends ParsedRow {
    time: string;
  }

  const rows: PicRow[] = [];
  const dayEnd = new Map<string, number>();
  let currentDate: string | null = null;
  let pending: PicRow | null = null;

  const flush = () => {
    if (pending) {
      rows.push(pending);
      pending = null;
    }
  };

  for (const line of source) {
    const day = PICPAY_DAY.exec(line);
    if (day) {
      flush();
      const month = monthIndex(day[2]!);
      if (month === 0) {
        currentDate = null;
        continue;
      }
      try {
        currentDate = parseDateToISO(
          `${day[1]!.padStart(2, '0')}/${String(month).padStart(2, '0')}/${day[3]}`,
        );
        dayEnd.set(currentDate, parseAmountToCents(day[4]!));
      } catch {
        currentDate = null;
      }
      continue;
    }

    const tx = PICPAY_TX.exec(line);
    if (tx) {
      flush();
      if (!currentDate) continue;
      const rest = withoutComSaldo(tx[4]!);
      try {
        pending = {
          postedAt: currentDate,
          time: tx[1]!,
          description: `${tx[2]!.trim()}${rest.text ? ` ${rest.text}` : ''}`,
          amountCents: parseAmountToCents(tx[3]!),
        };
      } catch {
        pending = null;
        continue;
      }
      if (rest.done) flush();
      continue;
    }

    if (!pending) continue;
    if (PICPAY_NOISE.test(line)) {
      flush();
      continue;
    }
    const extra = withoutComSaldo(line);
    if (extra.text) pending.description = `${pending.description} ${extra.text}`;
    if (extra.done) flush();
  }
  flush();

  if (rows.length === 0) return { ...NOTHING };

  const ordered = [...rows].sort(
    (a, b) => a.postedAt.localeCompare(b.postedAt) || a.time.localeCompare(b.time),
  );

  // saldo de fechamento de cada dia: o primeiro dia da o saldo anterior ao
  // extrato e o ultimo da o saldo final; a soma no meio fecha a cadeia inteira.
  const daySum = new Map<string, number>();
  for (const row of ordered) {
    daySum.set(row.postedAt, (daySum.get(row.postedAt) ?? 0) + row.amountCents);
  }
  const days = [...daySum.keys()].sort();
  const firstDay = days[0]!;
  const lastDay = days.at(-1)!;
  const firstEnd = dayEnd.get(firstDay);
  const saldoAnteriorCents = firstEnd === undefined ? null : firstEnd - daySum.get(firstDay)!;
  const saldoFinalCents = dayEnd.get(lastDay) ?? null;

  const conta = /\bConta:\s*([\d.\-]+)/i.exec(text);

  return {
    rows: ordered.map(({ time: _time, ...row }) => row),
    saldoAnteriorCents,
    saldoFinalCents,
    corrections: 0,
    accountHint: conta ? `picpay-${onlyDigits(conta[1]!)}` : null,
  };
}

// valor de uma celula: "837,25", "200,00-", "- R$ 12,00"; nunca "011020" (sem virgula)
const MONEY_CELL = /^[-−–]?\s*(?:R\$\s*)?\d{1,3}(?:\.\d{3})*,\d{2}\s*-?$/;

/**
 * Extrato consolidado do Santander ("EXTRATO CONSOLIDADO INTELIGENTE"): a
 * tabela "Movimentacao" traz data, descricao (as vezes na linha seguinte),
 * numero do documento e movimento/saldo. O resto do PDF (comprovantes,
 * indices, saldos por periodo) tem os mesmos valores em outro arranjo e nao
 * pode ser lido junto, senao cada lancamento entra duas vezes.
 */
export function parseSantanderConsolidadoText(text: string): PdfExtract {
  const source = rawLines(text);
  const start = source.findIndex((line) => stripAccents(line).toLowerCase() === 'movimentacao');
  if (start < 0) return { ...NOTHING };

  const period =
    /(janeiro|fevereiro|março|marco|abril|maio|junho|julho|agosto|setembro|outubro|novembro|dezembro)\s*\/\s*(\d{4})/i.exec(
      text,
    );
  const statementMonth = period ? monthIndex(period[1]!) : 0;
  const year = period ? Number(period[2]) : new Date().getFullYear();

  interface Row extends ParsedRow {
    saldoCents: number | null;
  }

  const rows: Row[] = [];
  let currentDate: string | null = null;
  let parts: string[] = [];
  let anterior: number | null = null;
  let final: number | null = null;

  for (const line of source.slice(start + 1)) {
    const plain = stripAccents(line).toLowerCase();

    if (plain.startsWith('comprovantes de pagamento')) break;
    if (
      plain.startsWith('data ') ||
      /^-- \d+ of \d+ --/.test(plain) ||
      plain.startsWith('extrato_pf') ||
      plain.startsWith('balp_') ||
      plain.startsWith('pagina:')
    ) {
      continue;
    }

    const cells = line.split('\t').map((cell) => cell.trim());

    if (plain.startsWith('saldo em')) {
      const value = [...cells].reverse().find((cell) => MONEY_CELL.test(cell));
      if (value) {
        const cents = parseAmountToCents(value);
        if (rows.length === 0 && anterior === null) {
          anterior = cents; // saldo em 30/09, logo antes do primeiro lancamento
        } else {
          final = cents; // saldo em 31/10, depois do ultimo
          break;
        }
      }
      continue;
    }

    const dm = /^(\d{2})\/(\d{2})$/.exec(cells[0] ?? '');
    if (dm) {
      const month = Number(dm[2]);
      const dateYear = statementMonth > 0 && month > statementMonth ? year - 1 : year;
      try {
        currentDate = parseDateToISO(`${dm[1]}/${dm[2]}/${dateYear}`);
      } catch {
        currentDate = null;
      }
      parts = cells.slice(1).filter((cell) => cell && cell !== '-');
      continue;
    }

    const moneyIndexes = cells
      .map((cell, index) => (MONEY_CELL.test(cell) ? index : -1))
      .filter((index) => index >= 0);
    if (moneyIndexes.length > 0) {
      if (!currentDate) continue;
      const amountIndex = moneyIndexes[0]!;
      // a descricao pode estar na mesma linha do valor ("PIX ENVIADO PJBANK ... - 255,69-")
      parts.push(
        ...cells.slice(0, amountIndex).filter((cell) => cell && cell !== '-' && !/^\d{4,10}$/.test(cell)),
      );
      const description = parts.join(' ').trim();
      parts = [];
      if (!description) continue;
      try {
        rows.push({
          postedAt: currentDate,
          amountCents: parseAmountToCents(cells[amountIndex]!),
          description,
          saldoCents:
            moneyIndexes.length > 1 ? parseAmountToCents(cells[moneyIndexes[1]!]!) : null,
        });
      } catch {
        // linha ilegivel: a conferencia de saldo acusa a diferenca
      }
      continue;
    }

    if (!currentDate || /^cnpj\b/i.test(plain)) continue;
    parts.push(line.replace(/\s+/g, ' '));
  }

  let corrections = 0;
  let previous = anterior;
  for (const row of rows) {
    if (previous !== null && row.saldoCents !== null) {
      const delta = row.saldoCents - previous;
      if (delta !== row.amountCents) {
        row.amountCents = delta;
        corrections++;
      }
      previous = row.saldoCents;
    } else if (previous !== null) {
      previous += row.amountCents;
    }
  }
  if (final === null) final = previous;

  return {
    rows: rows.map(({ saldoCents: _saldo, ...row }) => row),
    saldoAnteriorCents: anterior,
    saldoFinalCents: final,
    corrections,
    accountHint: santanderAccountHint(text),
  };
}

/**
 * Extrato simples do Santander ("DETALHE DOS MOVIMENTOS"): a data vem numa
 * linha, a descricao (e a contraparte) nas seguintes e o valor com o saldo
 * depois do lancamento fecha a linha. Vem do mais novo para o mais antigo.
 * "Abertura" e o saldo inicial, nao um lancamento.
 */
export function parseSantanderExtratoText(text: string): PdfExtract {
  const source = rawLines(text);
  const start = source.findIndex((line) =>
    stripAccents(line).toLowerCase().startsWith('detalhe dos movimentos'),
  );
  if (start < 0) return { ...NOTHING };

  interface Row extends ParsedRow {
    saldoCents: number;
  }

  const rows: Row[] = [];
  let currentDate: string | null = null;
  let parts: string[] = [];
  let anterior: number | null = null;
  let lastRow: Row | null = null;
  let awaitingCounterpart = false;

  for (const line of source.slice(start + 1)) {
    const plain = stripAccents(line).toLowerCase();

    if (plain.startsWith('data ') || /^(segunda|terca|quarta|quinta|sexta|sabado|domingo)/.test(plain)) {
      continue;
    }

    const date = /^(\d{2}\/\d{2}\/\d{4})\b(.*)$/.exec(line);
    if (date) {
      const rest = date[2]!.trim();
      const opening = /^abertura\s+(?:R\$\s*)?([\d.,]+)\s+(?:R\$\s*)?([\d.,]+)/i.exec(rest);
      if (opening) {
        anterior = parseAmountToCents(opening[2]!);
        currentDate = null;
        parts = [];
        lastRow = null;
        awaitingCounterpart = false;
        continue;
      }
      try {
        currentDate = parseDateToISO(date[1]!);
      } catch {
        currentDate = null;
      }
      parts = rest ? [rest] : [];
      lastRow = null;
      awaitingCounterpart = false;
      continue;
    }

    const value = /^(-)?\s*(?:R\$\s*)?(\d{1,3}(?:\.\d{3})*,\d{2})\s+R\$\s*(\d{1,3}(?:\.\d{3})*,\d{2})$/.exec(
      line,
    );
    if (value && currentDate) {
      const description = parts.join(' ').trim();
      parts = [];
      if (!description) continue;
      try {
        const row: Row = {
          postedAt: currentDate,
          amountCents: parseAmountToCents(`${value[1] ? '-' : ''}${value[2]!}`),
          description,
          saldoCents: parseAmountToCents(value[3]!),
        };
        rows.push(row);
        lastRow = row;
        awaitingCounterpart = true;
      } catch {
        // valor ilegivel: fica de fora e a cadeia de saldo acusa
      }
      continue;
    }

    // linha seguinte ao valor e a contraparte do Pix ("Janisleyde Silva Camp")
    if (awaitingCounterpart && lastRow) {
      if (line && !/^--|\d+\/\d+$/.test(line)) {
        lastRow.description = `${lastRow.description} ${line.replace(/\s+/g, ' ')}`;
      }
      awaitingCounterpart = false;
      continue;
    }

    if (currentDate && !/^--|\d+\/\d+$/.test(line)) parts.push(line.replace(/\s+/g, ' '));
  }

  // o documento e newest-first: encadeia do mais antigo para o mais novo
  rows.reverse();

  let corrections = 0;
  let previous = anterior;
  for (const row of rows) {
    if (previous !== null) {
      const delta = row.saldoCents - previous;
      if (delta !== row.amountCents) {
        row.amountCents = delta;
        corrections++;
      }
    }
    previous = row.saldoCents;
  }

  return {
    rows: rows.map(({ saldoCents: _saldo, ...row }) => row),
    saldoAnteriorCents: anterior,
    saldoFinalCents: rows.at(-1)?.saldoCents ?? anterior,
    corrections,
    accountHint: santanderAccountHint(text),
  };
}

/** Lancamentos + saldos de um PDF, seja ele texto, seja imagem (OCR). */
export async function parsePdfDocument(buffer: Uint8Array): Promise<PdfExtract & { via: 'texto' | 'ocr'; text: string }> {
  const text = await pdfToText(buffer);
  return { ...(await parsePdfDocumentText(text, buffer)), text };
}

/** Separado do PDF em si: o texto tambem decide se o arquivo e fatura de cartao. */
async function parsePdfDocumentText(text: string, buffer: Uint8Array): Promise<PdfExtract & { via: 'texto' | 'ocr' }> {

  // celula de saldo conta como extrato reconhecido mesmo sem lancamento no periodo
  const bb = parseBbText(text);
  if (bb.rows.length > 0 || bb.saldoFinalCents !== null) return { ...bb, via: 'texto' };

  const caixa = parseCaixaText(text);
  if (caixa.rows.length > 0) return { ...caixa, via: 'texto' };

  const picpay = parsePicPayText(text);
  if (picpay.rows.length > 0 || picpay.saldoFinalCents !== null) return { ...picpay, via: 'texto' };

  const nubank = parseNubankText(text);
  if (nubank.rows.length > 0) return { ...nubank, via: 'texto' };

  // a versao consolidada vem antes do extrato simples: ela tem a secao
  // "Movimentacao"; a simples, "DETALHE DOS MOVIMENTOS"
  const consolidado = parseSantanderConsolidadoText(text);
  if (consolidado.rows.length > 0 || consolidado.saldoFinalCents !== null) return { ...consolidado, via: 'texto' };

  const conta = parseSantanderExtratoText(text);
  if (conta.rows.length > 0 || conta.saldoFinalCents !== null) return { ...conta, via: 'texto' };

  const generic = parsePdfText(text);
  if (generic.length > 0) {
    // o formato especifico nao reconheceu: so aceita o generico quando o
    // documento se apresenta como extrato e tem mais de uma linha. Sem isso um
    // boleto/contrato com data e valor no meio viraria importacao.
    if (!looksLikeStatement(text)) {
      throw new Error(
        'o PDF nao parece um extrato: achei datas e valores, mas nenhum cabecalho de extrato ou movimentacao; confira se e o arquivo certo',
      );
    }
    if (generic.length < 2) {
      throw new Error('o PDF tem so uma linha com data e valor: nao reconheci o formato do extrato');
    }
    return { ...NOTHING, rows: generic, via: 'texto' };
  }

  // OCR e caro (~7 s) e um PDF comum (contrato, boleto) tambem pode embutir
  // imagem: so vale a pena quando quase nao ha camada de texto, como no print
  // da Caixa (16 caracteres).
  const textChars = text.replace(/-- \d+ of \d+ --/g, '').replace(/\s+/g, '').length;
  if (textChars > 200) return { ...NOTHING, via: 'texto' };

  // sem camada de texto: sobra OCR da imagem embutida
  const images = pdfImages(buffer);
  if (images.length === 0) return { ...NOTHING, via: 'texto' };

  const { ocrImages } = await import('./ocr.ts');
  const recognized = await ocrImages(images);
  const fromOcr = parseCaixaText(recognized);
  return { ...(fromOcr.rows.length > 0 ? fromOcr : parseBbText(recognized)), via: 'ocr' };
}
