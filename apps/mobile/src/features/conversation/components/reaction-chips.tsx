import { memo, useCallback, useMemo, useState, type ReactElement } from 'react';
import { Pressable, Text, View } from 'react-native';
import type { User } from '@xyne/shared';

import { ReactionEmojiDisplay } from '@/src/components/chat/message/reactions/reaction-emoji-display';
import {
  groupReactionsForPill,
  type RawReaction,
} from '@/src/components/chat/message/reactions/reaction-pill.utils';
import {
  ReactionsBottomSheet,
  useReactionsSheetModel,
} from '@/src/features/chat/v2/components/conversation-composer/conversation-composer-reactions';
import type { ChatPaintRow } from '@/src/features/chat/v2/paint/chatPaint.types';
import { haptics } from '@/src/utils/haptics';

import {
  REACTION_CHIP_GAP,
  REACTION_CHIP_HEIGHT,
  REACTION_CHIP_PADDING_X,
  REACTION_EMOJI_SIZE,
} from '../constants';

type ReactionChipsProps = {
  paintRow: ChatPaintRow;
  currentUser: User | undefined;
  hydrateCustomEmoji: boolean;
};

/**
 * Emoji and count chips under a message. Tapping any chip opens the same
 * reactions sheet the classic pill does, where your own reaction can be removed.
 */
export const ReactionChips = memo(function ReactionChips({
  paintRow,
  currentUser,
  hydrateCustomEmoji,
}: ReactionChipsProps): ReactElement | null {
  const [isSheetOpen, setIsSheetOpen] = useState(false);
  const reactions = paintRow.reactionPreview?.reactions;
  const groups = useMemo(() => groupReactionsForPill(reactions ?? []), [reactions]);

  const handleOpen = useCallback((): void => {
    void haptics.buttonTap();
    setIsSheetOpen(true);
  }, []);

  if (groups.length === 0) return null;

  return (
    <View className='flex-row flex-wrap' style={{ gap: REACTION_CHIP_GAP }}>
      {groups.map(group => (
        <Pressable
          key={group.emojiName}
          accessibilityRole='button'
          accessibilityLabel={`${group.count} ${group.emojiName} ${group.count === 1 ? 'reaction' : 'reactions'}`}
          onPress={handleOpen}
          onLongPress={handleOpen}
          className='flex-row items-center rounded-full bg-spaces-surface'
          style={{
            height: REACTION_CHIP_HEIGHT,
            paddingHorizontal: REACTION_CHIP_PADDING_X,
            columnGap: REACTION_CHIP_GAP,
          }}
        >
          <ReactionEmojiDisplay
            emojiName={group.emojiName}
            size={REACTION_EMOJI_SIZE}
            hydrateCustomEmoji={hydrateCustomEmoji}
          />
          <Text className='text-[12px] leading-4 text-spaces-muted'>{group.count}</Text>
        </Pressable>
      ))}
      {isSheetOpen ? (
        <ReactionDetails
          reactions={reactions ?? []}
          currentUserId={currentUser?.id}
          onOpenChange={setIsSheetOpen}
        />
      ) : null}
    </View>
  );
});

type ReactionDetailsProps = {
  reactions: readonly RawReaction[];
  currentUserId: string | undefined;
  onOpenChange: (open: boolean) => void;
};

/** Mounted only while the sheet is open, so a row does not subscribe to every user. */
function ReactionDetails({
  reactions,
  currentUserId,
  onOpenChange,
}: ReactionDetailsProps): ReactElement {
  const { groups, total, rows, handleRemoveReaction } = useReactionsSheetModel({
    raw: reactions,
    messageId: reactions[0]?.messageId,
    currentUserId,
  });

  return (
    <ReactionsBottomSheet
      isOpen
      onOpenChange={onOpenChange}
      rows={rows}
      groups={groups}
      total={total}
      currentUserId={currentUserId}
      onRemoveReaction={handleRemoveReaction}
    />
  );
}
