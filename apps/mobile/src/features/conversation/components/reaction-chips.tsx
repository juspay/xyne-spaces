import { memo, useCallback, useMemo, type ReactElement } from 'react';
import { View } from 'react-native';
import type { User } from '@xyne/shared';
import { usePendingByMessageId } from '@xyne/shared/messages';

import { groupReactionsForPill } from '@/src/components/chat/message/reactions/reaction-pill.utils';
import { useChatRenderTokens } from '@/src/features/chat/v2/components/chat/message-row';
import type { ChatPaintRow } from '@/src/features/chat/v2/paint/chatPaint.types';
import { haptics } from '@/src/utils/haptics';

import { REACTION_CHIP_GAP } from '../constants';
import { useTransientSheet } from '../hooks/use-transient-sheet';
import { AddReactionSheet } from './add-reaction-sheet';
import { useConversationCanReact } from './conversation-palette';
import { AddReactionChip, ReactionChip } from './reaction-chip';
import { ReactionsSheet } from './reactions-sheet';

const ROW_STYLE = { gap: REACTION_CHIP_GAP } as const;

type ReactionChipsProps = {
  paintRow: ChatPaintRow;
  currentUser: User | undefined;
  hydrateCustomEmoji: boolean;
};

/**
 * Emoji and count chips under a message, ended by a "+" that opens the emoji
 * picker. Tapping a chip opens who reacted, where your own reaction can be removed.
 * The "+" follows the hold menu's reaction rail: absent where the screen does
 * not allow reacting and on a message that has not been sent.
 */
export const ReactionChips = memo(function ReactionChips({
  paintRow,
  currentUser,
  hydrateCustomEmoji,
}: ReactionChipsProps): ReactElement | null {
  const { mutedForeground } = useChatRenderTokens();
  const details = useTransientSheet();
  const picker = useTransientSheet();
  const reactions = paintRow.reactionPreview?.reactions;
  const { messageId } = paintRow;
  const canReact = useConversationCanReact();
  const pendingEntry = usePendingByMessageId(messageId ?? '');
  const reactableMessageId = canReact && !pendingEntry ? messageId : undefined;
  const groups = useMemo(() => groupReactionsForPill(reactions ?? []), [reactions]);

  const { open: openDetails } = details;
  const handleOpenDetails = useCallback((): void => {
    void haptics.buttonTap();
    openDetails();
  }, [openDetails]);

  const { open: openPicker } = picker;
  const handleOpenPicker = useCallback((): void => {
    void haptics.buttonTap();
    openPicker();
  }, [openPicker]);

  if (!reactions || groups.length === 0) return null;

  return (
    <View className='flex-row flex-wrap' style={ROW_STYLE}>
      {groups.map(group => (
        <ReactionChip
          key={group.emojiName}
          id={group.emojiName}
          label={String(group.count)}
          emojiName={group.emojiName}
          hydrateCustomEmoji={hydrateCustomEmoji}
          accessibilityLabel={`${group.count} ${group.emojiName} ${group.count === 1 ? 'reaction' : 'reactions'}`}
          onPress={handleOpenDetails}
          onLongPress={handleOpenDetails}
        />
      ))}
      {reactableMessageId ? (
        <AddReactionChip iconColor={mutedForeground} onPress={handleOpenPicker} />
      ) : null}
      {details.mounted ? (
        <ReactionsSheet
          reactions={reactions}
          currentUserId={currentUser?.id}
          hydrateCustomEmoji={hydrateCustomEmoji}
          isOpen={details.isOpen}
          onOpenChange={details.onOpenChange}
          onDismiss={details.onDismiss}
        />
      ) : null}
      {reactableMessageId && picker.mounted ? (
        <AddReactionSheet
          messageId={reactableMessageId}
          reactions={reactions}
          currentUserId={currentUser?.id}
          isOpen={picker.isOpen}
          onOpenChange={picker.onOpenChange}
          onDismiss={picker.onDismiss}
        />
      ) : null}
    </View>
  );
});
