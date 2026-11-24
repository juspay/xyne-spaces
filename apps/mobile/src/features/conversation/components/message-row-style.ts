import type { PressableStateCallbackType } from 'react-native';

import {
  MESSAGE_GAP,
  MESSAGE_HEADER_GAP,
  MESSAGE_PADDING_X,
  MESSAGE_PADDING_Y,
  PRESSED_OPACITY,
} from '../constants';

/**
 * How the room lays out and writes a message, for every row drawn as one (the
 * room's own rows and find results), so they cannot drift apart.
 */
export const MESSAGE_ROW_STYLE = {
  paddingHorizontal: MESSAGE_PADDING_X,
  paddingVertical: MESSAGE_PADDING_Y,
  columnGap: MESSAGE_GAP,
} as const;
const MESSAGE_ROW_PRESSED_STYLE = { ...MESSAGE_ROW_STYLE, opacity: PRESSED_OPACITY } as const;

export const getMessageRowStyle = ({
  pressed,
}: PressableStateCallbackType): typeof MESSAGE_ROW_STYLE =>
  pressed ? MESSAGE_ROW_PRESSED_STYLE : MESSAGE_ROW_STYLE;

/** The header line: the name, any tag, the time and marks, 6 apart. */
export const MESSAGE_HEADER_STYLE = { columnGap: MESSAGE_HEADER_GAP } as const;
export const MESSAGE_HEADER_CLASS = 'mb-0.5 flex-row items-center';

/** The sender's name, Figma Type/Title, shrinking before anything after it does. */
export const MESSAGE_NAME_TEXT_CLASS =
  'min-w-0 shrink text-[16px] font-medium leading-5 tracking-[-0.24px] text-spaces-foreground';

/** The header's quiet text: the time, and "(edited)" after it. */
export const MESSAGE_META_TEXT_CLASS = 'text-[14px] leading-[18px] text-spaces-subtle';
