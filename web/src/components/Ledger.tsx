import type { AskResponse, MonthSummary } from '../types.ts';
import { categoryCode, rowCode, rowLabel } from '../lib/codes.ts';
import {
  countLabel,
  directionLabel,
  groupLabel,
  groupLabelPlural,
  money,
  moneyParts,
  moneySigned,
  pad2,
  periodInfo,
  dayMonth,
} from '../lib/format.ts';

interface LedgerProps {
  result: AskResponse | null;
  summary: MonthSummary | null;
  loading: boolean;
  error: string | null;
  pendingQuestion: string;
  entryNo: number;
  onRetry: () => void;
  onOpenProof: () => void;
  /** false quando o recorte é um período livre (de/até), não um mês inteiro. */
  wholeMonth?: boolean;
}

function firstLine(answer: string): string {
  return answer.split('\n')[0]?.trim() ?? '';
}

interface Headline {
  moneyCents?: number;
  count?: number;
  label: string;
  note: string;
}

function headlineOf(result: AskResponse): Headline {
  const { spec, outcome } = result;
  const direction = directionLabel(spec);

  switch (outcome.kind) {
    case 'sum':
      return {
        moneyCents: Math.abs(outcome.totalCents),
        label: `${direction} no recorte`,
        note: countLabel(outcome.count, 'lançamento', 'lançamentos'),
      };
    case 'average':
      return {
        moneyCents: outcome.averageCents,
        label: 'média por lançamento',
        note: countLabel(outcome.count, 'lançamento', 'lançamentos'),
      };
    case 'count':
      return {
        count: outcome.count,
        label: 'lançamentos no recorte',
        note: periodInfo(spec.filters).short,
      };
    case 'breakdown':
      return {
        moneyCents: outcome.totalCents,
        label: `${direction} por ${groupLabel(spec)}`,
        note: `${outcome.rows.length} ${groupLabelPlural(spec)} na folha`,
      };
    case 'list':
      return {
        count: outcome.rows.length,
        label: 'lançamentos listados',
        note: periodInfo(spec.filters).short,
      };
  }
}

function BreakdownTable({ result }: { result: AskResponse }) {
  const { spec, outcome } = result;
  if (outcome.kind !== 'breakdown') return null;

  const last = outcome.rows[outcome.rows.length - 1];
  const truncated = last ? last.accumCents !== outcome.totalCents : false;
  const groupBy = spec.groupBy ?? 'category';

  return (
    <div className="composition">
      <div className="composition-lead">
        <p>{firstLine(result.answer)}</p>
      </div>

      <div className="ledger-head">
        <span>código</span>
        <span>{groupBy === 'merchant' ? 'estabelecimento' : groupBy === 'category' ? 'composição' : 'recorte'}</span>
        <span className="right">valor</span>
        <span className="right">acumulado</span>
      </div>

      {outcome.rows.map((row, index) => (
        <div className="ledger-row" key={`${row.label}-${index}`}>
          <span className="code">{rowCode(groupBy, row.label, index)}</span>
          <span className="row-label">
            {rowLabel(groupBy, row.label)}
            <small>{countLabel(row.count, 'lançamento', 'lançamentos')}</small>
          </span>
          <span className="row-value">{money(row.totalCents)}</span>
          <span className="row-value is-soft">{money(row.accumCents)}</span>
        </div>
      ))}

      {truncated && (
        <p className="ledger-note">
          As {outcome.rows.length} linhas somam {money(last?.accumCents ?? 0)}; o recorte inteiro soma{' '}
          {money(outcome.totalCents)}.
        </p>
      )}
    </div>
  );
}

function ListTable({ result }: { result: AskResponse }) {
  const { outcome } = result;
  if (outcome.kind !== 'list') return null;

  return (
    <div className="composition">
      <div className="composition-lead">
        <p>{firstLine(result.answer)}</p>
        <span>{outcome.rows.length} linhas</span>
      </div>

      <div className="ledger-head is-list">
        <span>data</span>
        <span>histórico</span>
        <span className="right">valor</span>
        <span className="right">categoria</span>
      </div>

      {outcome.rows.map((row, index) => (
        <div className="ledger-row is-list" key={`${row.postedAt}-${row.merchant}-${index}`}>
          <span className="code">{dayMonth(row.postedAt)}</span>
          <span className="row-label">
            {row.merchant}
            <small>{row.description}</small>
          </span>
          <span className={`row-value ${row.amountCents > 0 ? 'is-in' : ''}`}>{moneySigned(row.amountCents)}</span>
          <span className="row-value is-soft category-cell">
            <span className="code">{categoryCode(row.category)}</span> {row.category}
          </span>
        </div>
      ))}
    </div>
  );
}

function Conference({ result }: { result: AskResponse }) {
  const { spec, outcome } = result;
  const count =
    outcome.kind === 'breakdown' || outcome.kind === 'list' ? outcome.rows.length : outcome.count;

  return (
    <div className="composition">
      <p className="answer-line">{result.answer.replace(/\s+/g, ' ').trim()}</p>
      <div className="conference">
        <div>
          <span>lançamentos</span>
          <b>{count}</b>
        </div>
        <div>
          <span>período</span>
          <b>{periodInfo(spec.filters).short}</b>
        </div>
        <div>
          <span>fonte do valor</span>
          <b>SQLite</b>
        </div>
      </div>
    </div>
  );
}

