import { useEffect, useState } from 'react';
import { getManualEntries, createManualEntry, updateManualEntry, deleteManualEntry } from '../lib/api.ts';
import type { ManualEntry } from '../types.ts';

interface Props {
  categories: string[];
  onChanged: () => void;
  locked?: boolean;
}

const FALLBACK_CATEGORIES = ['Outros', 'Alimentação', 'Moradia', 'Transporte', 'Saúde', 'Renda', 'Lazer', 'Assinaturas', 'Contas'];

export function ManualEntries({ categories, onChanged, locked = false }: Props) {
  const options = [...new Set([...FALLBACK_CATEGORIES, ...categories])];
  const [items, setItems] = useState<ManualEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // form
  const [amount, setAmount] = useState('');
  const [direction, setDirection] = useState<'in' | 'out'>('out');
  const [postedAt, setPostedAt] = useState(new Date().toISOString().slice(0, 10));
  const [category, setCategory] = useState(options[0] ?? 'Outros');
  const [description, setDescription] = useState('');
  const [tags, setTags] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);

  async function reload() {
    setLoading(true);
    setError(null);
    try {
      const r = await getManualEntries({ limit: 100 });
      setItems(r.items);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erro ao carregar');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { reload(); }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const cents = Math.round(Number(amount.replace(',', '.')) * 100);
    if (!Number.isFinite(cents) || cents <= 0) { setError('Valor inválido'); return; }
    const tagList = tags.split(',').map((t) => t.trim()).filter(Boolean);
    try {
      if (editingId) {
        await updateManualEntry(editingId, {
          amountCents: cents,
          direction,
          postedAt,
          category,
          description,
          tags: tagList,
        });
      } else {
        await createManualEntry({
          amount: cents,
          direction,
          postedAt,
          category,
          description,
          tags: tagList,
          account: 'principal',
        });
      }
      setAmount('');
      setDescription('');
      setTags('');
      setEditingId(null);
      await reload();
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao salvar');
    }
  }

  function startEdit(m: ManualEntry) {
    setEditingId(m.id);
    setAmount((m.amountCents / 100).toFixed(2).replace('.', ','));
    setDirection(m.direction);
    setPostedAt(m.postedAt);
    setCategory(m.category);
    setDescription(m.description);
    setTags(m.tags.join(', '));
  }

  async function remove(id: string) {
    if (!confirm('Excluir este lancamento manual?')) return;
    try {
      await deleteManualEntry(id);
      await reload();
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao excluir');
    }
  }

  function cancelEdit() {
    setEditingId(null);
    setAmount('');
    setDescription('');
    setTags('');
  }

  return (
    <section className="manual-entries">
      <h2>Lançamentos manuais</h2>
      <p className="hint">Registre gastos e receitas que não passam pelo extrato, como dinheiro vivo ou uma renda avulsa. Cada lançamento fica na sua própria caderneta, fora do extrato importado e da amostra.</p>

      {locked ? (
        <p className="section-note" role="note">
          Aceite o aviso de privacidade no topo para registrar, editar ou excluir lançamentos manuais.
        </p>
      ) : (
      <form onSubmit={submit} className="manual-form">
        <div className="row">
          <label>Valor (R$)
            <input type="text" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} required />
          </label>
          <label>Direção
            <select value={direction} onChange={(e) => setDirection(e.target.value as 'in' | 'out')}>
              <option value="out">Saída</option>
              <option value="in">Entrada</option>
            </select>
          </label>
          <label>Data
            <input type="date" value={postedAt} onChange={(e) => setPostedAt(e.target.value)} required />
          </label>
        </div>
        <div className="row">
          <label>Categoria
            <select value={category} onChange={(e) => setCategory(e.target.value)}>
              {options.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </label>
          <label>Descrição
            <input type="text" value={description} onChange={(e) => setDescription(e.target.value)} />
          </label>
          <label>Tags separadas por vírgula
            <input type="text" value={tags} onChange={(e) => setTags(e.target.value)} placeholder="Ex.: mercado, fixo" />
          </label>
        </div>
        <div className="row actions">
          <button type="submit">{editingId ? 'Salvar' : 'Adicionar'}</button>
          {editingId && <button type="button" onClick={cancelEdit}>Cancelar</button>}
        </div>
        {error && <p className="error">{error}</p>}
      </form>
      )}

      {loading ? <p>Carregando lançamentos.</p> : (
        <ul className="manual-list">
          {items.map((m) => (
            <li key={m.id}>
              <span className="date">{m.postedAt}</span>
              <span className="cat">{m.category}</span>
              <span className="desc">{m.description || 'Sem descrição'}</span>
              <span className={`amount ${m.direction}`}>{m.direction === 'out' ? '-' : '+'} R$ {(m.amountCents / 100).toFixed(2)}</span>
              {locked ? null : (
                <div className="ops">
                  <button onClick={() => startEdit(m)}>Editar</button>
                  <button onClick={() => remove(m.id)}>Excluir</button>
                </div>
              )}
            </li>
          ))}
          {items.length === 0 && <li className="empty">Nenhum lançamento manual ainda.</li>}
        </ul>
      )}
    </section>
  );
}