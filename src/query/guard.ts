import type { Db } from '../db.ts';
import { stripAccents } from '../ingest/normalize.ts';
import type { QuerySpec } from './spec.ts';

export interface GuardResult {
  spec: QuerySpec;
  /** Trecho reconhecido no extrato, quando o guard entrou em acao. */
  matched?: string;
}

const MIN_MATCH = 5;

/**
 * Rede de seguranca para quando o planner "esquece" o nome citado na pergunta.
 *
 * Se a pergunta menciona uma contraparte que existe no extrato e a spec nao
 * filtra por nada especifico, o guard injeta o filtro de texto. Sem isso,
 * "quanto enviei para fulano" vira o total de todos os lancamentos, um numero
 * errado com cara de certo.
 */
export function applyEntityGuard(db: Db, spec: QuerySpec, question: string): GuardResult {
  const filters = spec.filters;
  // o planner ja filtrou por algo: nao atropela a decisao dele
  if (filters.text || filters.merchants?.length || filters.categories?.length) return { spec };

  const q = stripAccents(question).toLowerCase();
  if (q.length < MIN_MATCH) return { spec };

  const rows = db
    .prepare('SELECT DISTINCT merchant FROM transactions WHERE length(merchant) >= ?')
    .all(MIN_MATCH) as { merchant: string }[];

  let best: string | null = null;
  for (const row of rows) {
    const name = stripAccents(String(row.merchant)).toLowerCase().trim();
    const words = name.split(/\s+/).filter(Boolean);
    // maior prefixo do nome que aparece na pergunta ("janisleyde silva campos" > "janisleyde")
    for (let size = words.length; size >= 1; size--) {
      const candidate = words.slice(0, size).join(' ');
      if (candidate.length < MIN_MATCH) break;
      if (q.includes(candidate) && (!best || candidate.length > best.length)) {
        best = candidate;
        break;
      }
    }
  }

  if (!best) return { spec };
  return {
    spec: { ...spec, filters: { ...spec.filters, text: best } },
    matched: best,
  };
}
