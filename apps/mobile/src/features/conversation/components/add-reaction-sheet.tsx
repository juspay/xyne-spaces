import { useCallback, type ReactElement } from 'react';
import { v4 as uuidv4 } from 'uuid';

import type { RawReaction } from '@/src/components/chat/message/reactions/reaction-pill.utils';
import { EmojiPickerBottomSheet, type EmojiPickerSelection } from '@/src/components/emoji-picker';
import { toggleReaction } from '@/src/features/chat/v3/overlays/toggleReaction';
import { useZero } from '@/src/hooks/useZero';

type AddReactionSheetProps = {
  messageId: string;
  reactions: readonly RawReaction[];
  currentUserId: string | undefined;
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  onDismiss: () => void;
};

/**
 * The emoji picker behind the add-reaction pill: the same picker and the same
 * toggle the hold menu's "more reactions" runs, so picking an emoji you
 * already reacted with takes it back.
 */
export function AddReactionSheet({
  messageId,
  reactions,
  currentUserId,
  isOpen,
  onOpenChange,
  onDismiss,
}: AddReactionSheetProps): ReactElement {
  const zero = useZero();

  const handleSelect = useCallback(
    (selection: EmojiPickerSelection): void => {
      if (!currentUserId) return;
      const emojiName =
        selection.type === 'custom'
          ? `custom:${selection.emojiId}:${selection.name}`
          : selection.value;
      const hasReacted = reactions.some(
        reaction => reaction.emojiName === emojiName && reaction.userId === currentUserId,
      );
      toggleReaction(zero, { messageId, emojiName, hasReacted, createId: uuidv4 });
    },
    [currentUserId, messageId, reactions, zero],
  );

  return (
    <EmojiPickerBottomSheet
      isOpen={isOpen}
      onOpenChange={onOpenChange}
      onDismiss={onDismiss}
      onSelect={handleSelect}
    />
  );
}
