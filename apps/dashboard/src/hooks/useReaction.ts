import { useCallback } from 'react';
import { useParams } from 'react-router-dom';
import { mutators } from '../zero/mutators';
import { v4 as uuidv4 } from 'uuid';
import { useZero } from './useZero';
import { useChannel } from './useChannels';
import { globalClickTracker } from '../services/Analytics/globalClickTracker';
import { channelTrackingMetadata } from '../services/Analytics/channelTracking';
import { recordEmojiUse } from '../utils/frequentEmojis';
import { useFrequentEmojiScope } from './useFrequentEmojis';

export interface UseReactionsReturn {
  toggleReaction: (params: { messageId: string; emoji: string; hasReacted: boolean }) => void;
}

export const useReactions = (): UseReactionsReturn => {
  const zero = useZero();
  // Reactions are toggled from the channel page; the route carries the channel.
  const { channelId } = useParams<{ channelId?: string }>();
  const channel = useChannel(channelId ?? '');
  // Custom emoji ids are workspace scoped, so the ranking is stored per workspace+user.
  const frequentEmojiScope = useFrequentEmojiScope();

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

        // Every message reaction picker and drawer funnels through here (call reactions
        // are a separate hook), so this is the one place a message reaction is counted —
        // including for the Frequently Used row. Removals are not counted: un-reacting is
        // a correction, not a preference. The count is written optimistically alongside
        // the mutation; a later server rejection rolls the reaction back but leaves the
        // count, which at worst nudges the user's own ranking.
        if (!hasReacted) {
          recordEmojiUse(frequentEmojiScope, emoji);
        }

        globalClickTracker.trackManualEvent(
          'MESSAGE',
          hasReacted ? 'REMOVE_REACTION' : 'ADD_REACTION',
          undefined,
          { ...channelTrackingMetadata(channel), messageId, emojiName: emoji },
        );
      } catch (error) {
        throw new Error(error instanceof Error ? error.message : 'Failed to toggle reaction');
      }
    },
    [zero, channel, frequentEmojiScope],
  );

  return { toggleReaction };
};
