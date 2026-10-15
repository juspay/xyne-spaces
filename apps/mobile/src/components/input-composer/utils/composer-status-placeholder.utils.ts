/** Peer status belongs in an empty field. A draft already fills that slot. */
export const shouldShowComposerStatusPlaceholder = ({
  hasStatusEmoji,
  isInputFocused,
  hasDraft,
}: {
  hasStatusEmoji: boolean;
  isInputFocused: boolean;
  hasDraft: boolean;
}): boolean => hasStatusEmoji && !isInputFocused && !hasDraft;
