import { useCallback, useMemo } from 'react';
import { parseReactionsMd } from '@xyne/shared';
import { useAuth } from './useAuth';
import { useReactions } from './useReaction';

export interface UseApplyReactionReturn {
  /** Adds the emoji, or removes it when this user already reacted with it. */
  applyReaction: (emoji: string) => void;
  /** True when the current user already reacted to this message with `emoji`. */
  hasReacted: (emoji: string) => boolean;
}

/**
 * One reaction path for every surface that can react to a message — the picker grid, the
 * Frequently Used row and the inline toolbar strip. Each surface owning its own copy of
 * "look up hasReacted, then toggle" is exactly how the toggle semantics drift apart.
 */
export const useApplyReaction = (
  messageId: string,
  reactionsMd?: string | null,
): UseApplyReactionReturn => {
  const { toggleReaction } = useReactions();
  const { user } = useAuth();
  const reactionsData = useMemo(() => parseReactionsMd(reactionsMd), [reactionsMd]);

  const hasReacted = useCallback(
    (emoji: string): boolean => !!user && (reactionsData[emoji] || []).includes(user.id),
    [reactionsData, user],
  );

  const applyReaction = useCallback(
    (emoji: string): void => {
      toggleReaction({ messageId, emoji, hasReacted: hasReacted(emoji) });
    },
    [hasReacted, messageId, toggleReaction],
  );

  return { applyReaction, hasReacted };
};