export function Ledger({
  result,
  summary,
  loading,
  error,
  pendingQuestion,
  entryNo,
  onRetry,
  onOpenProof,
  wholeMonth = true,
}: LedgerProps) {
  // O cabeçalho descreve o mês carregado; o carimbo descreve o recorte da pergunta.
  const monthPeriod = summary ? periodInfo({ from: summary.from, to: summary.to }) : null;
  const period = result ? periodInfo(result.spec.filters) : monthPeriod;

  const headline = result ? headlineOf(result) : null;
  const parts = headline?.moneyCents !== undefined ? moneyParts(headline.moneyCents) : null;
  const stamp = period ?? { stamp: 'TUDO', stampNote: 'TUDO', full: '', short: '' };
  const valueKey = result ? `${result.sql}|${result.params.join('|')}` : 'idle';
  const question = loading ? pendingQuestion : (result?.question ?? pendingQuestion);
  const isTabular = result?.outcome.kind === 'breakdown' || result?.outcome.kind === 'list';
  const isEmpty =
    result !== null &&
    ((result.outcome.kind === 'breakdown' && result.outcome.rows.length === 0) ||
      (result.outcome.kind === 'list' && result.outcome.rows.length === 0) ||
      ((result.outcome.kind === 'sum' || result.outcome.kind === 'count' || result.outcome.kind === 'average') &&
        result.outcome.count === 0));

  return (
    <article className="entry" aria-busy={loading}>
      <header className="entry-head">
        <div>
          <h1>Extrato de lançamentos</h1>
          <p className="who">
            {summary?.sources && summary.sources.imported > 0
              ? 'titular · você · seu extrato importado'
              : 'titular · você · dados sintéticos'}
          </p>
        </div>
        <div className="acct">
          <span>período {monthPeriod?.full ?? 'carregando'}</span>
          <span>
            {summary
              ? `${countLabel(summary.count, 'lançamento', 'lançamentos')} ${wholeMonth ? 'no mês' : 'no período'} · ${countLabel(summary.categories.length, 'categoria', 'categorias')}`
              : 'lendo a caderneta'}
          </span>
        </div>
      </header>

      <div className="question-row">
        <span className="code q-no">{pad2(entryNo)}</span>
        <h2>{question || 'Pergunte alguma coisa sobre o seu extrato.'}</h2>
        <div className={`stamp ${loading ? 'is-pending' : ''}`} aria-hidden="true" key={valueKey}>
          <b>{loading ? '···' : stamp.stamp}</b>
          <span>{loading ? 'CONFERINDO' : error ? 'FALHOU' : stamp.stampNote}</span>
        </div>
      </div>

      {error && (
        <div className="notice" role="alert">
          <div>
            <b>Não deu para conferir.</b>
            <p>{error}</p>
          </div>
          <button type="button" onClick={onRetry}>
            Tentar de novo
          </button>
        </div>
      )}

      <div className="total">
        <span className="code">4.0</span>

        <div className="total-main">
          <p className="total-label">{loading ? 'conferindo no banco' : (headline?.label ?? 'total do recorte')}</p>

          {loading || !result ? (
            <p className="total-value is-pending" aria-hidden="true">
              -
            </p>
          ) : parts ? (
            <p className="total-value" key={valueKey}>
              {parts.whole}
              <small>{parts.fraction}</small>
            </p>
          ) : (
            <p className="total-value is-count" key={valueKey}>
              {headline?.count ?? 0}
            </p>
          )}

          <p className="total-note">{loading ? 'somando no SQLite' : (headline?.note ?? '')}</p>
        </div>

        <div className="total-meta">
          <div>
            <span>registro</span>
            <b>nº {pad2(entryNo)}</b>
          </div>
          <div>
            <span>extrato</span>
            <b>{summary ? summary.month.replace('-', '/') : '-'}</b>
          </div>
        </div>
      </div>

      <button
        type="button"
        className="proof-teaser"
        onClick={onOpenProof}
        disabled={!result || loading}
      >
        <span>ver a prova</span>
        <b>{result && !loading ? `SQL · ${result.params.length} parâmetros · ${result.ms} ms` : 'SQL e parâmetros'}</b>
        <span aria-hidden="true">→</span>
      </button>

      {isEmpty ? (
        <div className="empty">
          <p className="empty-title">Sem lançamentos nesse recorte.</p>
          <p className="empty-text">
            Tente outro mês na lombada ou use <strong>Importar extrato</strong> para subir o seu arquivo.
          </p>
        </div>
      ) : result ? (
        <>
          <BreakdownTable result={result} />
          <ListTable result={result} />
          {!isTabular && <Conference result={result} />}
        </>
      ) : (
        !loading &&
        !error && (
          <div className="empty">
            <p className="empty-title">A caderneta está fechada.</p>
            <p className="empty-text">
              Não consegui carregar o extrato. Recarregue a página ou tente de novo.
            </p>
          </div>
        )
      )}

      <p className="sr-only" aria-live="polite">
        {result && !loading ? result.answer : ''}
      </p>
    </article>
  );
}
