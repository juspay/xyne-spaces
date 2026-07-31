import Fuse from 'fuse.js';

interface Searchable {
  name: string;
  [key: string]: unknown;
}

interface UserLike extends Searchable {
  email: string;
}

export function searchUsers<T extends UserLike>(
  users: T[],
  query: string,
  limit = 10,
): T[] {
  if (!query.trim()) return users.slice(0, limit);

  const q = query.toLowerCase();

  const fuse = new Fuse(users, {
    keys: [
      { name: 'name', weight: 2 },
      { name: 'email', weight: 1 },
    ],
    threshold: 0.2,
    ignoreLocation: true,
    includeScore: true,
    minMatchCharLength: 2,
    isCaseSensitive: false,
  });

  const results = fuse.search(query);

  const rescored = results.map(r => {
    const name = r.item.name.toLowerCase();
    const email = r.item.email.toLowerCase();

    let finalScore = r.score ?? 1;

    if (name.startsWith(q)) {
      finalScore -= 10;
    } else if (name.includes(' ' + q)) {
      finalScore -= 5;
    } else if (email.startsWith(q)) {
      finalScore -= 2;
    }

    return {
      item: r.item,
      score: finalScore,
    };
  });

  return rescored
    .sort((a, b) => {
      if (a.score !== b.score) {
        return a.score - b.score;
      }
      return a.item.name.localeCompare(b.item.name);
    })
    .slice(0, limit)
    .map(r => r.item);
}

/**
 * Search channels by name and return scored results.
 *
 * This is the core channel search implementation. It runs a Fuse.js fuzzy
 * match against each channel's name, then applies manual prefix boosts on
 * top of the raw Fuse score:
 *
 *   - Name starts with the query  → subtract 10  (strong prefix boost)
 *   - Name contains " <query>"    → subtract 5   (word-boundary boost)
 *
 * Scores are [0, 1] from Fuse (0 = perfect match, 1 = no match). The prefix
 * boosts push scores negative, which is fine — only relative order matters.
 * Lower score = better result.
 *
 * Returns { item, score }[] sorted ascending so callers can apply additional
 * signals (e.g. affinity weights) before deciding the final order.
 *
 * Use this function when you need scores for further processing.
 * Use searchChannels() when you only need the sorted items.
 */
export function searchChannelsWithScores<T extends Searchable>(
  channels: T[],
  query: string,
  limit = 10,
): { item: T; score: number }[] {
  if (!query.trim()) return channels.slice(0, limit).map(item => ({ item, score: 0 }));

  const q = query.toLowerCase();

  const fuse = new Fuse(channels, {
    keys: ['name'],
    // 0.3 threshold: accept results up to 30% "wrong" by Fuse's measure.
    // Tighter than default (0.6) to avoid surfacing obviously unrelated channels.
    threshold: 0.3,
    // Don't penalise matches that appear late in the string.
    // Without this, "eng" matching "engineering" at position 0 would score
    // better than "eng" matching "backend-eng" at position 8, which is not
    // the behaviour we want.
    ignoreLocation: true,
    includeScore: true,
    minMatchCharLength: 2,
    isCaseSensitive: false,
  });

  const results = fuse.search(query);

  return results
    .map(r => {
      const name = r.item.name.toLowerCase();
      let score = r.score ?? 1;

      // Prefix boost: a channel whose name starts with the query is almost
      // certainly what the user wants. The -10 shift is intentionally large
      // so prefix matches always rank above fuzzy matches regardless of
      // affinity or other signals applied downstream.
      if (name.startsWith(q)) {
        score -= 10;
      } else if (name.includes(' ' + q)) {
        // Word-boundary boost: "eng" in "backend eng" is a stronger signal
        // than "eng" appearing mid-word (e.g. "length").
        score -= 5;
      }

      return { item: r.item, score };
    })
    .sort((a, b) => {
      if (a.score !== b.score) {
        return a.score - b.score; // ascending — lower score = better rank
      }
      return a.item.name.localeCompare(b.item.name); // alphabetical tiebreak
    })
    .slice(0, limit);
}

/**
 * Search channels by name and return sorted items.
 *
 * Thin wrapper around searchChannelsWithScores() that strips the score from
 * each result. Use this when you only need the ordered list and don't intend
 * to apply any additional ranking signals (e.g. affinity weights) on top.
 *
 * If you need scores for further processing — for example to blend with
 * affinity weights before deciding the final order — use
 * searchChannelsWithScores() directly instead.
 */
export function searchChannels<T extends Searchable>(
  channels: T[],
  query: string,
  limit = 10,
): T[] {
  return searchChannelsWithScores(channels, query, limit).map(r => r.item);
}
