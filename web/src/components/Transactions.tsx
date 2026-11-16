import type { Transaction } from '../types.ts';
import { categoryCode } from '../lib/codes.ts';
import { countLabel, dayMonth, moneySigned } from '../lib/format.ts';

interface TransactionsProps {
  items: Transaction[];
  totalCount: number;
  allLoaded: boolean;
  loadingAll: boolean;
  onLoadAll: () => void;
}

export function Transactions({ items, totalCount, allLoaded, loadingAll, onLoadAll }: TransactionsProps) {
  const canLoadMore = !allLoaded && totalCount > items.length;

  return (
    <section id="lancamentos" className="section" aria-labelledby="lancamentos-title">
      <div className="section-head">
        <h2 id="lancamentos-title">Lançamentos do mês</h2>
        <p>
          {countLabel(items.length, 'linha', 'linhas')} de {countLabel(totalCount, 'lançamento', 'lançamentos')}
        </p>
      </div>

      {items.length === 0 ? (
        <p className="section-empty">Nenhum lançamento neste mês.</p>
      ) : (
        <div className="expenses">
          <div className="expenses-head">
            <span>data</span>
            <span>histórico</span>
            <span className="right">categoria</span>
            <span className="right">valor</span>
          </div>

          {items.map((item, index) => (
            <div className="expense" key={`${item.postedAt}-${item.merchant}-${index}`}>
              <span className="code">{dayMonth(item.postedAt)}</span>
              <span className="expense-label">
                {item.merchant}
                <small>{item.description}</small>
              </span>
              <span className="expense-category">
                <span className="code">{categoryCode(item.category)}</span> {item.category}
              </span>
              <span className={`expense-value ${item.amountCents > 0 ? 'is-in' : ''}`}>
                {moneySigned(item.amountCents)}
              </span>
            </div>
          ))}
        </div>
      )}

      <div className="section-foot">
        {canLoadMore ? (
          <button type="button" className="text-button" onClick={onLoadAll} disabled={loadingAll}>
            {loadingAll ? 'Abrindo a caderneta…' : `Ver todos os ${totalCount} lançamentos`}
          </button>
        ) : (
          <span className="section-note">
            {items.length > 0 ? 'todos os lançamentos do mês na folha' : 'nada para listar'}
          </span>
        )}
        <span className="section-note">valor calculado por SQLite</span>
      </div>
    </section>
  );
}
