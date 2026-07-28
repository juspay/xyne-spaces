/**
 * Lexical similarity for entity names.
 *
 * Deliberately not embeddings. Entity names are short proper nouns, which is
 * exactly where sentence embeddings are least reliable — "Razorpay" and "RZP"
 * are not close in any semantic space, and neither are "hdfc" and "hdcf". The
 * real failure modes here are typos, spacing, and abbreviation, all of which
 * are character-level problems.
 *
 * This also removes the model-consistency constraint entirely: there is no
 * shared vector space to maintain between bootstrap and runtime, so the
 * registry can be rebuilt or re-tuned without re-embedding anything.
 */

/** Space-padded character trigrams, matching Postgres pg_trgm semantics. */
export function trigrams(input: string): Set<string> {
  const s = `  ${input.trim()} `
  const out = new Set<string>()
  for (let i = 0; i < s.length - 2; i++) {
    out.add(s.slice(i, i + 3))
  }
  return out
}

export function trigramSimilarity(a: string, b: string): number {
  if (a === b) return 1
  const ta = trigrams(a)
  const tb = trigrams(b)
  if (ta.size === 0 || tb.size === 0) return 0

  let shared = 0
  for (const t of ta) {
    if (tb.has(t)) shared++
  }
  const union = ta.size + tb.size - shared
  return union === 0 ? 0 : shared / union
}

/** Levenshtein distance, capped for early exit on clearly-distant pairs. */
export function levenshtein(a: string, b: string, cap = 8): number {
  if (a === b) return 0
  if (Math.abs(a.length - b.length) > cap) return cap + 1

  let prev = Array.from({ length: b.length + 1 }, (_, i) => i)
  let curr = new Array<number>(b.length + 1).fill(0)

  for (let i = 1; i <= a.length; i++) {
    curr[0] = i
    let rowMin = curr[0]!
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      curr[j] = Math.min(prev[j]! + 1, curr[j - 1]! + 1, prev[j - 1]! + cost)
      if (curr[j]! < rowMin) rowMin = curr[j]!
    }
    if (rowMin > cap) return cap + 1
    ;[prev, curr] = [curr, prev]
  }
  return prev[b.length]!
}

/** Edit distance as a 0-1 ratio. Catches short transpositions trigrams miss. */
export function levenshteinRatio(a: string, b: string): number {
  const longest = Math.max(a.length, b.length)
  if (longest === 0) return 1
  const distance = levenshtein(a, b, Math.ceil(longest / 2))
  return Math.max(0, 1 - distance / longest)
}

/**
 * Combined lexical score. Trigrams handle spacing and insertion; edit distance
 * handles transposition ("hdcf" / "hdfc"), where trigram overlap collapses.
 */
export function lexicalSimilarity(a: string, b: string): number {
  if (a === b) return 1
  return Math.max(trigramSimilarity(a, b), levenshteinRatio(a, b))
}



