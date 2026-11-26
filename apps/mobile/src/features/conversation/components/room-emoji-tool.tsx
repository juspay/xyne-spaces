import { Smile } from 'lucide-react-native';
import { useCallback, useRef, type ReactElement } from 'react';

import { useChatInputActions, useChatInputHandlers } from '@/src/components/input-composer';
import { dismissKeyboardForSheet } from '@/src/utils/dismiss-keyboard-for-sheet';

import {
  TYPING_BAR_EMOJI_KEYBOARD_WAIT_MS,
  TYPING_BAR_ICON_SIZE,
  TYPING_BAR_TOOL_HIT_SLOP,
  TYPING_BAR_TOOL_SIZE,
} from '../constants';
import { IconButton } from './icon-button';

const keyboardWaitCap = (): Promise<void> =>
  new Promise(resolve => setTimeout(resolve, TYPING_BAR_EMOJI_KEYBOARD_WAIT_MS));

/**
 * Emoji in the focused card's tool row: puts the keyboard away and opens the
 * composer's emoji sheet, inserting where the caret was.
 */
export function RoomEmojiTool({
  color,
  disabled,
}: {
  color: string;
  disabled: boolean;
}): ReactElement {
  const { inputRef, rememberSelectionForEmojiInsert } = useChatInputHandlers();
  const { setIsEmojiPickerOpenState, setIsFormattingVisibleState, setIsMentionOpenState } =
    useChatInputActions();
  // Set at the tap: a second tap while the keyboard goes must not open a second sheet.
  const openingRef = useRef(false);

  const open = useCallback((): void => {
    if (openingRef.current) return;
    openingRef.current = true;
    void (async (): Promise<void> => {
      // Before the blur, so a custom emoji lands at the caret rather than the end.
      rememberSelectionForEmojiInsert();
      inputRef.current?.blur();
      setIsFormattingVisibleState(false);
      setIsMentionOpenState(false);
      try {
        // Capped: the keyboard wait can miss the hide and never settle.
        await Promise.race([dismissKeyboardForSheet(), keyboardWaitCap()]);
        setIsEmojiPickerOpenState(true);
      } finally {
        openingRef.current = false;
      }
    })();
  }, [
    inputRef,
    rememberSelectionForEmojiInsert,
    setIsEmojiPickerOpenState,
    setIsFormattingVisibleState,
    setIsMentionOpenState,
  ]);

  return (
    <IconButton
      label='Emoji'
      size={TYPING_BAR_TOOL_SIZE}
      hitSlop={TYPING_BAR_TOOL_HIT_SLOP}
      disabled={disabled}
      onPress={open}
    >
      <Smile size={TYPING_BAR_ICON_SIZE} color={color} />
    </IconButton>
  );
}
