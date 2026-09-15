import Fuse from 'fuse.js';
import { UserStatus } from '../zero/schema.js';
import { matchesAllTokens } from './tokenMatch.js';

interface Searchable {
  name: string;
  [key: string]: unknown;
}

interface UserLike extends Searchable {
  id: string;
  email: string;
  displayName?: string | null;
  status?: string | null;
}

const isDeactivated = (user: UserLike): boolean => user.status === UserStatus.INACTIVE;

// Score for token-AND recall matches: below prefix/substring/email boosts (all negative),
// at/above weak fuzzy matches. Mirrors the score-0 convention used for channel token matches.
const TOKEN_MATCH_SCORE = 0;

export function searchUsers<T extends UserLike>(
  users: T[],
  query: string,
  limit = 10,
): T[] {
  // No query: keep the incoming order but float active users above deactivated
  // ones. Array.sort is stable (ES2019+), so order within each group is intact.
  if (!query.trim()) {
    return [...users]
      .sort((a, b) => Number(isDeactivated(a)) - Number(isDeactivated(b)))
      .slice(0, limit);
  }

  const q = query.toLowerCase();

  const fuse = new Fuse(users, {
    keys: [
      { name: 'displayName', weight: 2 },
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
    // Prefer the display name (what the user actually sees) for prefix/word-boundary
    // boosting, but keep matching on the raw name so the old name still finds them.
    const displayName = (r.item.displayName || r.item.name).toLowerCase();
    const name = r.item.name.toLowerCase();
    const email = r.item.email.toLowerCase();

    let finalScore = r.score ?? 1;

    if (displayName.startsWith(q) || name.startsWith(q)) {
      finalScore -= 10;
    } else if (displayName.includes(' ' + q) || name.includes(' ' + q)) {
      finalScore -= 5;
    } else if (email.startsWith(q)) {
      finalScore -= 2;
    }

    return {
      item: r.item,
      score: finalScore,
    };
  });

  // Fuse bitap matches one contiguous fuzzy run, so reordered or gapped multi-word queries
  // ('prasad siva', 'hars patil') never match. Add a token-AND recall pass: every query token
  // must be a substring of the name, in any order. Dedup by id — NOT name — because Fuse also
  // keys on email, so two distinct people can share a name; name-dedup would drop one.
  const tokens = q.split(/[\s,]+/).filter(Boolean);
  if (tokens.length > 1) {
    const seenIds = new Set(rescored.map(r => r.item.id));
    for (const user of users) {
      if (seenIds.has(user.id)) continue;
      const haystack = `${user.displayName ?? ''} ${user.name}`;
      if (matchesAllTokens(haystack, query)) {
        rescored.push({ item: user, score: TOKEN_MATCH_SCORE });
      }
    }
  }

  return rescored
    .sort((a, b) => {
      // Hard-demote deactivated users: all active users rank above all
      // deactivated ones regardless of relevance, so a deactivated match always
      // sinks to the bottom of the list and takes a little more effort to reach.
      const aDeactivated = isDeactivated(a.item);
      const bDeactivated = isDeactivated(b.item);
      if (aDeactivated !== bDeactivated) return aDeactivated ? 1 : -1;
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

  // Normalize hyphens to spaces in both query and channel names so that
  // "xyne feedback" matches "xyne-spaces-feedback".
  const normalizedQuery = query.replace(/-/g, ' ');
  const q = normalizedQuery.toLowerCase();

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
    getFn: (obj) => {
      // keys is always ['name'] — access the typed property directly
      // instead of dynamic property access, which is both safer and avoids
      // relying on internal Fuse.js APIs.
      return obj.name.replace(/-/g, ' ');
    },
  });

  const results = fuse.search(normalizedQuery);

  const rescored = results.map(r => {
    const name = r.item.name.toLowerCase().replace(/-/g, ' ');
    let finalScore = r.score ?? 1;

    // Prefix boost: a channel whose name starts with the query is almost
    // certainly what the user wants. The -10 shift is intentionally large
    // so prefix matches always rank above fuzzy matches regardless of
    // affinity or other signals applied downstream.
    if (name.startsWith(q)) {
      finalScore -= 10;
    } else if (name.includes(' ' + q)) {
      // Word-boundary boost: "eng" in "backend eng" is a stronger signal
      // than "eng" appearing mid-word (e.g. "length").
      finalScore -= 5;
    }

    return {
      item: r.item,
      score: finalScore,
    };
  });

  // Fuse.js bitap requires contiguous characters, so multi-word queries like
  // "xyne feedback" fail to match "xyne spaces feedback" (extra word breaks
  // contiguity). Add a token-based AND-contains pass to catch these cases.
  const fuseMatchedNames = new Set(rescored.map(r => r.item.name));
  const queryTokens = q.split(/\s+/).filter(Boolean);
  if (queryTokens.length > 1) {
    const tokenMatched = channels
      .filter(c => {
        if (fuseMatchedNames.has(c.name)) return false; // already included
        const name = c.name.toLowerCase().replace(/-/g, ' ');
        return queryTokens.every(t => name.includes(t));
      })
      // Score 0 intentionally ranks these between prefix/substring matches (score < 0)
      // and fuzzy-only matches (score 0.01–0.3): all-tokens-present > fuzzy, but prefix > all-tokens.
      .map(c => ({ item: c, score: 0 }));
    rescored.push(...tokenMatched);
  }

  return rescored
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
