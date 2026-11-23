import { stripAccents } from '../ingest/normalize.ts';

export interface Example {
  text: string;
  label: string;
}

export interface NearestLabel {
  label: string;
  score: number;
}

function normalize(text: string): string {
  return stripAccents(text).toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
}

/** Tokens + trigramas de caractere. Funciona bem com nome de estabelecimento curto e sem API. */
function features(text: string): Map<string, number> {
  const padded = ` ${normalize(text)} `;
  const bag = new Map<string, number>();
  const bump = (key: string) => bag.set(key, (bag.get(key) ?? 0) + 1);

  for (const token of padded.trim().split(' ')) {
    if (token.length >= 3) bump(`w:${token}`);
  }
  for (let i = 0; i <= padded.length - 3; i++) {
    const gram = padded.slice(i, i + 3);
    if (gram.trim().length >= 2) bump(`c:${gram}`);
  }
  return bag;
}

export function cosine(a: Map<string, number>, b: Map<string, number>): number {
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (const [key, value] of a) {
    normA += value * value;
    const other = b.get(key);
    if (other) dot += value * other;
  }
  for (const value of b.values()) normB += value * value;
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

/**
 * kNN com TF-IDF sobre exemplos rotulados a mao.
 * Sem chamada de API: determinístico, testavel e custo zero por transacao.
 */
export function nearestLabel(text: string, examples: Example[], minScore = 0.3): NearestLabel | null {
  if (examples.length === 0) return null;

  const docs = examples.map((example) => ({ label: example.label, bag: features(example.text) }));
  const df = new Map<string, number>();
  for (const doc of docs) {
    for (const key of doc.bag.keys()) df.set(key, (df.get(key) ?? 0) + 1);
  }
  const idf = (key: string) => Math.log((docs.length + 1) / ((df.get(key) ?? 0) + 1)) + 1;

  const weighted = (bag: Map<string, number>) => {
    const out = new Map<string, number>();
    for (const [key, tf] of bag) out.set(key, tf * idf(key));
    return out;
  };

  const target = weighted(features(text));
  let best: NearestLabel = { label: 'Outros', score: 0 };

  for (const doc of docs) {
    const score = cosine(target, weighted(doc.bag));
    if (score > best.score) best = { label: doc.label, score };
  }
  return best.score >= minScore ? best : null;
}
