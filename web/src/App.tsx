import { useCallback, useEffect, useRef, useState } from 'react';

import { AskBar } from './components/AskBar.tsx';
import { Audit } from './components/Audit.tsx';
import { Ledger } from './components/Ledger.tsx';
import { Mechanism } from './components/Mechanism.tsx';
import { Transactions } from './components/Transactions.tsx';
import { ask, deleteBudget, exportProof, getBudgets, getCompare, getSummary, getTransactions, importFile, recategorize, resetData, setBudget } from './lib/api.ts';
import {
  countLabel,
  defaultQuestion,
  money,
  monthLong,
  monthNumber,
  monthShort,
  pad2,
  pickMonth,
  rangeQuestion,
  suggestQuestions,
} from './lib/format.ts';
import { useMediaQuery } from './lib/useMediaQuery.ts';
import type { AskResponse, BudgetItem, ImportResult, MonthCompare, MonthSummary, Range, Transaction } from './types.ts';

type ImportState =
  | { kind: 'ok'; result: ImportResult }
  | { kind: 'error'; message: string }
  | null;

type Source = 'all' | 'sample' | 'imported';

function messageOf(error: unknown): string {
  return error instanceof Error && error.message ? error.message : 'erro inesperado';
}

async function readTextFile(file: File): Promise<string> {
  const buffer = await file.arrayBuffer();
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buffer);
  } catch {
    return new TextDecoder('windows-1252').decode(buffer);
  }
}

async function readBase64(file: File): Promise<string> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}

const MAX_FILE = 12 * 1024 * 1024;
// PDF viaja em base64 (+33%): 8 MB de arquivo cabem no limite de 12 MB do servidor
const MAX_PDF = 8 * 1024 * 1024;

