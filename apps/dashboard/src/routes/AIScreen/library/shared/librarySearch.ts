/**
 * Library search: match the name first, fall back to descriptions only when
 * nothing matches by name.
 *
 * The previous approach matched `name + description` as one blob, which meant
 * an agent called "afd" surfaced for the query "test" purely because its
 * description was the word "test". Searching by name is what the box is for;
 * the description fallback keeps phrase searches ("pull request") working when
 * no name matches.
 */

export interface SearchableFields {
  name: string;
  description?: string | null | undefined;
  /** Extra name-like fields (e.g. skill slug) scored at the same tier as name. */
  aliases?: readonly string[];
  /** Secondary text (e.g. tool names) matched only after name tiers fail. */
  extras?: readonly string[];
}

/** 0 = exact, 1 = starts a word, 2 = mid-word. null = no match. */
function scoreName(name: string, query: string): number | null {
  const value = name.trim().toLowerCase();
  if (value === query) return 0;
  const index = value.indexOf(query);
  if (index === -1) return null;
  const previous = index === 0 ? '' : value[index - 1];
  return index === 0 || !previous || !/[a-z0-9]/.test(previous) ? 1 : 2;
}

function bestNameScore(fields: SearchableFields, query: string): number | null {
  let best: number | null = null;
  for (const candidate of [fields.name, ...(fields.aliases ?? [])]) {
    const score = scoreName(candidate ?? '', query);
    if (score === null) continue;
    if (best === null || score < best) best = score;
    if (best === 0) break;
  }
  return best;
}

function matchesDescriptionTier(fields: SearchableFields, query: string): boolean {
  if ((fields.description ?? '').toLowerCase().includes(query)) return true;
  return (fields.extras ?? []).some(extra => extra.toLowerCase().includes(query));
}

/** Whether a single item would appear in a library-style search. */
export function matchesLibrarySearch(fields: SearchableFields, rawQuery: string): boolean {
  const query = rawQuery.trim().toLowerCase();
  if (!query) return true;
  if (bestNameScore(fields, query) !== null) return true;
  return matchesDescriptionTier(fields, query);
}

export function searchByNameThenDescription<T>(
  items: readonly T[],
  rawQuery: string,
  read: (item: T) => SearchableFields,
): T[] {
  const query = rawQuery.trim().toLowerCase();
  if (!query) return [...items];

  // Tiers, best first. Only the best non-empty tier is returned, so a clean
  // name hit is never diluted by a mid-word one ("ai" must not pull in
  // "Release Captain") or by a description match.
  const wordMatches: Array<{ item: T; score: number; order: number }> = [];
  const midWordMatches: T[] = [];
  const descriptionMatches: T[] = [];

  items.forEach((item, order) => {
    const fields = read(item);
    const score = bestNameScore(fields, query);
    if (score === 0 || score === 1) {
      wordMatches.push({ item, score, order });
      return;
    }
    if (score === 2) {
      midWordMatches.push(item);
      return;
    }
    if (matchesDescriptionTier(fields, query)) {
      descriptionMatches.push(item);
    }
  });

  if (wordMatches.length > 0) {
    return wordMatches.sort((a, b) => a.score - b.score || a.order - b.order).map(e => e.item);
  }
  if (midWordMatches.length > 0) return midWordMatches;
  return descriptionMatches;
}
