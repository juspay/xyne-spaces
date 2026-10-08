import { useCallback, useMemo, useSyncExternalStore } from 'react';
import { useParams } from 'react-router-dom';
import { useAuth } from './useAuth';
import {
  DEFAULT_QUICK_REACTIONS,
  FREQUENT_EMOJI_DISPLAY_LIMIT,
  INLINE_QUICK_REACTION_LIMIT,
} from '../constants/settings';
import {
  buildFrequentEmojiScope,
  getFrequentEmojis,
  subscribeToFrequentEmojis,
  type FrequentEmojiEntry,
  type FrequentEmojiScope,
} from '../utils/frequentEmojis';

/**
 * Whose ranking to read and write. Custom emoji ids are workspace scoped, so the ranking is
 * partitioned by workspace and user rather than shared across every account on the device.
 */
export const useFrequentEmojiScope = (): FrequentEmojiScope => {
  const { workspaceId } = useParams<{ workspaceId?: string }>();
  const { user } = useAuth();

  return useMemo(() => buildFrequentEmojiScope(workspaceId, user?.id), [workspaceId, user?.id]);
};

/**
 * The current user's most-used emojis in this workspace, most used first.
 * Re-renders when a reaction is added anywhere in the app, or when another tab records one.
 */
export const useFrequentEmojis = (limit: number = FREQUENT_EMOJI_DISPLAY_LIMIT): string[] => {
  const scope = useFrequentEmojiScope();
  const getSnapshot = useCallback(
    (): readonly FrequentEmojiEntry[] => getFrequentEmojis(scope),
    [scope],
  );

  const entries = useSyncExternalStore(subscribeToFrequentEmojis, getSnapshot, getSnapshot);

  return useMemo(() => entries.slice(0, limit).map(entry => entry.emoji), [entries, limit]);
};

/**
 * Emojis for the inline toolbar strip: the user's own top emojis, topped up with the default
 * set so the strip is always the same width — it never collapses from three buttons to one
 * after the first reaction.
 */
export const useInlineQuickReactions = (limit: number = INLINE_QUICK_REACTION_LIMIT): string[] => {
  const learned = useFrequentEmojis(limit);

  return useMemo(() => {
    const merged = [...learned];
    for (const fallback of DEFAULT_QUICK_REACTIONS) {
      if (merged.length >= limit) break;
      if (!merged.includes(fallback)) merged.push(fallback);
    }
    return merged.slice(0, limit);
  }, [learned, limit]);
};
