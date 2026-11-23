import { matchRule, matchRuleDetail } from './rules.ts';
import { nearestLabel, type Example } from './tfidf.ts';
import { stripAccents } from '../ingest/normalize.ts';
import labels from '../../data/labels.json' with { type: 'json' };

// import de JSON direto: o runtime resolve o caminho relativo a este modulo
const EXAMPLES: Example[] = labels;

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
export interface ClassificationExplanation {
  category: string;
  source: 'rule' | 'model' | 'manual';
  confidence: number;
  reason: string;
}

export function explainClassification(description: string, merchant: string): ClassificationExplanation {
  const byMerchant = matchRuleDetail(merchant);
  if (byMerchant) {
    return { category: byMerchant.category, source: 'rule', confidence: 1, reason: `regra: "${byMerchant.keyword}" no estabelecimento` };
  }
  const desc = stripAccents(description).toLowerCase();
  if (/\bpix\b|\bted\b|\bdoc\b|transferencia/.test(desc)) {
    return { category: 'Transferências', source: 'rule', confidence: 1, reason: 'regra: pix/ted/doc/transferência' };
  }
  const haystack = `${description} ${merchant}`;
  const rule = matchRuleDetail(haystack);
  if (rule) {
    return { category: rule.category, source: 'rule', confidence: 1, reason: `regra: "${rule.keyword}" na descrição` };
  }
  const guess = nearestLabel(merchant || description, EXAMPLES);
  if (guess) {
    return { category: guess.label, source: 'model', confidence: Number(guess.score.toFixed(2)), reason: `similaridade com "${guess.label}" (${guess.score.toFixed(2)})` };
  }
  return { category: 'Outros', source: 'model', confidence: 0, reason: 'sem regra nem similaridade: caiu em Outros' };
}

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
