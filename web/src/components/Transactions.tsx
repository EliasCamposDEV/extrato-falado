import { useState } from 'react';
import type { Transaction } from '../types.ts';
import { categoryCode } from '../lib/codes.ts';
import { countLabel, dayMonth, moneySigned } from '../lib/format.ts';

interface TransactionsProps {
  items: Transaction[];
  totalCount: number;
  allLoaded: boolean;
  loadingAll: boolean;
  /** "mês" ou "período": o recorte em tela, para os textos não mentirem. */
  periodLabel: string;
  categories: string[];
  notice?: string | null;
  onLoadAll: () => void;
  onRecategorize: (id: string, category: string, applyAll: boolean) => Promise<void>;
  onToggleInternalTransfer?: (id: string, value: boolean) => Promise<void>;
  onToggleRefund?: (id: string, value: boolean) => Promise<void>;
  onExplain?: (id: string) => Promise<string | null>;
}

export function Transactions({ items, totalCount, allLoaded, loadingAll, periodLabel, categories, notice, onLoadAll, onRecategorize, onToggleInternalTransfer, onToggleRefund, onExplain }: TransactionsProps) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [explainId, setExplainId] = useState<string | null>(null);
  const [explainText, setExplainText] = useState<string>('');
  const canLoadMore = !allLoaded && totalCount > items.length;

  const handleSave = async (id: string, category: string, applyAll: boolean) => {
    setSaving(true);
    try {
      await onRecategorize(id, category, applyAll);
      setEditingId(null);
    } finally {
      setSaving(false);
    }
  };

  const handleExplain = async (id: string) => {
    if (explainId === id) { setExplainId(null); return; }
    setExplainId(id);
    setExplainText('carregando…');
    try {
      const reason = onExplain ? await onExplain(id) : null;
      setExplainText(reason ?? 'sem explicação');
    } catch {
      setExplainText('não foi possível explicar');
    }
  };

  return (
    <section id="lancamentos" className="section" aria-labelledby="lancamentos-title">
      <div className="section-head">
        <h2 id="lancamentos-title">Lançamentos do {periodLabel}</h2>
        <p>
          {countLabel(items.length, 'linha', 'linhas')} de {countLabel(totalCount, 'lançamento', 'lançamentos')}
        </p>
      </div>

      {items.length === 0 ? (
        <p className="section-empty">Nenhum lançamento neste {periodLabel}.</p>
      ) : (
        <div className="expenses">
          <div className="expenses-head">
            <span>data</span>
            <span>histórico</span>
            <span className="right">categoria</span>
            <span className="right">valor</span>
          </div>

          {items.map((item, index) => (
            <div className="expense" key={item.id ?? `${item.postedAt}-${item.merchant}-${index}`}>
              <span className="code">{dayMonth(item.postedAt)}</span>
              <span className="expense-label">
                {item.merchant}
                <small>{item.description}</small>
                {item.isInternalTransfer ? <small className="tag">transferência interna</small> : null}
                {item.isRefund ? <small className="tag">estorno</small> : null}
              </span>
              <span className="expense-category">
                {editingId === item.id && item.id ? (
                  <select
                    autoFocus
                    defaultValue={item.category}
                    disabled={saving}
                    onChange={(e) => {
                      const value = e.target.value;
                      if (value && value !== item.category) {
                        const applyAll = window.confirm('Aplicar essa categoria a todos os lançamentos deste estabelecimento?');
                        void handleSave(item.id!, value, applyAll);
                      } else {
                        setEditingId(null);
                      }
                    }}
                    onBlur={() => setEditingId(null)}
                  >
                    {categories.map((c) => (
                      <option key={c} value={c}>{c}</option>
                    ))}
                  </select>
                ) : (
                  <button
                    type="button"
                    className="category-edit"
                    onClick={() => item.id && setEditingId(item.id)}
                    title="corrigir categoria"
                  >
                    <span className="code">{categoryCode(item.category)}</span> {item.category}
                  </button>
                )}
              </span>
              <span className="expense-actions">
                {item.id && onExplain ? (
                  <button type="button" className="text-button" onClick={() => void handleExplain(item.id!)} title="por que essa categoria?">
                    ?
                  </button>
                ) : null}
                {item.id && onToggleInternalTransfer ? (
                  <button
                    type="button"
                    className="text-button"
                    onClick={() => void onToggleInternalTransfer(item.id!, !item.isInternalTransfer)}
                    title="marcar como transferência interna"
                  >
                    ↔
                  </button>
                ) : null}
                {item.id && onToggleRefund ? (
                  <button
                    type="button"
                    className="text-button"
                    onClick={() => void onToggleRefund(item.id!, !item.isRefund)}
                    title="marcar como estorno"
                  >
                    ↩
                  </button>
                ) : null}
                {explainId === item.id ? <span className="section-note">{explainText}</span> : null}
              </span>
              <span className={`expense-value ${item.amountCents > 0 ? 'is-in' : ''}`}>
                {moneySigned(item.amountCents)}
              </span>
            </div>
          ))}
        </div>
      )}

      <div className="section-foot">
        {notice ? <span className="section-note">{notice}</span> : null}
        {canLoadMore ? (
          <button type="button" className="text-button" onClick={onLoadAll} disabled={loadingAll}>
            {loadingAll ? 'Abrindo a caderneta…' : `Ver todos os ${totalCount} lançamentos`}
          </button>
        ) : (
          <span className="section-note">
            {items.length > 0 ? `todos os lançamentos do ${periodLabel} na folha` : 'nada para listar'}
          </span>
        )}
        <span className="section-note">valor calculado por SQLite</span>
      </div>
    </section>
  );
}