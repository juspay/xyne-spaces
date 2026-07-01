/**
 * Keyword-notification matching ("highlight words").
 *
 * Matches a user's configured keywords against a message's plain text.
 * Semantics (PRD): whole-word, case-insensitive, Unicode-aware boundaries;
 * multi-word keywords match across a single internal space; "deploy" matches
 * "Deploy!" but not "redeployment" or "deployments".
 */

/** Escape regex metacharacters so keywords match literally (e.g. "c++"). */
function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Build a whole-word, case-insensitive, Unicode-aware regex for a keyword.
 * Word boundaries are defined as "not adjacent to a letter, digit, or
 * underscore" so accented/non-ASCII words match correctly ("héllo" matches
 * "say héllo!" but not "héllos"). Internal single spaces match any
 * whitespace run so multi-word keywords survive formatting differences.
 */
export function buildKeywordRegex(keyword: string): RegExp {
  const pattern = keyword
    .split(' ')
    .map(escapeRegex)
    .join('\\s+');
  return new RegExp(`(?<![\\p{L}\\p{N}_])${pattern}(?![\\p{L}\\p{N}_])`, 'iu');
}

/**
 * Match each user's keyword list against a message's plain text.
 *
 * Each distinct keyword (case-insensitive) is tested exactly once and the
 * result fanned back out to every user who configured it, so shared keywords
 * across many users cost one regex test.
 *
 * @param text         Plain text of the message (no HTML / mention tokens).
 * @param userKeywords Map of userId -> that user's normalized keyword list.
 * @returns Map of userId -> matched keywords; users with no match are absent.
 */
export function matchKeywordsForUsers(
  text: string,
  userKeywords: ReadonlyMap<string, readonly string[]>,
): Map<string, string[]> {
  const result = new Map<string, string[]>();
  if (!text) return result;

  const matchCache = new Map<string, boolean>();

  for (const [userId, keywords] of userKeywords) {
    let matched: string[] | undefined;
    for (const keyword of keywords) {
      const trimmed = keyword.trim().replace(/\s+/g, ' ');
      if (!trimmed) continue;
      const cacheKey = trimmed.toLowerCase();
      let isMatch = matchCache.get(cacheKey);
      if (isMatch === undefined) {
        try {
          isMatch = buildKeywordRegex(trimmed).test(text);
        } catch {
          isMatch = false;
        }
        matchCache.set(cacheKey, isMatch);
      }
      if (isMatch) {
        (matched ??= []).push(trimmed);
      }
    }
    if (matched) {
      result.set(userId, matched);
    }
  }

  return result;
}
