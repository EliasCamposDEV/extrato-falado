import { Fragment, useEffect, useRef } from 'react';
import type { AskResponse, MonthSummary } from '../types.ts';
import { pad2, periodInfo } from '../lib/format.ts';

interface AuditProps {
  result: AskResponse | null;
  summary: MonthSummary | null;
  entryNo: number;
  open: boolean;
  narrow: boolean;
  exporting?: boolean;
  onExportProof: () => void;
  onClose: () => void;
}

function formatSql(sql: string) {
  return sql.split('?').map((part, index) => (
    <Fragment key={index}>
      {index > 0 && <b>?</b>}
      {part}
    </Fragment>
  ));
}

function plannerLabel(name: string): string {
  if (name.startsWith('heuristico')) return 'Heurístico · offline';
  if (name.startsWith('spec da consulta')) return 'Spec exibida · sem replanejar';
  if (name.startsWith('llm')) return 'LLM · OpenAI';
  return name;
}

export function Audit({ result, summary, entryNo, open, narrow, exporting = false, onExportProof, onClose }: AuditProps) {
  const closeRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLElement>(null);

  useEffect(() => {
    if (!narrow || !open) return;

    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    closeRef.current?.focus();

    const trapFocus = (event: KeyboardEvent) => {
      if (event.key !== 'Tab' || !panelRef.current) return;
      const focusable = panelRef.current.querySelectorAll<HTMLElement>(
        'button, summary, a[href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
      );
      if (focusable.length === 0) return;
      const first = focusable[0]!;
      const last = focusable[focusable.length - 1]!;

      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', trapFocus);
    return () => {
      document.removeEventListener('keydown', trapFocus);
      previous?.focus();
    };
  }, [narrow, open]);

  const dialog = narrow && open;

  return (
    <aside
      ref={panelRef}
      className={`proof ${open ? 'is-open' : ''}`}
      role={dialog ? 'dialog' : undefined}
      aria-modal={dialog ? true : undefined}
      aria-label="Prova da consulta"
      inert={narrow && !open}
    >
      <div className="proof-head">
        <h2>Prova da consulta nº {pad2(entryNo)}</h2>
        <button
          ref={closeRef}
          type="button"
          className="proof-close"
          onClick={onClose}
          aria-label="Fechar a folha de prova"
        >
          ×
        </button>
      </div>

      <div className="proof-body">
        <div className="proof-field">
          <p className="proof-label">SQL executado</p>
          {result ? (
            <pre className="sql">{formatSql(result.sql)}</pre>
          ) : (
            <pre className="sql is-empty">-</pre>
          )}
        </div>

        <div className="proof-field">
          <p className="proof-label">Parâmetros</p>
          <p className="params">
            {result ? JSON.stringify(result.params) : '[]'}
            {result ? <span className="params-count"> · {result.params.length}</span> : null}
          </p>
        </div>

        <div className="proof-rule" />

        <dl className="metrics">
          <div>
            <dt>Planner</dt>
            <dd>{result ? plannerLabel(result.planner) : '-'}</dd>
          </div>
          <div>
            <dt>Tempo</dt>
            <dd>{result ? `${result.ms} ms` : '-'}</dd>
          </div>
          <div>
            <dt>Tokens somados</dt>
            <dd>0</dd>
          </div>
          <div>
            <dt>Fonte do valor</dt>
            <dd>SQLite</dd>
          </div>
          <div>
            <dt>Período</dt>
            <dd>{summary ? periodInfo({ from: summary.from, to: summary.to }).full : '-'}</dd>
          </div>
          {result?.followUp ? (
            <div>
              <dt>Contexto</dt>
              <dd>Continuação</dd>
            </div>
          ) : null}
          {result?.guard ? (
            <div>
              <dt>Contraparte</dt>
              <dd>{result.guard}</dd>
            </div>
          ) : null}
        </dl>

        <div className="proof-rule" />

        {result ? (
          <details className="plan">
            <summary>Ver o plano (QuerySpec)</summary>
            <pre>{JSON.stringify(result.spec, null, 2)}</pre>
          </details>
        ) : (
          <p className="proof-label">Plano</p>
        )}

        {result ? (
          <button
            type="button"
            className="proof-export"
            onClick={onExportProof}
            disabled={exporting}
          >
            {exporting ? 'Emitindo a prova…' : 'Exportar prova em PDF'}
          </button>
        ) : null}

        <p className="proof-note">
          O modelo não calcula. Ele traduz a pergunta em filtros; a soma acontece no banco. Se a spec
          não passa na validação, nada é executado.
        </p>

        <p className="proof-sign">Conferido no SQLite · nenhum token somado</p>
      </div>
    </aside>
  );
}
