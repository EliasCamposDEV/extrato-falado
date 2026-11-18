import PDFDocument from 'pdfkit';

import type { Db } from './db.ts';
import { MONTHS } from './domain/vocab.ts';
import { brl, describePeriod, shortDate } from './query/render.ts';
import type { QuerySpec } from './query/spec.ts';
import type { executeSpec } from './query/execute.ts';
import type { StatementRow } from './stats.ts';

export interface AskPayload {
  question: string;
  spec: QuerySpec;
  sql: string;
  params: (string | number)[];
  outcome: ReturnType<typeof executeSpec>;
  answer: string;
  ms: number;
  planner: string;
  followUp: boolean;
  guard?: string;
}

function monthLabel(month: string): string {
  const [year, number] = month.split('-');
  return `${MONTHS[Number(number) - 1] ?? number} de ${year}`;
}

function money(cents: number): string {
  const value = (Math.abs(cents) / 100).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return `${cents < 0 ? '-' : '+'} R$ ${value}`;
}

/** Valor sem sinal, para linhas que já dizem entradas/saídas. */
const magnitude = (cents: number) => money(Math.abs(cents)).replace('+ ', '');

function pdfToBuffer(build: (doc: PDFKit.PDFDocument) => void): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 40 });
    const chunks: Buffer[] = [];
    doc.on('data', (chunk: Buffer) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    try {
      build(doc);
      doc.end();
    } catch (err) {
      reject(err);
    }
  });
}

/**
 * Super extrato: todos os lancamentos, ordenados por mes, conta e data,
 * com subtotal por mes e resumo por conta. E o papel que fecha o mes.
 */
