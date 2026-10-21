export interface MatcherEntry {
  phrase: string;
  ruleIndex: number;
}

export interface Matcher {
  /** endIndex is exclusive: text.slice(endIndex - phrase.length, endIndex) is the match. One hit per (rule, end). */
  scan(text: string, onHit: (ruleIndex: number, endIndex: number) => void): void;
}

// Aho-Corasick compiled to a dense DFA over UTF-16 code units; symbol 0 stands for every unit no phrase uses.
export function buildMatcher(entries: readonly MatcherEntry[]): Matcher {
  const symbol = new Uint16Array(0x10000);
  let alphabet = 1;
  for (const e of entries) {
    for (let i = 0; i < e.phrase.length; i++) {
      const c = e.phrase.charCodeAt(i);
      if (symbol[c] === 0) symbol[c] = alphabet++;
    }
  }
  const go: Map<number, number>[] = [new Map()];
  const outs: number[][] = [[]];
  for (const e of entries) {
    if (e.phrase.length === 0) continue;
    let s = 0;
    for (let i = 0; i < e.phrase.length; i++) {
      const a = symbol[e.phrase.charCodeAt(i)]!;
      let t = go[s]!.get(a);
      if (t === undefined) {
        t = go.length;
        go[s]!.set(a, t);
        go.push(new Map());
        outs.push([]);
      }
      s = t;
    }
    if (!outs[s]!.includes(e.ruleIndex)) outs[s]!.push(e.ruleIndex);
  }

  const N = go.length;
  const A = alphabet;
  const delta = new Uint32Array(N * A);
  const fail = new Uint32Array(N);
  const queue: number[] = [];
  for (let a = 1; a < A; a++) {
    const t = go[0]!.get(a) ?? 0;
    delta[a] = t;
    if (t !== 0) queue.push(t);
  }
  for (let head = 0; head < queue.length; head++) {
    const s = queue[head]!;
    const f = fail[s]!;
    for (let a = 1; a < A; a++) {
      const t = go[s]!.get(a);
      if (t === undefined) {
        delta[s * A + a] = delta[f * A + a]!;
        continue;
      }
      const ft = delta[f * A + a]!;
      fail[t] = ft;
      const own = outs[t]!;
      for (const r of outs[ft]!) if (!own.includes(r)) own.push(r);
      delta[s * A + a] = t;
      queue.push(t);
    }
  }
  const outStart = new Uint32Array(N + 1);
  for (let s = 0; s < N; s++) outStart[s + 1] = outStart[s]! + outs[s]!.length;
  const outList = new Uint32Array(outStart[N]!);
  for (let s = 0, k = 0; s < N; s++) for (const r of outs[s]!) outList[k++] = r;

  return {
    scan(text, onHit) {
      let s = 0;
      for (let i = 0; i < text.length; i++) {
        s = delta[s * A + symbol[text.charCodeAt(i)]!]!;
        const from = outStart[s]!;
        const to = outStart[s + 1]!;
        for (let k = from; k < to; k++) onHit(outList[k]!, i + 1);
      }
    },
  };
}
