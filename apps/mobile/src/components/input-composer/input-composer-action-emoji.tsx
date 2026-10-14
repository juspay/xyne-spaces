import { Smile } from 'lucide-react-native';
import { memo, type ReactElement, useRef } from 'react';
import { Pressable } from 'react-native';
import { useCSSVariable } from 'uniwind';

import { dismissKeyboardForSheet } from '@/src/utils/dismiss-keyboard-for-sheet';
import {
  useChatInputActions,
  useChatInputHandlers,
  useChatInputPanelState,
} from './input-composer-context';
import type { ChatInputActionProps } from './input-composer.types';

const EmojiActionComponent = ({ className, onPress }: ChatInputActionProps): ReactElement => {
  const { isEmojiPickerOpen } = useChatInputPanelState();
  const { inputRef, rememberSelectionForEmojiInsert } = useChatInputHandlers();
  const { setIsEmojiPickerOpenState, setIsFormattingVisibleState, setIsMentionOpenState } =
    useChatInputActions();
  const secondaryForeground = useCSSVariable('--color-secondary-foreground') as string;
  const isOpeningPickerRef = useRef(false);

  return (
    <Pressable
      accessibilityRole='button'
      accessibilityLabel='Emoji picker'
      onPress={() => {
        if (onPress !== undefined) {
          onPress();
          return;
        }
        if (isEmojiPickerOpen) {
          setIsEmojiPickerOpenState(false);
          return;
        }
        if (isOpeningPickerRef.current) return;

        isOpeningPickerRef.current = true;
        void (async (): Promise<void> => {
          // Capture caret before blur — the sheet dismisses the keyboard and
          // would otherwise make custom emoji inserts land at the end.
          rememberSelectionForEmojiInsert();
          inputRef.current?.blur();
          setIsFormattingVisibleState(false);
          setIsMentionOpenState(false);
          await dismissKeyboardForSheet();
          setIsEmojiPickerOpenState(true);
          isOpeningPickerRef.current = false;
        })();
      }}
      className={className ?? 'p-2 rounded-full items-center justify-center'}
      style={{ backgroundColor: isEmojiPickerOpen ? 'rgba(0,0,0,0.08)' : 'transparent' }}
    >
      <Smile size={20} color={secondaryForeground} />
    </Pressable>
  );
};
const EmojiAction = memo(EmojiActionComponent);

EmojiAction.displayName = 'ChatInput.EmojiAction';

export { EmojiAction };
