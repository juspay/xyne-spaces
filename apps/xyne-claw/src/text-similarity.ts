/** Lowercased alphanumeric word set (words of 3+ chars) — the unit of the Jaccard helpers below. */
export function wordSet(text: string): Set<string> {
  return new Set(text.toLowerCase().split(/[^a-z0-9]+/).filter((t) => t.length > 2));
}

/** Jaccard similarity of two sets; 0 when either is empty. */
export function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let inter = 0;
  for (const t of a) if (b.has(t)) inter += 1;
  return inter / (a.size + b.size - inter);
}
