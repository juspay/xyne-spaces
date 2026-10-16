import type { KeyboardStickyViewProps } from 'react-native-keyboard-controller';

export type ChatComposerInsetMode = 'screen' | 'embedded';

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

export const getChatComposerBottomPadding = (
  bottomSafeAreaInset: number,
  includeBottomSafeArea: boolean,
): number => (includeBottomSafeArea ? bottomSafeAreaInset : 0) + CHAT_COMPOSER_SURFACE_BOTTOM_GAP;

export const includesChatComposerBottomSafeArea = (insetMode: ChatComposerInsetMode): boolean =>
  insetMode === 'screen';

export const getChatKeyboardStickyOffset = (
  bottomSafeAreaInset: number,
): NonNullable<KeyboardStickyViewProps['offset']> => ({
  closed: 0,
  opened: bottomSafeAreaInset,
});

/**
 * Returns the one keyboard geometry contract shared by the dock and its list.
 * `listOffset` is the distance between the list bottom and the window bottom;
 * `stickyOffset` is the matching dock translation offset.
 */
export const getChatKeyboardGeometry = (
  bottomSafeAreaInset: number,
  insetMode: ChatComposerInsetMode = 'screen',
): ChatKeyboardGeometry => {
  const listOffset =
    includesChatComposerBottomSafeArea(insetMode) && Number.isFinite(bottomSafeAreaInset)
      ? Math.max(0, bottomSafeAreaInset)
      : 0;
  return {
    listOffset,
    stickyOffset: getChatKeyboardStickyOffset(listOffset),
  };
};
