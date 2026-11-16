import { readFileSync } from 'node:fs';
import { matchRule } from './rules.ts';
import { nearestLabel, type Example } from './tfidf.ts';
import { stripAccents } from '../ingest/normalize.ts';

const EXAMPLES: Example[] = JSON.parse(
  readFileSync(new URL('../../data/labels.json', import.meta.url), 'utf8'),
) as Example[];

export interface Classification {
  category: string;
  source: 'rule' | 'model';
  confidence: number;
}

/**
 * Pipeline de categorizacao: regra -> kNN -> Outros.
 * A regra vence porque e explicavel ("porque casou com ifood"),
 * o que importa quando o usuario discorda da classificacao.
 */
export function classify(description: string, merchant: string): Classification {
  // O merchant manda: e ele que diz "Drogasil", nao o embrulho "pix enviado".
  const byMerchant = matchRule(merchant);
  if (byMerchant) return { category: byMerchant, source: 'rule', confidence: 1 };

  const desc = stripAccents(description).toLowerCase();
  // pix/transferencia sem estabelecimento reconhecido = transferencia entre pessoas
  if (/\bpix\b|\bted\b|\bdoc\b|transferencia/.test(desc)) {
    return { category: 'Transferências', source: 'rule', confidence: 1 };
  }

  const haystack = `${description} ${merchant}`;
  const rule = matchRule(haystack);
  if (rule) return { category: rule, source: 'rule', confidence: 1 };

  const guess = nearestLabel(merchant || description, EXAMPLES);
  if (guess) return { category: guess.label, source: 'model', confidence: Number(guess.score.toFixed(2)) };

  return { category: 'Outros', source: 'model', confidence: 0 };
}
