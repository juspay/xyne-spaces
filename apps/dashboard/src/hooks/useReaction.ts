import { useCallback } from 'react';
import { mutators } from '../zero/mutators';
import { posthogService, EVENTS, EVENT_PROPERTIES } from '../services/Analytics/posthogService';
import { v4 as uuidv4 } from 'uuid';
import { useZero } from './useZero';

export interface UseReactionsReturn {
  toggleReaction: (params: { messageId: string; emoji: string; hasReacted: boolean }) => void;
}

export const useReactions = (): UseReactionsReturn => {
  const zero = useZero();

  const toggleReaction = useCallback(
    ({
      messageId,
      emoji,
      hasReacted,
    }: {
      messageId: string;
      emoji: string;
      hasReacted: boolean;
    }) => {
      try {
        const timestamp = Date.now();

        zero.mutate(
          mutators.messages.react({
            messageId,
            emojiName: emoji,
            action: hasReacted ? 'remove' : 'add',
            timestamp,
            reactionId: hasReacted ? undefined : uuidv4(),
            countId: hasReacted ? undefined : uuidv4(),
          }),
        );
        posthogService.capture(EVENTS.INITIATE_ACTION, {
          type: hasReacted
            ? EVENT_PROPERTIES.ACTION_TYPES.REACTION_REMOVED
            : EVENT_PROPERTIES.ACTION_TYPES.REACTION_ADDED,
        });
      } catch (error) {
        throw new Error(error instanceof Error ? error.message : 'Failed to toggle reaction');
      }
    },
    [],
  );

  return { toggleReaction };
};
