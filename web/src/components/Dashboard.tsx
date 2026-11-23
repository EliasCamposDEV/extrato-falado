import { useEffect, useState } from 'react';
import { getSummary, getManualSummary } from '../lib/api.ts';
import { loadDashboard } from '../lib/dashboardLoad.ts';
import type { MonthSummary, ManualSummary, Source } from '../types.ts';

interface Props {
  month: string;
  source: Source;
  revision: number;
  summary?: MonthSummary | null;
}

type ChartItem = { label: string; value: number; color?: string };
type View = 'bars' | 'donut' | 'table';

const VIEWS: { id: View; label: string }[] = [
  { id: 'bars', label: 'Bars' },
  { id: 'donut', label: 'Donut' },
  { id: 'table', label: 'Table' },
];

// paleta exclusiva do donut: tons vivos, com contraste >= 3:1 sobre o papel
const DONUT_COLORS = [
  '#1d3f73',
  '#b0780f',
  '#1c7a70',
  '#6b4a9e',
  '#3b7d3a',
  '#a85c1a',
  '#2c6fb5',
  '#8a4f6d',
];

function money(cents: number): string {
  return (cents / 100).toLocaleString('pt-BR', { minimumFractionDigits: 2 });
}

function BarChart({ title, items }: { title: string; items: ChartItem[] }) {
  const max = Math.max(1, ...items.map((i) => Math.abs(i.value)));
  return (
    <div className="chart">
      <h3 className="chart-title">{title}</h3>
      <svg viewBox="0 0 320 160" className="chart-svg" role="img" aria-label={title}>
        {items.map((it, i) => {
          const h = (Math.abs(it.value) / max) * 120;
          const x = 20 + i * (280 / Math.max(1, items.length));
          const w = 280 / Math.max(1, items.length) - 6;
          return (
            <g key={it.label}>
              <rect x={x} y={140 - h} width={w} height={h} fill={it.color ?? 'var(--cover)'} />
              <text x={x + w / 2} y={155} fontSize="8" textAnchor="middle" fill="var(--ink-soft)">{it.label.slice(0, 8)}</text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

function HBars({ title, items }: { title: string; items: ChartItem[] }) {
  const max = Math.max(1, ...items.map((i) => i.value));
  return (
    <div className="chart">
      <h3 className="chart-title">{title}</h3>
      <ul className="hbars">
        {items.slice(0, 8).map((it) => (
          <li key={it.label}>
            <span className="hb-label">{it.label}</span>
            <span className="hb-track"><span className="hb-fill" style={{ width: `${(it.value / max) * 100}%` }} /></span>
            <span className="hb-val">{money(it.value)}</span>
          </li>
        ))}
        {items.length === 0 && <li className="empty">Sem lançamentos neste mês.</li>}
      </ul>
    </div>
  );
}

function Donut({ title, items }: { title: string; items: ChartItem[] }) {
  const data = items.filter((i) => i.value > 0).slice(0, 8);
  const total = data.reduce((sum, i) => sum + i.value, 0);
  const radius = 54;
  const circumference = 2 * Math.PI * radius;
  let offset = 0;

  return (
    <div className="chart">
      <h3 className="chart-title">{title}</h3>
      {data.length === 0 ? (
        <p className="hint">Sem lançamentos neste mês.</p>
      ) : (
        <div className="donut">
          <svg viewBox="0 0 140 140" className="donut-svg" role="img" aria-label={title}>
            <circle cx="70" cy="70" r={radius} fill="none" stroke="var(--rule)" strokeWidth="18" />
            {data.map((it, i) => {
              const length = total ? (it.value / total) * circumference : 0;
              const dash = `${Math.max(0, length - 1)} ${circumference}`;
              const at = offset;
              offset += length;
              return (
                <circle
                  key={it.label}
                  cx="70"
                  cy="70"
                  r={radius}
                  fill="none"
                  stroke={DONUT_COLORS[i % DONUT_COLORS.length]}
                  strokeWidth="18"
                  strokeDasharray={dash}
                  strokeDashoffset={-at}
                  transform="rotate(-90 70 70)"
                />
              );
            })}
          </svg>
          <ul className="donut-legend">
            {data.map((it, i) => (
              <li key={it.label}>
                <span className="donut-swatch" style={{ background: DONUT_COLORS[i % DONUT_COLORS.length] }} />
                <span>{it.label}</span>
                <span className="donut-val">{money(it.value)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function CategoryTable({ title, items }: { title: string; items: ChartItem[] }) {
  return (
    <div className="chart">
      <h3 className="chart-title">{title}</h3>
      <table className="cat-table">
        <thead>
          <tr><th scope="col">Categoria</th><th scope="col">Valor</th></tr>
        </thead>
        <tbody>
          {items.map((it) => (
            <tr key={it.label}>
              <td>{it.label}</td>
              <td>{money(it.value)}</td>
            </tr>
          ))}
          {items.length === 0 && <tr><td className="empty" colSpan={2}>Sem lançamentos neste mês.</td></tr>}
        </tbody>
      </table>
    </div>
  );
}

function CategoryChart({ view, title, items }: { view: View; title: string; items: ChartItem[] }) {
  if (view === 'donut') return <Donut title={title} items={items} />;
  if (view === 'table') return <CategoryTable title={title} items={items} />;
  return <HBars title={title} items={items} />;
}

function PanelTotals({ inCents, outCents, count }: { inCents: number; outCents: number; count: number }) {
  return (
    <div className="dash-totals">
      <span>Entradas <strong>{money(inCents)}</strong></span>
      <span>Saídas <strong>{money(outCents)}</strong></span>
      <span>Lançamentos <strong>{count}</strong></span>
    </div>
  );
}

function InOut({ inCents, outCents }: { inCents: number; outCents: number }) {
  return (
    <BarChart title="Entradas e saídas" items={[
      { label: 'Entradas', value: inCents, color: 'var(--sage-deep)' },
      { label: 'Saídas', value: outCents, color: 'var(--stamp)' },
    ]} />
  );
}

export function Dashboard({ month, source, revision, summary }: Props) {
  const [extrato, setExtrato] = useState<MonthSummary | null>(null);
  const [manual, setManual] = useState<ManualSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<View>('bars');

  const showExtrato = source !== 'manual';
  const showManual = source === 'all' || source === 'manual';
  const reuseSummary = Boolean(summary && summary.month === month && summary.source === source);

  useEffect(() => {
    const period = month || undefined;
    return loadDashboard(
      {
        ...(showExtrato
          ? { extrato: reuseSummary && summary ? () => Promise.resolve(summary) : () => getSummary(period, source) }
          : {}),
        ...(showManual ? { manual: () => getManualSummary(period) } : {}),
      },
      {
        start: () => {
          setLoading(true);
          setError(null);
        },
        success: ({ extrato: nextExtrato, manual: nextManual }) => {
          if (nextExtrato) setExtrato(nextExtrato);
          if (nextManual) setManual(nextManual);
        },
        failure: setError,
        finish: () => setLoading(false),
      },
    );
  }, [month, source, showExtrato, showManual, revision, summary, reuseSummary]);

  if (loading) return <p className="hint">Preparando os painéis.</p>;
  if (error) return <p className="error">{error}</p>;

  const extratoLabel = source === 'sample' ? 'Amostra' : source === 'imported' ? 'Meu extrato' : 'Extrato';
  const extratoCats = (extrato?.categories ?? []).map((c) => ({ label: c.label, value: c.totalCents }));
  const manualCats = (manual?.categories ?? []).map((c) => ({ label: c.label, value: Math.abs(c.totalCents) }));

  return (
    <section className="dashboard">
      <h2>Painéis de dados</h2>
      <p className="hint">
        {source === 'manual'
          ? 'Aqui aparecem apenas os lançamentos que você registrou. Nada do extrato importado ou da amostra entra nesta leitura.'
          : 'A fonte escolhida define o que aparece aqui. Cada painel traz somente os seus próprios números.'}
      </p>

      <div className="chart-switch" role="group" aria-label="Formato dos gráficos">
        {VIEWS.map((option) => (
          <button
            key={option.id}
            type="button"
            aria-pressed={view === option.id}
            onClick={() => setView(option.id)}
          >
            {option.label}
          </button>
        ))}
      </div>

      <div className="dash-grid">
        {showExtrato ? (
          <div className="dash-panel">
            <h3>{extratoLabel}</h3>
            <PanelTotals inCents={extrato?.inCents ?? 0} outCents={extrato?.outCents ?? 0} count={extrato?.count ?? 0} />
            <InOut inCents={extrato?.inCents ?? 0} outCents={extrato?.outCents ?? 0} />
            <CategoryChart view={view} title="Saídas por categoria" items={extratoCats} />
          </div>
        ) : null}

        {showManual ? (
          <div className="dash-panel">
            <h3>Lançamentos manuais</h3>
            <PanelTotals inCents={manual?.inCents ?? 0} outCents={manual?.outCents ?? 0} count={manual?.count ?? 0} />
            <InOut inCents={manual?.inCents ?? 0} outCents={manual?.outCents ?? 0} />
            <CategoryChart view={view} title="Por categoria" items={manualCats} />
          </div>
        ) : null}
      </div>
    </section>
  );
}
