import Fuse from 'fuse.js';

interface UserGroupLike {
  readonly name: string;
  readonly alias?: string | null | undefined;
  readonly description?: string | null | undefined;
}

/**
 * Fuzzy-match user groups on name, alias and description.
 *
 * Follows the ranking approach of `searchChannelsWithScores` in `@xyne/shared`:
 * a Fuse pass for typo tolerance, then prefix / word-boundary boosts so that
 * near-exact name matches always outrank loose fuzzy hits. Lower score = better.
 */
export function searchUserGroups<T extends UserGroupLike>(groups: T[], query: string): T[] {
  const q = query.trim().toLowerCase();
  if (!q) return groups;

  const fuse = new Fuse(groups, {
    keys: [
      { name: 'name', weight: 3 },
      { name: 'alias', weight: 2 },
      { name: 'description', weight: 1 },
    ],
    threshold: 0.35,
    ignoreLocation: true,
    includeScore: true,
    minMatchCharLength: 1,
    isCaseSensitive: false,
  });

  return fuse
    .search(q)
    .map(result => {
      const name = result.item.name.toLowerCase();
      const alias = result.item.alias?.toLowerCase() ?? '';
      let score = result.score ?? 1;

      if (name.startsWith(q) || alias.startsWith(q)) {
        score -= 10;
      } else if (name.includes(` ${q}`)) {
        score -= 5;
      }

      return { item: result.item, score };
    })
    .sort((a, b) =>
      a.score !== b.score ? a.score - b.score : a.item.name.localeCompare(b.item.name),
    )
    .map(result => result.item);
}
