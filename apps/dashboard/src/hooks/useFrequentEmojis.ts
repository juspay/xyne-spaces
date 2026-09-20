import { useMemo, useSyncExternalStore } from 'react';
import {
  FREQUENT_EMOJI_DISPLAY_LIMIT,
  getFrequentEmojis,
  subscribeToFrequentEmojis,
  type FrequentEmojiEntry,
} from '../utils/frequentEmojis';

/**
 * The current user's most-used emojis on this device, most used first.
 * Re-renders when a reaction is added anywhere in the app, or when another tab records one.
 */
export const useFrequentEmojis = (limit: number = FREQUENT_EMOJI_DISPLAY_LIMIT): string[] => {
  const entries: FrequentEmojiEntry[] = useSyncExternalStore(
    subscribeToFrequentEmojis,
    getFrequentEmojis,
    getFrequentEmojis,
  );

  return useMemo(() => entries.slice(0, limit).map(entry => entry.emoji), [entries, limit]);
};