export function buildStatementPdf(db: Db, options?: { source?: string; from?: string; to?: string; account?: string; includeInternal?: boolean }): Promise<Buffer> {
  const source = options?.source;
  const account = options?.account;
  const includeInternal = options?.includeInternal;
  const clauses: string[] = [];
  const params: (string | number)[] = [];
  if (source && source !== 'all') { clauses.push('source = ?'); params.push(source); }
  if (account) { clauses.push('account = ?'); params.push(account); }
  if (options?.from) { clauses.push('posted_at >= ?'); params.push(options.from); }
  if (options?.to) { clauses.push('posted_at <= ?'); params.push(options.to); }
  if (!includeInternal) clauses.push('is_internal_transfer = 0');
  const where = clauses.length ? 'WHERE ' + clauses.join(' AND ') : '';
  const rows = db
    .prepare(
      `SELECT posted_at, account, description, merchant, category, amount_cents
       FROM transactions ${where}
       ORDER BY posted_at ASC, account ASC, ABS(amount_cents) DESC`,
    )
    .all(...params) as unknown as StatementRow[];

  return pdfToBuffer((doc) => {
    const left = 40;
    const right = 555;
    const pageBottom = 772;
    const columns = { date: 40, account: 112, desc: 186, category: 372, value: 468 };

    let y = 0;

    const tableHeader = () => {
      doc.font('Helvetica-Bold').fontSize(8).fillColor('#5F6F63');
      doc.text('DATA', columns.date, y, { lineBreak: false });
      doc.text('CONTA', columns.account, y, { lineBreak: false });
      doc.text('DESCRIÇÃO', columns.desc, y, { lineBreak: false });
      doc.text('CATEGORIA', columns.category, y, { lineBreak: false });
      doc.text('VALOR', columns.value, y, { width: right - columns.value, align: 'right' });
      doc.moveTo(left, y + 12).lineTo(right, y + 12).strokeColor('#CFC6B2').stroke();
      y += 20;
    };

    const addPage = () => {
      doc.addPage();
      y = 48;
      tableHeader();
    };

    const ensure = (needed: number) => {
      if (y + needed > pageBottom) addPage();
    };

    // capa
    doc.font('Helvetica-Bold').fontSize(18).fillColor('#1A2536').text('Extrato Falado', left, 40);
    doc.font('Helvetica').fontSize(10).fillColor('#454F5E').text('Super extrato — lançamentos consolidados', left, 64);
    // periodo do papel: o recorte pedido ou, sem recorte, a primeira e a ultima data do banco
    const period = options?.from && options?.to
      ? `${shortDate(options.from)} a ${shortDate(options.to)}`
      : rows.length
        ? `${shortDate(rows[0]!.posted_at)} a ${shortDate(rows[rows.length - 1]!.posted_at)}`
        : 'sem lançamentos';
    doc.fontSize(9).fillColor('#5F6F63').text(
      `Gerado em ${new Date().toLocaleString('pt-BR')} · ${rows.length} lançamentos · ${period}`,
      left,
      80,
    );

    // resumo geral
    let totalIn = 0;
    let totalOut = 0;
    for (const row of rows) {
      if (row.amount_cents > 0) totalIn += row.amount_cents;
      else totalOut += row.amount_cents;
    }

    y = 108;
    doc.font('Helvetica-Bold').fontSize(10).fillColor('#1A2536').text('Resumo', left, y);
    y += 16;
    doc.font('Helvetica').fontSize(9).fillColor('#454F5E');
    doc.text(`Entradas: ${magnitude(totalIn)}`, left, y, { lineBreak: false });
    doc.text(`Saídas: ${magnitude(totalOut)}`, left + 170, y, { lineBreak: false });
    doc.text(`Saldo: ${money(totalIn + totalOut)}`, left + 340, y, { lineBreak: false });
    y += 14;

    // resumo por conta
    const accounts = new Map<string, { n: number; inCents: number; outCents: number }>();
    for (const row of rows) {
      const entry = accounts.get(row.account) ?? { n: 0, inCents: 0, outCents: 0 };
      entry.n += 1;
      if (row.amount_cents > 0) entry.inCents += row.amount_cents;
      else entry.outCents += row.amount_cents;
      accounts.set(row.account, entry);
    }
    for (const [account, entry] of accounts) {
      doc.fillColor('#5F6F63').text(
        `${account} · ${entry.n} lançamentos · entradas ${magnitude(entry.inCents)} · saídas ${magnitude(entry.outCents)}`,
        left,
        y,
        { lineBreak: false },
      );
      y += 12;
    }

    // totais por mes numa passada: antes cada virada de mes filtrava a lista inteira
    const monthTotals = new Map<string, { n: number; inCents: number; outCents: number }>();
    for (const row of rows) {
      const key = row.posted_at.slice(0, 7);
      const entry = monthTotals.get(key) ?? { n: 0, inCents: 0, outCents: 0 };
      entry.n += 1;
      if (row.amount_cents > 0) entry.inCents += row.amount_cents;
      else entry.outCents += row.amount_cents;
      monthTotals.set(key, entry);
    }

    // lancamentos agrupados por mes
    let currentMonth = '';
    for (let index = 0; index < rows.length; index++) {
      const row = rows[index]!;
      const rowMonth = row.posted_at.slice(0, 7);

      if (rowMonth !== currentMonth) {
        currentMonth = rowMonth;
        const month = monthTotals.get(rowMonth)!;

        ensure(96);
        y += 16;
        doc.moveTo(left, y).lineTo(right, y).strokeColor('#CFC6B2').stroke();
        y += 10;
        doc.font('Helvetica-Bold').fontSize(11).fillColor('#1A2536').text(monthLabel(rowMonth), left, y);
        doc.font('Helvetica').fontSize(8).fillColor('#5F6F63').text(
          `${month.n} lançamentos · entradas ${magnitude(month.inCents)} · saídas ${magnitude(month.outCents)} · saldo ${money(month.inCents + month.outCents)}`,
          left,
          y + 14,
        );
        y += 32;
        tableHeader();
      }

      ensure(14);
      doc.font('Helvetica').fontSize(8).fillColor('#1A2536');
      doc.text(shortDate(row.posted_at), columns.date, y, { width: 66, lineBreak: false });
      doc.text(String(row.account).slice(0, 14), columns.account, y, { width: 68, lineBreak: false });
      doc.text(String(row.merchant || row.description).slice(0, 38), columns.desc, y, { width: 180, lineBreak: false });
      doc.text(String(row.category).slice(0, 18), columns.category, y, { width: 92, lineBreak: false });
      doc.text(money(row.amount_cents), columns.value, y, { width: right - columns.value, align: 'right', lineBreak: false });
      y += 13;
    }

    ensure(30);
    y += 10;
    doc.moveTo(left, y).lineTo(right, y).strokeColor('#CFC6B2').stroke();
    y += 10;
    doc.font('Helvetica-Bold').fontSize(9).fillColor('#1A2536').text('Total geral', left, y);
    doc.text(`${money(totalIn + totalOut)}`, columns.value, y, { width: right - columns.value, align: 'right' });
    y += 18;
    doc.font('Helvetica').fontSize(8).fillColor('#5F6F63').text(
      'Gerado pelo Extrato Falado — nenhum token somado; todo valor veio do SQLite.',
      left,
      y,
      { width: right - left },
    );
  });
}

