import { useCallback, useEffect, useRef, useState } from 'react';

import { AskBar } from './components/AskBar.tsx';
import { Audit } from './components/Audit.tsx';
import { Ledger } from './components/Ledger.tsx';
import { Mechanism } from './components/Mechanism.tsx';
import { Transactions } from './components/Transactions.tsx';
import { ManualEntries } from './components/ManualEntries.tsx';
import { Dashboard } from './components/Dashboard.tsx';
import { ConsentBanner } from './components/ConsentBanner.tsx';
import {
  acceptConsent,
  ask,
  deleteBudget,
  deleteMyData,
  exportProof,
  getBudgets,
  getCompare,
  getConsent,
  getHealth,
  getManualSummary,
  getMyData,
  getSummary,
  getTransactions,
  importFile,
  recategorize,
  resetData,
  revokeConsent,
  setBudget,
  patchTransaction,
  explainTransaction,
  type ConsentStatus,
  type MyData,
} from './lib/api.ts';
import {
  countLabel,
  dayMonth,
  defaultQuestion,
  fullDate,
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
import type { AskResponse, BudgetItem, ImportResult, MonthCompare, MonthSummary, Range, Source, Transaction } from './types.ts';

type ImportState =
  | { kind: 'ok'; result: ImportResult }
  | { kind: 'error'; message: string }
  | null;

function messageOf(error: unknown): string {
  return error instanceof Error && error.message ? error.message : 'Erro inesperado';
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

const SECTION_IDS = ['consulta', 'lancamentos', 'manuais', 'dashboard', 'como-funciona'];

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
  const [importAccount, setImportAccount] = useState<string>('');
  const [importInvoice, setImportInvoice] = useState<string>('');
  const [includeInternal, setIncludeInternal] = useState(false);
  const [activeSection, setActiveSection] = useState('consulta');
  const [manualRevision, setManualRevision] = useState(0);
  const [ephemeral, setEphemeral] = useState(false);
  const [maxUploadBytes, setMaxUploadBytes] = useState<number | null>(null);
  // demo publica: o extrato e somente leitura, os manuais sao da sessao
  const [readOnly, setReadOnly] = useState(false);
  const [consentStatus, setConsentStatus] = useState<ConsentStatus | null>(null);
  const [bannerDismissed, setBannerDismissed] = useState(false);
  const [privacyBusy, setPrivacyBusy] = useState(false);
  const [privacyMsg, setPrivacyMsg] = useState<string | null>(null);
  const [myData, setMyData] = useState<MyData | null>(null);

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

      if (nextSource === 'manual') {
        try {
          const manual = await getManualSummary(target);
          setMonths(manual.months);
        } catch {
          setMonths([]);
        }
        setSummary(null);
        setTransactions([]);
        setCompare(null);
        setBudgets([]);
        setResult(null);
        setPendingQuestion('');
        setLoading(false);
        return;
      }

      const question = nextRange ? rangeQuestion(nextRange.from, nextRange.to) : defaultQuestion(target);
      setPendingQuestion(question);
      setResult(null);

      const [monthSummary, monthTransactions, answer, monthCompare, monthBudgets] = await Promise.allSettled([
        getSummary(period, nextSource, nextAccount || undefined, nextInclude),
        getTransactions(period, 12, nextSource, nextAccount || undefined, nextInclude),
        ask(question, nextSource, nextAccount || undefined, nextInclude, undefined, nextRange ?? undefined),
        getCompare(period, nextSource, nextAccount || undefined, nextInclude),
        getBudgets(period, nextSource, nextAccount || undefined, nextInclude),
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
      if (source === 'manual') {
        const base = await getManualSummary();
        setMonths(base.months);
        await loadMonth(pickMonth(base.months));
        return;
      }
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
        const nextSource = next.source ?? source;
        if (nextSource === 'manual') {
          const base = await getManualSummary();
          setMonths(base.months);
          await loadMonth(pickMonth(base.months), next);
          return;
        }
        const base = await getSummary(
          undefined,
          nextSource,
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

  // limites de corpo informados pelo health do servidor
  useEffect(() => {
    let alive = true;
    getHealth()
      .then((health) => {
        if (!alive) return;
        setEphemeral(Boolean(health.ephemeral));
        setMaxUploadBytes(health.limits?.maxUploadBytes ?? null);
        setReadOnly(Boolean(health.readOnly));
      })
      .catch(() => {
        // health indisponível não impede o uso da tela
      });
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    let alive = true;
    getConsent()
      .then((status) => { if (alive) setConsentStatus(status); })
      .catch(() => { if (alive) setConsentStatus({ required: false, privacyUrl: '/privacidade.html', retentionDays: 30, consent: null }); });
    return () => { alive = false; };
  }, []);

  const dataAllowed = !consentStatus?.required || Boolean(consentStatus.consent);
  const showConsentBanner = Boolean(consentStatus?.required && !consentStatus.consent && !bannerDismissed);

  const handleAcceptConsent = async (llm: boolean) => {
    setPrivacyBusy(true);
    setPrivacyMsg(null);
    try {
      const { consent } = await acceptConsent(llm);
      setConsentStatus((prev) => prev ? { ...prev, consent } : prev);
      setBannerDismissed(false);
      setPrivacyMsg('Privacidade aceita. Você já pode registrar lançamentos.');
    } catch (err) {
      setPrivacyMsg(messageOf(err));
    } finally {
      setPrivacyBusy(false);
    }
  };

  const handleWithdrawConsent = async () => {
    setPrivacyBusy(true);
    setPrivacyMsg(null);
    try {
      await revokeConsent();
      setConsentStatus((prev) => prev ? { ...prev, consent: null } : prev);
      setBannerDismissed(false);
      setPrivacyMsg('Consentimento retirado. Novos lançamentos ficam bloqueados.');
    } catch (err) {
      setPrivacyMsg(messageOf(err));
    } finally {
      setPrivacyBusy(false);
    }
  };

  const handleLoadMyData = async () => {
    setPrivacyBusy(true);
    setPrivacyMsg(null);
    try {
      setMyData(await getMyData());
    } catch (err) {
      setPrivacyMsg(messageOf(err));
    } finally {
      setPrivacyBusy(false);
    }
  };

  const handleDeleteMyData = async () => {
    if (!confirm('Apagar todos os seus dados desta demo? Essa ação não pode ser desfeita.')) return;
    setPrivacyBusy(true);
    setPrivacyMsg(null);
    try {
      await deleteMyData();
      setMyData(null);
      setConsentStatus((prev) => prev ? { ...prev, consent: null } : prev);
      setBannerDismissed(false);
      setManualRevision((n) => n + 1);
      setPrivacyMsg('Seus dados foram apagados desta instância.');
      await loadMonth(month);
    } catch (err) {
      setPrivacyMsg(messageOf(err));
    } finally {
      setPrivacyBusy(false);
    }
  };

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
      if (SECTION_IDS.includes(id)) setActiveSection(id);
    };
    window.addEventListener('hashchange', onHash);
    onHash();
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  useEffect(() => {
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
    SECTION_IDS.forEach((id) => {
      const el = document.getElementById(id);
      if (el) observer.observe(el);
    });
    return () => observer.disconnect();
  }, [source]);

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
      // "ver todos" pede o recorte inteiro; o teto do servidor é a única pausa possível.
      const total = summary?.count ?? 200;
      const all = await getTransactions(range ?? month, Math.min(Math.max(total, 12), 5000), source, account || undefined, includeInternal);
      setTransactions(all.items);
      setAllLoaded(all.items.length >= total);
    } catch (loadError) {
      setError(messageOf(loadError));
    } finally {
      setLoadingAll(false);
    }
  };

  const handleFile = async (file: File) => {
    if (!dataAllowed) {
      setImportState({ kind: 'error', message: 'Aceite o aviso de privacidade antes de importar um arquivo.' });
      return;
    }
    const name = file.name.toLowerCase();
    const isPdf = name.endsWith('.pdf');

    if (!isPdf && !name.endsWith('.csv') && !name.endsWith('.ofx')) {
      setImportState({
        kind: 'error',
        message: 'Esse arquivo não é CSV, OFX nem PDF. Exporte o extrato do seu banco e tente de novo.',
      });
      return;
    }
    // limites de corpo informados pelo health do servidor
    const pdfLimit = Math.min(MAX_PDF, maxUploadBytes ?? MAX_PDF);
    const fileLimit = Math.min(MAX_FILE, maxUploadBytes ?? MAX_FILE);
    if (file.size > (isPdf ? pdfLimit : fileLimit)) {
      const mb = Math.floor((isPdf ? pdfLimit : fileLimit) / (1024 * 1024));
      setImportState({
        kind: 'error',
        message: isPdf
          ? `O PDF passa de ${mb} MB. Exporte um período menor.`
          : `O arquivo passa de ${mb} MB. Exporte um período menor.`,
      });
      return;
    }

    setImporting(true);
    setImportState(null);

    try {
      // conta digitada vale para todos os arquivos desta leva; vazio = detectar
      // pelo conteúdo do arquivo (OFX/BANKID) ou pelo nome.
      const chosenAccount = importAccount.trim() || undefined;
      // fatura: mês digitado vale para todos os arquivos desta leva. Vazio =
      // detectar pelo próprio arquivo (vencimento/"fatura de ...").
      const chosenInvoice = importInvoice || undefined;
      const imported = isPdf
        ? await importFile(file.name, '', chosenAccount, await readBase64(file), chosenInvoice)
        : await importFile(file.name, await readTextFile(file), chosenAccount, undefined, chosenInvoice);

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
      // o mês do arquivo vence o palpite: importar o extrato de novembro tem que
      // abrir novembro, mesmo quando o mês corrente é outro (ou o arquivo é antigo)
      const target = imported.month && base.months.includes(imported.month)
        ? imported.month
        : pickMonth(base.months);
      await loadMonth(target, { source: 'imported', account, includeInternal });
    } catch (importError) {
      setImportState({ kind: 'error', message: messageOf(importError) });
    } finally {
      setImporting(false);
    }
  };

  const suggestions = month ? suggestQuestions(month) : [];
  const followUps = result ? ['E no mês anterior?'] : [];

  return (
    <div className="app">
      <a className="skip" href="#consulta">
        Pular para a consulta
      </a>

      <header className="cover">
        <div className="cover-row">
          <a className="brand" href="#consulta">
            <span className="brand-name">Extrato Falado</span>
            <span className="brand-meta">Caderneta nº 0001 · extrato local</span>
          </a>

          <nav className="cover-nav" aria-label="Principal">
            <a href="#consulta" aria-current={activeSection === "consulta" ? "page" : undefined} onClick={() => setActiveSection("consulta")}>
              Extrato
            </a>
            <a href="#lancamentos" aria-current={activeSection === "lancamentos" ? "page" : undefined} onClick={() => setActiveSection("lancamentos")}>
              Lançamentos
            </a>
            <a href="#manuais" aria-current={activeSection === "manuais" ? "page" : undefined} onClick={() => setActiveSection("manuais")}>
              Manuais
            </a>
            <a href="#dashboard" aria-current={activeSection === "dashboard" ? "page" : undefined} onClick={() => setActiveSection("dashboard")}>
              Dashboard
            </a>
            <a href="#como-funciona" aria-current={activeSection === "como-funciona" ? "page" : undefined} onClick={() => setActiveSection("como-funciona")}>
              Como funciona
            </a>
            {readOnly ? (
              <span className="cover-note" role="note">Demo · manuais abertos</span>
            ) : (
              <button
                type="button"
                className="import"
                onClick={() => fileRef.current?.click()}
                disabled={importing || !dataAllowed}
                title={dataAllowed ? undefined : 'Aceite o aviso de privacidade para importar'}
              >
                {importing ? 'Lendo…' : 'Importar extrato'}
              </button>
            )}
          </nav>
        </div>
      </header>

      <main className="book">
        <nav className="spine" aria-label="Meses do extrato">
          <span className="spine-title" aria-hidden="true">
            Caderneta de poupança
          </span>
          <div className="spine-tabs">
            {months.map((value) => (
              <button
                key={value}
                type="button"
                className={`tab ${value === month && !range ? 'is-active' : ''}`}
                onClick={() => changeMonth(value)}
                aria-current={value === month && !range ? 'page' : undefined}
                aria-label={`${monthLong(value)} ${monthNumber(value)}${monthShort(value)}`}
              >
                <span>{monthNumber(value)}</span>
                {monthShort(value)}
              </button>
            ))}
          </div>
          <span className="spine-foot" aria-hidden="true">
            Nº 0001
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
                  {importState.kind === 'ok' ? 'Recibo de importação' : 'Importação recusada'}
                </p>
                <p className="slip-text">
                  {importState.kind === 'ok'
                    ? `${importState.result.read === 0 && importState.result.reportedBalanceCents != null ? 'O extrato não tem lançamentos neste período · ' : ''}${importState.result.format.toUpperCase()}${importState.result.via === 'ocr' ? ` (OCR${importState.result.ocrCorrections ? `, ${importState.result.ocrCorrections} valor(es) pelo saldo` : ''})` : ''} · ${countLabel(importState.result.read, 'linha lida', 'linhas lidas')} · ${countLabel(importState.result.inserted, 'nova', 'novas')} · ${countLabel(importState.result.duplicates, 'já existia', 'já existiam')}${importState.result.account ? ` · conta ${importState.result.account}` : ''}${importState.result.invoiceMonth ? ` · fatura ${importState.result.invoiceMonth}` : ''}${importState.result.installments ? ` · ${countLabel(importState.result.installments, 'parcela', 'parcelas')}` : ''}${importState.result.reportedBalanceCents != null ? ` · saldo informado ${importState.result.reportedBalanceCents / 100}` : ''}${importState.result.crossAccountDuplicates ? ` · ${importState.result.crossAccountDuplicates} lançamento(s) aparece(m) em mais de uma conta` : ''}${importState.result.transfers ? ` · ${importState.result.transfers} transferência(s) interna(s) detectada(s)` : ''}${importState.result.balanceMessage ? ` · ${importState.result.balanceMessage}` : ''}`
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
              <label htmlFor="source-select">Fonte dos dados</label>
              <select id="source-select" value={source} onChange={(e) => { const next = e.target.value as Source; setSource(next); void reloadWith({ source: next }); }}>
                <option value="all">Tudo</option>
                <option value="sample">Amostra</option>
                <option value="imported">Meu extrato</option>
                <option value="manual">Somente manuais</option>
              </select>
              {source === 'manual' ? (
                <p className="demo-note" role="note">Nesta fonte aparecem apenas os lançamentos que você registrou.</p>
              ) : null}
              {source !== 'manual' ? (
                <label htmlFor="account-select">Conta</label>
              ) : null}
              {source !== 'manual' ? (
                <select id="account-select" value={account} onChange={(e) => { const next = e.target.value; setAccount(next); void reloadWith({ account: next }); }}>
                  <option value="">Todas</option>
                  {(summary?.accounts ?? []).map((a) => (
                    <option key={a} value={a}>{a}</option>
                  ))}
                </select>
              ) : null}
              {!readOnly && source !== 'manual' ? (
                <>
                  <label htmlFor="import-account" title="Vale para o próximo arquivo importado; vazio = detectar pelo arquivo">
                    Conta do arquivo
                  </label>
                  <input
                    id="import-account"
                    type="text"
                    list="account-options"
                    placeholder="Detectar"
                    value={importAccount}
                    onChange={(e) => setImportAccount(e.target.value)}
                  />
                  <datalist id="account-options">
                    {(summary?.accounts ?? []).map((a) => (
                      <option key={a} value={a} />
                    ))}
                  </datalist>
                  <label htmlFor="import-invoice" title="Mês da fatura do próximo arquivo; vazio = detectar pelo vencimento">
                    Fatura
                  </label>
                  <input
                    id="import-invoice"
                    type="month"
                    value={importInvoice}
                    onChange={(e) => setImportInvoice(e.target.value)}
                  />
                </>
              ) : null}
              {source !== 'manual' ? (
                <>
                  <label htmlFor="from-input">De</label>
                  <input
                    id="from-input"
                    type="date"
                    value={draftFrom}
                    onChange={(e) => {
                      setDraftFrom(e.target.value);
                      applyRange(e.target.value, draftTo);
                    }}
                  />
                  <label htmlFor="to-input">Até</label>
                  <input
                    id="to-input"
                    type="date"
                    value={draftTo}
                    onChange={(e) => {
                      setDraftTo(e.target.value);
                      applyRange(draftFrom, e.target.value);
                    }}
                  />
                </>
              ) : null}
              {source !== 'manual' && range ? (
                <button
                  type="button"
                  className="source-clear"
                  onClick={() => {
                    setImportState(null);
                    void loadMonth(month, { range: null });
                  }}
                >
                  Mês todo
                </button>
              ) : null}
              {source !== 'manual' ? (
                <label className="source-check">
                  <input type="checkbox" checked={includeInternal} onChange={(e) => { const next = e.target.checked; setIncludeInternal(next); void reloadWith({ includeInternal: next }); }} />
                  Incluir transferências internas
                </label>
              ) : null}
              {source !== 'manual' ? (
                <a className="export-pdf" href={(() => {
                  const params = new URLSearchParams();
                  if (source !== 'all') params.set('source', source);
                  if (range) { params.set('from', range.from); params.set('to', range.to); }
                  if (account) params.set('account', account);
                  if (includeInternal) params.set('includeInternal', '1');
                  const query = params.toString();
                  return '/api/export/pdf' + (query ? '?' + query : '');
                })()} target="_blank" rel="noopener">Exportar PDF</a>
              ) : null}
              {source !== 'manual' && !readOnly && summary && summary.sources && summary.sources.imported ? (
                <button type="button" className="source-clear" onClick={async () => { try { const res = await resetData("imported"); setImportState({ kind: "ok", result: { read: res.removed, inserted: 0, duplicates: 0, format: "csv", month: res.summary.month, summary: res.summary } as any }); setSource("all"); setMonths(res.summary.months); await loadMonth(pickMonth(res.summary.months)); } catch (e) { setImportState({ kind: "error", message: e instanceof Error ? e.message : "Erro" }); } }}>
                  Limpar importados ({summary.sources.imported})
                </button>
              ) : null}
              {readOnly ? (
                <p className="demo-note" role="note">
                  Demo pública: o extrato de exemplo fica protegido. Após aceitar o aviso de privacidade, você pode registrar lançamentos manuais e ver o dashboard; importar e editar o extrato não estão disponíveis.
                </p>
              ) : ephemeral ? (
                <p className="demo-note" role="note">
                  Demo pública: o que você importar fica só nesta instância e some depois de um tempo.
                </p>
              ) : null}
            </div>
            {source !== 'manual' ? (
            <>
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
                  Vs. {range ? `${fullDate(compare.previousFrom)} a ${fullDate(compare.previousTo)}` : monthLong(compare.previousMonth)}{' '}
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
                  <div className="compare-recurrences">
                    <p className="compare-recurrences-title">Recorrentes detectados</p>
                    <ul className="recurrence-chips">
                      {compare.recurrences.map((r) => (
                        <li key={r.merchant} className="recurrence-chip">
                          <span className="recurrence-name">{r.merchant}</span>
                          <span className="recurrence-figures">
                            <span className="recurrence-avg">
                              {money(r.avgCents)}<small>Média/mês</small>
                            </span>
                            <span className="recurrence-last">Últ. {dayMonth(r.lastAt)}</span>
                          </span>
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}
              </section>
            ) : null}

            <section className="budgets" aria-label="Orçamento do mês">
              <h3 className="budgets-title">{range ? 'Orçamento do período' : 'Orçamento do mês'}</h3>
              {budgets.map((b) => (
                <div key={b.category} className={`budget-row budget-${b.status}`}>
                  <span className="budget-cat">{b.category}</span>
                  <div className="budget-bar">
                    <div className="budget-fill" style={{ width: `${Math.min(100, b.pct)}%` }} />
                  </div>
                  <span className="budget-numbers">
                    {money(b.spentCents)} / {money(b.limitCents)} ({b.pct}%)
                  </span>
                  {!range && !readOnly ? (
                    <button
                      type="button"
                      className="budget-remove"
                      title="Remover orçamento"
                      onClick={async () => {
                        await deleteBudget(b.category, month);
                        const fresh = await getBudgets(month, source, account || undefined, includeInternal);
                        setBudgets(fresh.items);
                      }}
                    >
                      ×
                    </button>
                  ) : null}
                </div>
              ))}
              {readOnly ? (
                <p className="section-note">Demo: orçamentos e edição do extrato não estão disponíveis.</p>
              ) : range ? (
                <p className="section-note">Orçamento é mensal: escolha um mês para editar o limite.</p>
              ) : (
                <div className="budget-form">
                  <select id="budget-category" aria-label="Categoria do orçamento" defaultValue={summary?.categories?.[0]?.label ?? ''}>
                    {(summary?.categories ?? []).map((c) => (
                      <option key={c.label} value={c.label}>{c.label}</option>
                    ))}
                  </select>
                  <input id="budget-limit" type="number" placeholder="Limite (R$)" min="1" step="0.01" />
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
              )}
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
            </>
            ) : null}
          </section>

          {source !== 'manual' ? (
          <Transactions
            items={transactions}
            totalCount={summary?.count ?? transactions.length}
            allLoaded={allLoaded}
            loadingAll={loadingAll}
            periodLabel={range ? 'período' : 'mês'}
            categories={[...new Set([...(summary?.allCategories ?? []), 'Renda', 'Moradia', 'Supermercado', 'Transporte', 'Alimentação', 'Saúde', 'Assinaturas', 'Lazer', 'Compras', 'Contas', 'Bem-estar', 'Tarifas', 'Saques', 'Transferências', 'Outros'])]}
            notice={recatMsg}
            readOnly={readOnly}
            onLoadAll={() => void loadAll()}
            onRecategorize={async (id, category, applyAll) => {
              const res = await recategorize(id, category, applyAll);
              setRecatMsg(applyAll ? `${res.changes} lançamento(s) reclassificado(s) para ${category}.` : `1 lançamento reclassificado para ${category}.`);
              await loadMonth(month, { range });
            }}
            onToggleInternalTransfer={async (id, value) => {
              await patchTransaction(id, { internalTransfer: value });
              await loadMonth(month, { range });
            }}
            onToggleRefund={async (id, value) => {
              await patchTransaction(id, { refund: value });
              await loadMonth(month, { range });
            }}
            onExplain={async (id) => {
              const r = await explainTransaction(id);
              return r.reason;
            }}
          />
          ) : null}

          <section id="manuais" className="manuals" aria-label="Lançamentos manuais">
            <ManualEntries
              key={manualRevision}
              categories={summary?.allCategories ?? []}
              locked={!dataAllowed}
              onChanged={() => { setManualRevision((n) => n + 1); void reloadWith({}); }}
            />
            {consentStatus?.required ? (
              <div className="privacy-panel" aria-label="Seus dados nesta demo">
                <h3>Seus dados nesta demo</h3>
                <p>
                  Seus lançamentos ficam só neste navegador e são apagados após {consentStatus.retentionDays} dias.
                  Você pode exportar, retirar o consentimento ou apagar tudo.{' '}
                  <a href="/privacidade.html" target="_blank" rel="noopener">Aviso de privacidade</a>
                </p>
                <div className="privacy-actions">
                  {dataAllowed ? (
                    <button type="button" disabled={privacyBusy} onClick={() => void handleWithdrawConsent()}>Retirar consentimento</button>
                  ) : (
                    <button type="button" onClick={() => setBannerDismissed(false)}>Ver aviso de privacidade</button>
                  )}
                  <button type="button" disabled={privacyBusy} onClick={() => void handleLoadMyData()}>Baixar meus dados (JSON)</button>
                  <button type="button" disabled={privacyBusy} onClick={() => void handleDeleteMyData()}>Apagar meus dados</button>
                </div>
                {privacyMsg ? <p className="privacy-msg" role="status">{privacyMsg}</p> : null}
                {myData ? (
                  <pre className="privacy-json">{JSON.stringify(myData, null, 2)}</pre>
                ) : null}
              </div>
            ) : null}
          </section>

          <section id="dashboard" className="dashboard-wrap" aria-label="Dashboard">
            <Dashboard month={month} source={source} revision={manualRevision} summary={summary} />
          </section>

          <Mechanism />

          <footer className="colophon">
            <div>
              <p className="colophon-brand">Extrato Falado</p>
              <p className="colophon-text">
                {summary?.sources && summary.sources.imported > 0
                  ? 'Extrato importado: os lançamentos ficam no SQLite desta instância no Render, não no seu navegador.'
                  : 'Amostra sintética de ago–nov/2026: os dados ficam no SQLite desta instância no Render.'}{' '}
                <a href="/privacidade.html" target="_blank" rel="noopener">Privacidade</a>{' '}
                {summary ? `${summary.totalTransactions} lançamentos carregados.` : ''}
              </p>
            </div>
            <div className="colophon-meta">
              <span>TypeScript · SQLite · React</span>
              <span>Nenhum token somado</span>
              <a href="#consulta">Voltar ao topo ↑</a>
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

      {showConsentBanner ? (
        <ConsentBanner
          retentionDays={consentStatus?.retentionDays ?? 30}
          busy={privacyBusy}
          onAccept={(llm) => void handleAcceptConsent(llm)}
          onLater={() => setBannerDismissed(true)}
        />
      ) : null}

      <input
        ref={fileRef}
        type="file"
        accept=".csv,.ofx,.pdf,text/csv,application/x-ofx,application/pdf"
        multiple
        hidden
        onChange={(event) => {
          const files = Array.from(event.target.files ?? []);
          event.target.value = '';
          if (files.length) void (async () => {
            for (const f of files) {
              try { await handleFile(f); } catch { /* continua com os proximos */ }
            }
          })();
        }}
      />

      <p className="sr-only" aria-live="polite">
        {loading ? 'Conferindo a consulta no banco.' : result ? `Consulta ${pad2(entryNo)} concluída.` : ''}
      </p>
    </div>
  );
}
