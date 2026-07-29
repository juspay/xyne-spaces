// Validation and normalization for the per-user keyword-notification list
// ("highlight words"). Shared between the client and server Zero mutators so
// both sides accept/reject exactly the same input.

export const MAX_NOTIFICATION_KEYWORDS = 50;
export const MAX_NOTIFICATION_KEYWORD_LENGTH = 80;

/**
 * Normalize a raw keyword list: trim, collapse internal whitespace runs to a
 * single space, lowercase, drop empty entries, and de-duplicate. Keywords are
 * stored lowercase since matching is case-insensitive — display, dedupe, and
 * matching all stay consistent.
 *
 * Throws if a normalized keyword exceeds MAX_NOTIFICATION_KEYWORD_LENGTH or
 * the de-duplicated list exceeds MAX_NOTIFICATION_KEYWORDS — the mutators rely
 * on this to reject oversized lists server-side.
 */
export function normalizeNotificationKeywords(raw: string[]): string[] {
  const seen = new Set<string>();
  const normalized: string[] = [];

  for (const entry of raw) {
    const keyword = entry.trim().replace(/\s+/g, ' ').toLowerCase();
    if (!keyword) continue;
    if (keyword.length > MAX_NOTIFICATION_KEYWORD_LENGTH) {
      throw new Error(
        `Notification keyword exceeds ${MAX_NOTIFICATION_KEYWORD_LENGTH} characters`,
      );
    }
    if (seen.has(keyword)) continue;
    seen.add(keyword);
    normalized.push(keyword);
  }

  if (normalized.length > MAX_NOTIFICATION_KEYWORDS) {
    throw new Error(
      `Notification keyword list exceeds ${MAX_NOTIFICATION_KEYWORDS} keywords`,
    );
  }

  return normalized;
}

/**
 * Parse the stored stringified-JSON keyword list back into a string[].
 * The column is TEXT at rest (stringified JSON array); this is the single
 * place that knows that, so read sites stay agnostic of the storage format.
 * Malformed or non-array values parse to [] rather than throwing.
 */
export function parseNotificationKeywords(
  value: string | null | undefined,
): string[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed)
      ? parsed.filter((k): k is string => typeof k === 'string')
      : [];
  } catch {
    return [];
  }
}
