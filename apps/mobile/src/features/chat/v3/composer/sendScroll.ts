import { CHAT_KEYBOARD_SCROLL_CLOSE_ON_SEND } from './chatKeyboardConfig';

/**
 * Send landing (design B8). v2 uses scrollMessageToEnd + composer inset.
 * Do not pass anchoredEndSpace for the last row: the library sizes trailing
 * space as `viewport - tailFromAnchor - offset`, so offset 12 on the last
 * index pins that row to the viewport start and glues the thread to the top.
 */
export const sendScrollToEndOptions = {
  animated: true,
  closeKeyboard: CHAT_KEYBOARD_SCROLL_CLOSE_ON_SEND,
} as const;
