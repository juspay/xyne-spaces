const PILL_EMOJI_SIZE_PX = 14;
const MAX_VISIBLE_EMOJIS = 4;
const PILL_HORIZONTAL_PADDING_PX = 12;
const PILL_ITEM_GAP_PX = 6;
const PILL_COUNT_CHARACTER_WIDTH_PX = 8;
const PILL_END_INSET_PX = 8;

/** Keep the reaction pill inside the measured bubble without changing its chrome. */
export const visibleReactionGroupCount = (availableBubbleWidth: number, total: number): number => {
  if (availableBubbleWidth <= 0) return 1;

  const hasVisibleTotal = total > 1;
  const countWidth = hasVisibleTotal ? String(total).length * PILL_COUNT_CHARACTER_WIDTH_PX : 0;
  const availableForEmojis =
    availableBubbleWidth -
    PILL_END_INSET_PX -
    PILL_HORIZONTAL_PADDING_PX -
    countWidth -
    (hasVisibleTotal ? PILL_ITEM_GAP_PX : 0);
  const count = Math.floor(
    (availableForEmojis + PILL_ITEM_GAP_PX) / (PILL_EMOJI_SIZE_PX + PILL_ITEM_GAP_PX),
  );
  return Math.max(1, Math.min(MAX_VISIBLE_EMOJIS, count));
};
