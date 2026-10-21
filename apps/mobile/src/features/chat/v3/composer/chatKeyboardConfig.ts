import type { KeyboardStickyViewProps } from 'react-native-keyboard-controller';

/**
 * §8.1 reuse gate: **Adopt**. Characterised against v2 chatKeyboardConfig.
 * Lives in v3 so Phase 11 can delete the v2 copy without a flag day.
 */

export type ChatKeyboardGeometry = Readonly<{
  listOffset: number;
  stickyOffset: NonNullable<KeyboardStickyViewProps['offset']>;
}>;

export const CHAT_KEYBOARD_GESTURE_INTERPOLATOR = 'ios' as const;
export const CHAT_KEYBOARD_GESTURE_OFFSET = 60;
export const CHAT_KEYBOARD_SHOULD_PERSIST_TAPS = 'handled' as const;
export const CHAT_KEYBOARD_SCROLL_CLOSE_ON_SEND = false;
export const CHAT_COMPOSER_SURFACE_TOP_PADDING = 8;
export const CHAT_COMPOSER_SURFACE_BOTTOM_GAP = 8;
export const CHAT_COMPOSER_FIELD_VERTICAL_PADDING = 20;
/** First-frame inset until dock `onLayout`. Matches the Legend List keyboard example. */
export const CHAT_COMPOSER_INITIAL_INSET_HEIGHT = 80;

export const getChatComposerBottomPadding = (
  bottomSafeAreaInset: number,
  includeBottomSafeArea: boolean,
): number => (includeBottomSafeArea ? bottomSafeAreaInset : 0) + CHAT_COMPOSER_SURFACE_BOTTOM_GAP;

export const getChatKeyboardStickyOffset = (
  bottomSafeAreaInset: number,
): NonNullable<KeyboardStickyViewProps['offset']> => ({
  closed: 0,
  opened: bottomSafeAreaInset,
});

/**
 * One keyboard geometry contract for the dock and its list.
 * `listOffset` is the distance between the list bottom and the window bottom;
 * `stickyOffset` is the matching dock translation offset.
 */
export const getChatKeyboardGeometry = (bottomSafeAreaInset: number): ChatKeyboardGeometry => {
  const listOffset = Number.isFinite(bottomSafeAreaInset) ? Math.max(0, bottomSafeAreaInset) : 0;
  return {
    listOffset,
    stickyOffset: getChatKeyboardStickyOffset(listOffset),
  };
};
