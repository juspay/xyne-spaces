/**
 * In-process BM25 over short catalog documents (stage C retrieval).
 * No external deps — good enough for <2k hub rows at create time.
 */

export interface Bm25Doc {
  id: string;
  text: string;
}

export interface Bm25Hit {
  id: string;
  score: number;
}

const DEFAULT_K1 = 1.2;
const DEFAULT_B = 0.75;

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length >= 2);
}

export function bm25Rank(
  query: string,
  docs: Bm25Doc[],
  opts?: { k1?: number; b?: number; topK?: number },
): Bm25Hit[] {
  const k1 = opts?.k1 ?? DEFAULT_K1;
  const b = opts?.b ?? DEFAULT_B;
  const topK = opts?.topK ?? 8;
  const qTokens = tokenize(query);
  if (qTokens.length === 0 || docs.length === 0) return [];

  const tokenized = docs.map((d) => ({
    id: d.id,
    tokens: tokenize(d.text),
  }));
  const N = tokenized.length;
  const avgDl =
    tokenized.reduce((sum, d) => sum + d.tokens.length, 0) / Math.max(1, N);

  const df = new Map<string, number>();
  for (const d of tokenized) {
    const uniq = new Set(d.tokens);
    for (const t of uniq) df.set(t, (df.get(t) ?? 0) + 1);
  }

  const hits: Bm25Hit[] = [];
  for (const d of tokenized) {
    const tf = new Map<string, number>();
    for (const t of d.tokens) tf.set(t, (tf.get(t) ?? 0) + 1);
    const dl = d.tokens.length;
    let score = 0;
    for (const qt of qTokens) {
      const f = tf.get(qt) ?? 0;
      if (f === 0) continue;
      const n = df.get(qt) ?? 0;
      const idf = Math.log(1 + (N - n + 0.5) / (n + 0.5));
      const denom = f + k1 * (1 - b + (b * dl) / Math.max(1, avgDl));
      score += idf * ((f * (k1 + 1)) / denom);
    }
    if (score > 0) hits.push({ id: d.id, score });
  }

  return hits.sort((a, b) => b.score - a.score).slice(0, topK);
}