export default function App() {
  const [summary, setSummary] = useState<MonthSummary | null>(null);
  const [compare, setCompare] = useState<MonthCompare | null>(null);
  const [budgets, setBudgets] = useState<BudgetItem[]>([]);
  const [recatMsg, setRecatMsg] = useState<string | null>(null);
  const [months, setMonths] = useState<string[]>([]);
  const [month, setMonth] = useState('');
  const [range, setRange] = useState<Range | null>(null);
  const [draftFrom, setDraftFrom] = useState('');
  const [draftTo, setDraftTo] = useState('');
  const [result, setResult] = useState<AskResponse | null>(null);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingAll, setLoadingAll] = useState(false);
  const [allLoaded, setAllLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pendingQuestion, setPendingQuestion] = useState('');
  const [entryNo, setEntryNo] = useState(1);
  const [draft, setDraft] = useState('');
  const [proofOpen, setProofOpen] = useState(false);
  const [importing, setImporting] = useState(false);
  const [importState, setImportState] = useState<ImportState>(null);
  const [exportingProof, setExportingProof] = useState(false);
  const [source, setSource] = useState<Source>('all');
  const [account, setAccount] = useState<string>('');
  const [includeInternal, setIncludeInternal] = useState(false);
  const [activeSection, setActiveSection] = useState('consulta');

  const nextEntry = useRef(1);
  const booted = useRef(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const lastSpec = useRef<AskResponse['spec'] | null>(null);
  const narrow = useMediaQuery('(max-width: 1100px)');

  const bumpEntry = useCallback(() => {
    setEntryNo(nextEntry.current);
    nextEntry.current += 1;
  }, []);

  const askQuestion = useCallback(
    async (question: string) => {
      const trimmed = question.trim();
      if (!trimmed) return;

      setLoading(true);
      setError(null);
      setPendingQuestion(trimmed);
      setResult(null);
      setProofOpen(false);

      try {
        const answer = await ask(
          trimmed,
          source,
          account || undefined,
          includeInternal,
          lastSpec.current ?? undefined,
          range ?? undefined,
        );
        lastSpec.current = answer.spec;
        setResult(answer);
        bumpEntry();
      } catch (askError) {
        setError(messageOf(askError));
      } finally {
        setLoading(false);
      }
    },
    [bumpEntry, source, account, includeInternal, range],
  );

  const loadMonth = useCallback(
    async (
      target: string,
      override?: { source?: Source; account?: string; includeInternal?: boolean; range?: Range | null },
    ) => {
      const nextSource = override?.source ?? source;
      const nextAccount = override?.account ?? account;
      const nextInclude = override?.includeInternal ?? includeInternal;
      // 'range' ausente = mantém o recorte atual; null = volta para o mês escolhido
      const nextRange = override && 'range' in override ? (override.range ?? null) : range;
      const period = nextRange ?? target;
      setMonth(target);
      setRange(nextRange);
      setLoading(true);
      setError(null);
      setAllLoaded(false);
      setLoadingAll(false);
      setProofOpen(false);
      setDraft('');
      lastSpec.current = null;

      const question = nextRange ? rangeQuestion(nextRange.from, nextRange.to) : defaultQuestion(target);
      setPendingQuestion(question);
      setResult(null);

      const [monthSummary, monthTransactions, answer, monthCompare, monthBudgets] = await Promise.allSettled([
        getSummary(period, nextSource, nextAccount || undefined, nextInclude),
        getTransactions(period, 12, nextSource, nextAccount || undefined, nextInclude),
        ask(question, nextSource, nextAccount || undefined, nextInclude, undefined, nextRange ?? undefined),
        getCompare(target, nextSource, nextAccount || undefined, nextInclude),
        getBudgets(target, nextSource, nextAccount || undefined, nextInclude),
      ]);

      if (monthSummary.status === 'fulfilled') {
        setSummary(monthSummary.value);
        setMonths(monthSummary.value.months);
      }
      if (monthTransactions.status === 'fulfilled') {
        setTransactions(monthTransactions.value.items);
      }
      if (answer.status === 'fulfilled') {
        lastSpec.current = answer.value.spec;
        setResult(answer.value);
        bumpEntry();
      } else {
        setError(messageOf(answer.reason));
      }
      if (monthCompare.status === 'fulfilled') {
        setCompare(monthCompare.value);
      } else {
        setCompare(null);
      }
      if (monthBudgets.status === 'fulfilled') {
        setBudgets(monthBudgets.value.items);
      } else {
        setBudgets([]);
      }

      setLoading(false);
    },
    [bumpEntry, source, account, includeInternal, range],
  );

  const bootstrap = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const base = await getSummary(undefined, source, account || undefined, includeInternal);
      setMonths(base.months);
      await loadMonth(pickMonth(base.months));
    } catch (bootError) {
      setError(messageOf(bootError));
      setLoading(false);
    }
  }, [loadMonth, source]);

  /** Trocar fonte/conta/internas: relê os meses e recarrega o mês escolhido já com o novo filtro. */
  const reloadWith = useCallback(
    async (next: { source?: Source; account?: string; includeInternal?: boolean; range?: Range | null }) => {
      try {
        const base = await getSummary(
          undefined,
          next.source ?? source,
          (next.account ?? account) || undefined,
          next.includeInternal ?? includeInternal,
        );
        setMonths(base.months);
        await loadMonth(pickMonth(base.months), next);
      } catch {
        // sem lista de meses da API: recarrega o mês que já está na tela com o novo filtro
        await loadMonth(month || pickMonth(months), next);
      }
    },
    [account, includeInternal, loadMonth, month, months, source],
  );

  useEffect(() => {
    if (booted.current) return;
    booted.current = true;
    void bootstrap();
  }, [bootstrap]);

  // os campos de data mostram o recorte que está na tela, inclusive quando vem de um import ou do botão "mês todo"
  useEffect(() => {
    setDraftFrom(range?.from ?? '');
    setDraftTo(range?.to ?? '');
  }, [range]);

  useEffect(() => {
    if (!proofOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setProofOpen(false);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [proofOpen]);

  useEffect(() => {
    if (!(proofOpen && narrow)) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previous;
    };
  }, [proofOpen, narrow]);

  useEffect(() => {
    const onHash = () => {
      const id = window.location.hash.replace('#', '');
      if (id === 'consulta' || id === 'lancamentos' || id === 'como-funciona') setActiveSection(id);
    };
    window.addEventListener('hashchange', onHash);
    onHash();
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  useEffect(() => {
    const ids = ['consulta', 'lancamentos', 'como-funciona'];
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((entry) => entry.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        const first = visible[0];
        if (first) setActiveSection(first.target.id);
      },
      { rootMargin: '-35% 0px -55% 0px', threshold: 0 },
    );
    ids.forEach((id) => {
      const el = document.getElementById(id);
      if (el) observer.observe(el);
    });
    return () => observer.disconnect();
  }, []);

  const changeMonth = (target: string) => {
    if (target === month && !range) return;
    setImportState(null);
    void loadMonth(target, { range: null });
  };

  /** Período livre: com as duas datas preenchidas e em ordem, vira o recorte da tela. */
  const applyRange = (from: string, to: string) => {
    if (!from || !to || from > to) return;
    setImportState(null);
    void loadMonth(to.slice(0, 7), { range: { from, to } });
  };

  const submit = (question: string) => {
    setDraft('');
    setImportState(null);
    void askQuestion(question);
  };

  const retry = () => {
    if (!month) {
      void bootstrap();
      return;
    }
    if (!result && pendingQuestion) {
      void askQuestion(pendingQuestion);
      return;
    }
    void loadMonth(month, { range });
  };

  const exportCurrentProof = useCallback(async () => {
    if (!result) return;
    setExportingProof(true);
    setError(null);
    try {
      await exportProof(result.question, result.spec);
    } catch (proofError) {
      setError(messageOf(proofError));
    } finally {
      setExportingProof(false);
    }
  }, [result]);

  const loadAll = async () => {
    if (loadingAll) return;
    setLoadingAll(true);
    try {
      const all = await getTransactions(month, 200);
      setTransactions(all.items);
      setAllLoaded(true);
    } catch (loadError) {
      setError(messageOf(loadError));
    } finally {
      setLoadingAll(false);
    }
  };

  const handleFile = async (file: File) => {
    const name = file.name.toLowerCase();
    const isPdf = name.endsWith('.pdf');

    if (!isPdf && !name.endsWith('.csv') && !name.endsWith('.ofx')) {
      setImportState({
        kind: 'error',
        message: 'Esse arquivo não é CSV, OFX nem PDF. Exporte o extrato do seu banco e tente de novo.',
      });
      return;
    }
    if (file.size > (isPdf ? MAX_PDF : MAX_FILE)) {
      setImportState({
        kind: 'error',
        message: isPdf ? 'O PDF passa de 8 MB. Exporte um período menor.' : 'O arquivo passa de 12 MB. Exporte um período menor.',
      });
      return;
    }

    setImporting(true);
    setImportState(null);

    try {
      const imported = isPdf
        ? await importFile(file.name, '', undefined, await readBase64(file))
        : await importFile(file.name, await readTextFile(file));

      // saldo declarado = extrato reconhecido, so que sem movimento no periodo
      if (imported.read === 0 && imported.reportedBalanceCents == null) {
        setImportState({
          kind: 'error',
          message: 'Não encontrei lançamentos no arquivo. Em CSV/OFX, confira as colunas data, descrição e valor. Em PDF, confira se o arquivo é um extrato de Caixa, BB, PicPay ou Santander exportado pelo próprio banco.',
        });
        return;
      }

      setImportState({ kind: 'ok', result: imported });
      setSource('imported');
      const base = await getSummary(undefined, 'imported', account || undefined, includeInternal);
      setMonths(base.months);
      await loadMonth(pickMonth(base.months), { source: 'imported', account, includeInternal });
    } catch (importError) {
      setImportState({ kind: 'error', message: messageOf(importError) });
    } finally {
      setImporting(false);
    }
  };

  const suggestions = month ? suggestQuestions(month) : [];
  const followUps = result ? ['e no mês anterior?'] : [];

  return (
    <div className="app">
      <a className="skip" href="#consulta">
        Pular para a consulta
      </a>

      <header className="cover">
        <div className="cover-row">
          <a className="brand" href="#consulta">
            <span className="brand-name">Onde foi o meu dinheiro?</span>
            <span className="brand-meta">caderneta nº 0001 · extrato local</span>
          </a>

          <nav className="cover-nav" aria-label="Principal">
            <a href="#consulta" aria-current={activeSection === "consulta" ? "page" : undefined} onClick={() => setActiveSection("consulta")}>
              Extrato
            </a>
            <a href="#lancamentos" aria-current={activeSection === "lancamentos" ? "page" : undefined} onClick={() => setActiveSection("lancamentos")}>
              Lançamentos
            </a>
            <a href="#como-funciona" aria-current={activeSection === "como-funciona" ? "page" : undefined} onClick={() => setActiveSection("como-funciona")}>
              Como funciona
            </a>
            <button
              type="button"
              className="import"
              onClick={() => fileRef.current?.click()}
              disabled={importing}
            >
              {importing ? 'Lendo…' : 'Importar extrato'}
            </button>
          </nav>
        </div>
      </header>

      <main className="book">
        <nav className="spine" aria-label="Meses do extrato">
          <span className="spine-title" aria-hidden="true">
            caderneta de poupança
          </span>
          <div className="spine-tabs">
            {months.map((value) => (
              <button
                key={value}
                type="button"
                className={`tab ${value === month && !range ? 'is-active' : ''}`}
                onClick={() => changeMonth(value)}
                aria-current={value === month && !range ? 'page' : undefined}
                aria-label={monthLong(value)}
              >
                <span>{monthNumber(value)}</span>
                {monthShort(value)}
              </button>
            ))}
          </div>
          <span className="spine-foot" aria-hidden="true">
            nº 0001
          </span>
        </nav>

        <div className="page">
          {importState && (
            <div
              className={`slip ${importState.kind === 'error' ? 'is-error' : ''}`}
              role="status"
            >
              <div>
                <p className="slip-kicker">
                  {importState.kind === 'ok' ? 'recibo de importação' : 'importação recusada'}
                </p>
                <p className="slip-text">
                  {importState.kind === 'ok'
                    ? `${importState.result.format.toUpperCase()}${importState.result.via === 'ocr' ? ` (OCR${importState.result.ocrCorrections ? `, ${importState.result.ocrCorrections} valor(es) pelo saldo` : ''})` : ''} · ${countLabel(importState.result.read, 'linha lida', 'linhas lidas')} · ${countLabel(importState.result.inserted, 'nova', 'novas')} · ${countLabel(importState.result.duplicates, 'já existia', 'já existiam')}${importState.result.reportedBalanceCents != null ? ` · saldo informado ${importState.result.reportedBalanceCents / 100}` : ''}${importState.result.crossAccountDuplicates ? ` · ${importState.result.crossAccountDuplicates} possível(is) duplicata(s) entre contas` : ''}${importState.result.transfers ? ` · ${importState.result.transfers} transferência(s) interna(s) detectada(s)` : ''}${importState.result.balanceMessage ? ` · ${importState.result.balanceMessage}` : ''}`
                    : importState.message}
                </p>
              </div>
              <button type="button" onClick={() => setImportState(null)} aria-label="Fechar aviso">
                ×
              </button>
            </div>
          )}

          <section id="consulta" className="consultation" aria-label="Consulta sobre o extrato">
            <div className="source-control">
              <label htmlFor="source-select">fonte dos dados</label>
              <select id="source-select" value={source} onChange={(e) => { const next = e.target.value as Source; setSource(next); void reloadWith({ source: next }); }}>
                <option value="all">tudo</option>
                <option value="sample">amostra</option>
                <option value="imported">meu extrato</option>
              </select>
              <label htmlFor="account-select">conta</label>
              <select id="account-select" value={account} onChange={(e) => { const next = e.target.value; setAccount(next); void reloadWith({ account: next }); }}>
                <option value="">todas</option>
                {(summary?.accounts ?? []).map((a) => (
                  <option key={a} value={a}>{a}</option>
                ))}
              </select>
              <label htmlFor="from-input">de</label>
              <input
                id="from-input"
                type="date"
                value={draftFrom}
                onChange={(e) => {
                  setDraftFrom(e.target.value);
                  applyRange(e.target.value, draftTo);
                }}
              />
              <label htmlFor="to-input">até</label>
              <input
                id="to-input"
                type="date"
                value={draftTo}
                onChange={(e) => {
                  setDraftTo(e.target.value);
                  applyRange(draftFrom, e.target.value);
                }}
              />
              {range ? (
                <button
                  type="button"
                  className="source-clear"
                  onClick={() => {
                    setImportState(null);
                    void loadMonth(month, { range: null });
                  }}
                >
                  mês todo
                </button>
              ) : null}
              <label className="source-check">
                <input type="checkbox" checked={includeInternal} onChange={(e) => { const next = e.target.checked; setIncludeInternal(next); void reloadWith({ includeInternal: next }); }} />
                incluir transferências internas
              </label>
              <a className="export-pdf" href={(() => {
                const params = new URLSearchParams();
                if (source !== 'all') params.set('source', source);
                if (range) { params.set('from', range.from); params.set('to', range.to); }
                if (account) params.set('account', account);
                if (includeInternal) params.set('includeInternal', '1');
                const query = params.toString();
                return '/api/export/pdf' + (query ? '?' + query : '');
              })()} target="_blank" rel="noopener">exportar PDF</a>
              {summary && summary.sources && summary.sources.imported ? (
                <button type="button" className="source-clear" onClick={async () => { try { const res = await resetData("imported"); setImportState({ kind: "ok", result: { read: res.removed, inserted: 0, duplicates: 0, format: "csv", month: res.summary.month, summary: res.summary } as any }); setSource("all"); setMonths(res.summary.months); await loadMonth(pickMonth(res.summary.months)); } catch (e) { setImportState({ kind: "error", message: e instanceof Error ? e.message : "erro" }); } }}>
                  limpar importados ({summary.sources.imported})
                </button>
              ) : null}
            </div>
            <Ledger
              result={result}
              summary={summary}
              loading={loading}
              error={error}
              pendingQuestion={pendingQuestion}
              entryNo={entryNo}
              onRetry={retry}
              onOpenProof={() => setProofOpen(true)}
              wholeMonth={!range}
            />

            {compare && compare.previous.count > 0 ? (
              <section className="compare" aria-label="Comparação com o mês anterior">
                <h3 className="compare-title">
                  vs. {monthLong(compare.previousMonth)}{' '}
                  <span className="compare-total">
                    {compare.current.outCents > compare.previous.outCents ? '↑' : compare.current.outCents < compare.previous.outCents ? '↓' : '→'}{' '}
                    {money(Math.abs(compare.current.outCents - compare.previous.outCents))}
                  </span>
                </h3>
                <ul className="compare-list">
                  {compare.deltas.slice(0, 5).map((d) => (
                    <li key={d.label} className="compare-item">
                      <span className="compare-cat">{d.label}</span>
                      <span className="compare-delta">
                        {d.deltaCents > 0 ? '+' : ''}{money(d.deltaCents)}{' '}
                        <small>({d.deltaPct > 0 ? '+' : ''}{d.deltaPct}%)</small>
                      </span>
                    </li>
                  ))}
                </ul>
                {compare.recurrences.length > 0 ? (
                  <p className="compare-recurrences">
                    recorrentes detectados: {compare.recurrences.map((r) => r.merchant).join(', ')}
                  </p>
                ) : null}
              </section>
            ) : null}

            <section className="budgets" aria-label="Orçamento do mês">
              <h3 className="budgets-title">orçamento do mês</h3>
              {budgets.map((b) => (
                <div key={b.category} className={`budget-row budget-${b.status}`}>
                  <span className="budget-cat">{b.category}</span>
                  <div className="budget-bar">
                    <div className="budget-fill" style={{ width: `${Math.min(100, b.pct)}%` }} />
                  </div>
                  <span className="budget-numbers">
                    {money(b.spentCents)} / {money(b.limitCents)} ({b.pct}%)
                  </span>
                  <button
                    type="button"
                    className="budget-remove"
                    title="remover orçamento"
                    onClick={async () => {
                      await deleteBudget(b.category, month);
                      const fresh = await getBudgets(month, source, account || undefined, includeInternal);
                      setBudgets(fresh.items);
                    }}
                  >
                    ×
                  </button>
                </div>
              ))}
              <div className="budget-form">
                <select id="budget-category" defaultValue={summary?.categories?.[0]?.label ?? ''}>
                  {(summary?.categories ?? []).map((c) => (
                    <option key={c.label} value={c.label}>{c.label}</option>
                  ))}
                </select>
                <input id="budget-limit" type="number" placeholder="limite (R$)" min="1" step="0.01" />
                <button
                  type="button"
                  className="text-button"
                  onClick={async () => {
                    const sel = document.getElementById('budget-category') as HTMLSelectElement | null;
                    const inp = document.getElementById('budget-limit') as HTMLInputElement | null;
                    const cat = sel?.value ?? '';
                    const val = inp?.value ?? '';
                    const cents = Math.round(Number(val.replace(',', '.')) * 100);
                    if (!cat || !Number.isFinite(cents) || cents <= 0) return;
                    await setBudget(cat, month, cents);
                    const fresh = await getBudgets(month, source, account || undefined, includeInternal);
                    setBudgets(fresh.items);
                    if (inp) inp.value = '';
                  }}
                >
                  + definir orçamento
                </button>
              </div>
            </section>

            <AskBar
              draft={draft}
              onDraft={setDraft}
              onSubmit={submit}
              loading={loading}
              disabled={!month || importing}
              suggestions={suggestions}
              followUps={followUps}
              inputRef={inputRef}
            />
          </section>

          <Transactions
            items={transactions}
            totalCount={summary?.count ?? transactions.length}
            allLoaded={allLoaded}
            loadingAll={loadingAll}
            categories={(summary?.categories ?? []).map((c) => c.label)}
            notice={recatMsg}
            onLoadAll={() => void loadAll()}
            onRecategorize={async (id, category, applyAll) => {
              const res = await recategorize(id, category, applyAll);
              setRecatMsg(applyAll ? `${res.changes} lançamento(s) reclassificado(s) para ${category}.` : `1 lançamento reclassificado para ${category}.`);
              await loadMonth(month, { range });
            }}
          />

          <Mechanism />

          <footer className="colophon">
            <div>
              <p className="colophon-brand">Onde foi o meu dinheiro?</p>
              <p className="colophon-text">
                {summary?.sources && summary.sources.imported > 0
                  ? 'Seu extrato importado. O arquivo fica no SQLite do processo e não sai daqui.'
                  : 'Amostra sintética de ago–nov/2026. Seu arquivo fica no SQLite do processo e não sai daqui.'}{' '}
                {summary ? `${summary.totalTransactions} lançamentos carregados.` : ''}
              </p>
            </div>
            <div className="colophon-meta">
              <span>TypeScript · SQLite · React</span>
              <span>nenhum token somado</span>
              <a href="#consulta">voltar ao topo ↑</a>
            </div>
          </footer>
        </div>
      </main>

      {narrow && proofOpen && (
        <button
          type="button"
          className="scrim"
          tabIndex={-1}
          aria-hidden="true"
          onClick={() => setProofOpen(false)}
        />
      )}

      <Audit
        result={result}
        summary={summary}
        entryNo={entryNo}
        open={proofOpen}
        narrow={narrow}
        exporting={exportingProof}
        onExportProof={() => void exportCurrentProof()}
        onClose={() => setProofOpen(false)}
      />

      <input
        ref={fileRef}
        type="file"
        accept=".csv,.ofx,.pdf,text/csv,application/x-ofx,application/pdf"
        hidden
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = '';
          if (file) void handleFile(file);
        }}
      />

      <p className="sr-only" aria-live="polite">
        {loading ? 'Conferindo a consulta no banco.' : result ? `Consulta ${pad2(entryNo)} concluída.` : ''}
      </p>
    </div>
  );
}