export function buildProofPdf(payload: AskPayload): Promise<Buffer> {
  return pdfToBuffer((doc) => {
    const left = 40;
    const right = 555;
    let y = 40;

    doc.font('Helvetica-Bold').fontSize(9).fillColor('#5F6F63').text('EXTRATO FALADO', left, y);
    y += 18;
    doc.font('Helvetica-Bold').fontSize(18).fillColor('#1A2536').text('Folha de prova', left, y);
    y += 26;
    doc.font('Helvetica').fontSize(9).fillColor('#5F6F63').text(
      `Emitida em ${new Date().toLocaleString('pt-BR')}`,
      left,
      y,
    );
    y += 22;

    const field = (label: string, value: string, options: { mono?: boolean } = {}) => {
      doc.font('Helvetica-Bold').fontSize(8).fillColor('#5F6F63').text(label.toUpperCase(), left, y);
      y += 12;
      doc.font(options.mono ? 'Courier' : 'Helvetica').fontSize(9).fillColor('#1A2536').text(value, left, y, { width: right - left });
      y = doc.y + 12;
    };

    field('Pergunta', payload.question);
    field('Resposta', payload.answer);

    const direction = payload.spec.filters.direction ?? 'any';
    const scope = describePeriod(payload.spec.filters.from, payload.spec.filters.to);
    if (payload.outcome.kind === 'sum') {
      field('Número apurado', `${brl(payload.outcome.totalCents)} · ${payload.outcome.count} lançamentos · ${direction === 'in' ? 'entradas' : direction === 'out' ? 'saídas' : 'saldo'} · ${scope}`);
    } else if (payload.outcome.kind === 'count') {
      field('Número apurado', `${payload.outcome.count} lançamentos · ${scope}`);
    } else if (payload.outcome.kind === 'average') {
      field('Número apurado', `${brl(payload.outcome.averageCents)} por lançamento · ${payload.outcome.count} lançamentos · ${scope}`);
    } else if (payload.outcome.kind === 'list') {
      const rows = payload.outcome.rows
        .slice(0, 12)
        .map((row, index) => `${String(index + 1).padStart(2)}. ${row.postedAt} · ${row.merchant} — ${brl(row.amountCents)}`)
        .join('\n');
      field('Lançamentos', `${payload.outcome.rows.length} no recorte · ${scope}\n${rows}`);
    } else {
      const rows = payload.outcome.rows.slice(0, 12).map((row, index) => `${String(index + 1).padStart(2)}. ${row.label} — ${brl(row.totalCents)}`).join('\n');
      field('Número apurado', `${brl(payload.outcome.totalCents)} no total · ${scope}\n${rows}`);
    }

    field('SQL executado', payload.sql.replace(/\s+/g, ' ').trim(), { mono: true });
    field('Parâmetros', JSON.stringify(payload.params), { mono: true });
    field('QuerySpec', JSON.stringify(payload.spec, null, 2), { mono: true });
    field(
      'Como foi apurado',
      `planner: ${payload.planner}\ntempo: ${payload.ms} ms\ntokens somados: 0\nfonte do valor: SQLite${payload.followUp ? '\ncontexto: continuacao da pergunta anterior' : ''}${payload.guard ? `\nfiltro de contraparte aplicado: ${payload.guard}` : ''}`,
    );

    doc.font('Helvetica').fontSize(8).fillColor('#5F6F63').text(
      'O modelo não calcula: ele só traduz a pergunta em filtros. A soma acontece no banco.',
      left,
      Math.min(y + 8, 780),
      { width: right - left },
    );
  });
}
