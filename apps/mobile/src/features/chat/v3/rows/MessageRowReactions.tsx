import { type ReactElement } from 'react';
import { Pressable, Text, View, type GestureResponderEvent } from 'react-native';

import { ReactionEmojiDisplay } from '@/src/components/chat/message/reactions/reaction-emoji-display';

import type { ReactionPreview } from '../model/chatRow.types';
import { REACTION_ROW_HEIGHT } from '../model/measureRowHeight';
import { visibleReactionGroupCount } from '../model/reactionLayout';
import { useChatRenderTokens } from '../theme/ChatRenderProvider';

const REACTION_EMOJI_SIZE = 14;

/**
 * v2 parity reaction pill: one compact pill outside the bubble. Custom emoji
 * reaction keys are `custom:{emojiId}:{name}` and must render via the shared
 * ReactionEmojiDisplay instead of printing the raw id string.
 */
export function MessageRowReactions({
  reactions,
  availableBubbleWidth,
  onOpen,
}: {
  reactions: ReactionPreview | null;
  availableBubbleWidth: number;
  onOpen: () => void;
}): ReactElement | null {
  const tokens = useChatRenderTokens();

  if (!reactions || reactions.totalCount <= 0) {
    return null;
  }

  const stopPressPropagation = (event: GestureResponderEvent): void => {
    event.stopPropagation();
  };

  const handleOpen = (event: GestureResponderEvent): void => {
    event.stopPropagation();
    onOpen();
  };
  const visibleGroupCount = visibleReactionGroupCount(availableBubbleWidth, reactions.totalCount);

  return (
    <View className='h-6 items-end justify-start pr-2' style={{ minHeight: REACTION_ROW_HEIGHT }}>
      <Pressable
        accessibilityRole='button'
        accessibilityLabel={`${reactions.totalCount} ${
          reactions.totalCount === 1 ? 'reaction' : 'reactions'
        }`}
        hitSlop={6}
        className='flex-row items-center gap-1.5 rounded-full px-1.5 py-0.5 light:bg-[#fafafa] dark:bg-[#1d1f1f]'
        onPress={handleOpen}
        onPressIn={stopPressPropagation}
      >
        {reactions.groups.slice(0, visibleGroupCount).map(group => (
          <ReactionEmojiDisplay
            key={group.emojiName}
            emojiName={group.emojiName}
            size={REACTION_EMOJI_SIZE}
          />
        ))}
        {reactions.totalCount > 1 ? (
          <Text className='text-xs' style={{ color: tokens.mutedForeground }}>
            {reactions.totalCount}
          </Text>
        ) : null}
      </Pressable>
    </View>
  );
}
