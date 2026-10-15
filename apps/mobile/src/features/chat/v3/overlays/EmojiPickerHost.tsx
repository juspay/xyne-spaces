import { type ReactElement } from 'react';
import { v4 as uuidv4 } from 'uuid';

import { EmojiPickerBottomSheet, type EmojiPickerSelection } from '@/src/components/emoji-picker';
import { useZero } from '@/src/hooks/useZero';
import { reactionsMdToRawReactions } from '@/src/utils/conversationMessageHelpers';

import type { ReactionsTarget } from './ReactionsHost';
import { toggleReaction } from './toggleReaction';

export type EmojiPickerHostProps = {
  target: ReactionsTarget | null;
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  currentUserId: string | undefined;
};

export function EmojiPickerHost({
  target,
  isOpen,
  onOpenChange,
  currentUserId,
}: EmojiPickerHostProps): ReactElement | null {
  const zero = useZero();
  if (!target) {
    return null;
  }

  const onSelect = (selection: EmojiPickerSelection): void => {
    const messageId = target.messageId;
    if (!messageId || !currentUserId) {
      onOpenChange(false);
      return;
    }
    const emojiName =
      selection.type === 'custom'
        ? `custom:${selection.emojiId}:${selection.name}`
        : selection.value;
    const hasReacted = reactionsMdToRawReactions(target.reactionsMd, messageId).some(
      item => item.emojiName === emojiName && item.userId === currentUserId,
    );
    toggleReaction(zero, {
      messageId,
      emojiName,
      hasReacted,
      createId: uuidv4,
    });
    onOpenChange(false);
  };

  return <EmojiPickerBottomSheet isOpen={isOpen} onOpenChange={onOpenChange} onSelect={onSelect} />;
}
