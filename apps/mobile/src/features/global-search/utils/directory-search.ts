import Fuse, { type IFuseOptions } from 'fuse.js';

/** Searches one fixed list. An empty query returns the first `limit` items in order. */
export type Search<T> = (query: string, limit: number) => T[];

type Named = { name: string };
type Person = Named & { email: string };

const COMMON_OPTIONS = {
  ignoreLocation: true,
  includeScore: true,
  minMatchCharLength: 2,
  isCaseSensitive: false,
} as const;

/** Prefix beats word boundary beats anything fuzzy, whatever Fuse scored them. */
function nameBoost(name: string, query: string): number {
  const lowered = name.toLowerCase();
  if (lowered.startsWith(query)) return 10;
  if (lowered.includes(` ${query}`)) return 5;
  return 0;
}

/**
 * Ranks like `searchUsers` / `searchChannels` in `@xyne/shared`, but those build a
 * Fuse index on every call. This builds one on the first search and keeps it.
 */
function createSearch<T extends Named>(
  items: readonly T[],
  options: IFuseOptions<T>,
  boost: (item: T, query: string) => number,
): Search<T> {
  let index: Fuse<T> | null = null;

  return (rawQuery, limit) => {
    const query = rawQuery.trim();
    if (!query) return items.slice(0, limit);

    index ??= new Fuse(items, options);
    const lowered = query.toLowerCase();

    return index
      .search(query)
      .map(hit => ({ item: hit.item, score: (hit.score ?? 1) - boost(hit.item, lowered) }))
      .sort((a, b) => a.score - b.score || a.item.name.localeCompare(b.item.name))
      .slice(0, limit)
      .map(hit => hit.item);
  };
}

export function createPeopleSearch<T extends Person>(people: readonly T[]): Search<T> {
  return createSearch(
    people,
    {
      ...COMMON_OPTIONS,
      keys: [
        { name: 'name', weight: 2 },
        { name: 'email', weight: 1 },
      ],
      threshold: 0.2,
    },
    (person, query) =>
      nameBoost(person.name, query) || (person.email.toLowerCase().startsWith(query) ? 2 : 0),
  );
}

export function createNameSearch<T extends Named>(items: readonly T[]): Search<T> {
  return createSearch(items, { ...COMMON_OPTIONS, keys: ['name'], threshold: 0.3 }, (item, query) =>
    nameBoost(item.name, query),
  );
}
