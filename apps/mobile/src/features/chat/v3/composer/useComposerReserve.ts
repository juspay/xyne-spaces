import { useKeyboardChatComposerInset } from '@legendapp/list/keyboard';

import { CHAT_COMPOSER_INITIAL_INSET_HEIGHT } from './chatKeyboardConfig';

/**
 * Named inset from design §6.2 / B8. Calls the library hook; does not
 * hand-roll a SharedValue or a competing list `paddingBottom`.
 */
export const useComposerReserve = (
  listRef: Parameters<typeof useKeyboardChatComposerInset>[0],
  composerRef: Parameters<typeof useKeyboardChatComposerInset>[1],
  initialHeight = CHAT_COMPOSER_INITIAL_INSET_HEIGHT,
): ReturnType<typeof useKeyboardChatComposerInset> =>
  useKeyboardChatComposerInset(listRef, composerRef, initialHeight);
