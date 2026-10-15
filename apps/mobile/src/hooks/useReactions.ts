import { useCallback } from 'react';
import { v4 as uuidv4 } from 'uuid';
import { useZero } from './useZero';
import { mutators } from '@/src/zero/mutators';
import { haptics } from '@/src/utils/haptics';

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
      console.log('toggleReaction', { messageId, emoji, hasReacted });
      void (hasReacted ? haptics.toggleOff() : haptics.toggleOn());
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
    },
    [zero],
  );

  return { toggleReaction };
};
