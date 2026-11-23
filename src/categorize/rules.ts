import { stripAccents } from '../ingest/normalize.ts';

export interface Rule {
  category: string;
  pattern: RegExp;
}

/**
 * Regras ordenadas do mais especifico ao mais generico.
 * Sao a primeira linha de defesa: baratas, auditaveis e explicaveis.
 */
export const RULES: Rule[] = [
  { category: 'Renda', pattern: /salario|provento|13o salario|ferias|rendimento|deposito|liquido de vencimento/ },
  { category: 'Contas', pattern: /conta de (luz|agua)|\b(luz|agua)\b|enel|sabesp|cemig|comgas|academia|smart fit|\bgym\b|pilates|yoga/ },
  { category: 'Moradia', pattern: /aluguel|condominio|vivo fibra|net combo|internet|iptu/ },
  { category: 'Supermercado', pattern: /pao de acucar|carrefour|assai|atacadao|supermercado|\bsuper\b|hortifruti|acougue|mercadinho/ },
  { category: 'Transporte', pattern: /uber|(^|\W)99(\W|$)|cabify|posto|shell|ipiranga|combustivel|metro|onibus|bilhete|estacionamento/ },
  { category: 'Alimentação', pattern: /ifood|rappi|restaurante|lanchonete|padaria|outback|burger|mcdonald|pizza|cafe/ },
  { category: 'Saúde', pattern: /farmacia|farma|drogaria|drogasil|pacheco|clinica|laboratorio|consulta|dentista|hospital/ },
  { category: 'Assinaturas', pattern: /netflix|spotify|disney|hbo|prime video|youtube|apple\.com|globoplay|deezer/ },
  { category: 'Lazer', pattern: /cinemark|cinema|ingresso|show|teatro|viagem|passagem/ },
  { category: 'Compras', pattern: /mercado livre|shopee|amazon|magalu|americanas|renner|zara|riachuelo|centauro/ },
  { category: 'Bem-estar', pattern: /suplemento|bem estar|massagem|spa/ },
  { category: 'Tarifas', pattern: /tarifa|iof|juros|anuidade|manutencao de conta|taxa/ },
  { category: 'Saques', pattern: /saque/ },
  { category: 'Transferências', pattern: /\bpix\b|\bted\b|\bdoc\b|transferencia|cofrinho|dinheiro guardado|dinheiro resgatado/ },
];

export interface RuleMatch {
  category: string;
  /** trecho que casou com a regra, para explicar a classificacao */
  keyword: string;
}

export function matchRuleDetail(text: string): RuleMatch | null {
  const haystack = stripAccents(text).toLowerCase();
  for (const rule of RULES) {
    const m = rule.pattern.exec(haystack);
    if (m) return { category: rule.category, keyword: m[0] };
  }
  return null;
}

export function matchRule(text: string): string | null {
  return matchRuleDetail(text)?.category ?? null;
}
