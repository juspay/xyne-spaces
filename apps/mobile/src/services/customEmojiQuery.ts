export const customEmojisQueryKey = ['custom-emojis'] as const;

/** In-memory freshness window; disk cache survives app kill separately. */
export const CUSTOM_EMOJIS_STALE_TIME_MS = 10 * 60 * 1000;

export function customEmojisQueryKeyForUser(userId: string): readonly ['custom-emojis', string] {
  return [...customEmojisQueryKey, userId];
}
