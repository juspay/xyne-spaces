import { useCallback } from 'react';
import { useParams } from 'react-router-dom';
import { mutators } from '../zero/mutators';
import { v4 as uuidv4 } from 'uuid';
import { useZero } from './useZero';
import { useChannel } from './useChannels';
import { globalClickTracker } from '../services/Analytics/globalClickTracker';
import { channelTrackingMetadata } from '../services/Analytics/channelTracking';

export interface UseReactionsReturn {
  toggleReaction: (params: { messageId: string; emoji: string; hasReacted: boolean }) => void;
}

export const useReactions = (): UseReactionsReturn => {
  const zero = useZero();
  // Reactions are toggled from the channel page; the route carries the channel.
  const { channelId } = useParams<{ channelId?: string }>();
  const channel = useChannel(channelId ?? '');

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

        // Every picker and drawer funnels through here, so this is the one
        // place a reaction is counted.
        globalClickTracker.trackManualEvent(
          'MESSAGE',
          hasReacted ? 'REMOVE_REACTION' : 'ADD_REACTION',
          undefined,
          { ...channelTrackingMetadata(channel), messageId, emojiName: emoji },
          'active',
        );
      } catch (error) {
        throw new Error(error instanceof Error ? error.message : 'Failed to toggle reaction');
      }
    },
    [zero, channel],
  );

  return { toggleReaction };
};
