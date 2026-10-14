import { Plus } from 'lucide-react-native';
import { memo, type ReactElement, useRef } from 'react';
import { Pressable } from 'react-native';
import { KeyboardController } from 'react-native-keyboard-controller';
import { useCSSVariable } from 'uniwind';

import {
  COMPOSER_INPUT_ATTACHMENT_BUTTON_PADDING,
  COMPOSER_INPUT_ATTACHMENT_ICON_SIZE,
} from './composer-input-typography';
import {
  useChatInputActions,
  useChatInputConversation,
  useChatInputHandlers,
  useChatInputPanelState,
} from './input-composer-context';
import type { ChatInputActionProps } from './input-composer.types';
import { cn } from '@/src/utils/cn';

const AttachmentActionComponent = ({
  className,
  onPress,
}: ChatInputActionProps): ReactElement | null => {
  const { isEditing } = useChatInputConversation();
  const { isInputFocused } = useChatInputPanelState();
  const { inputRef } = useChatInputHandlers();
  const { setIsAttachSheetOpenState } = useChatInputActions();
  const foregroundColor = useCSSVariable('--color-foreground') as string;
  const isOpeningSheetRef = useRef(false);

  if (isEditing) {
    return null;
  }

  return (
    <Pressable
      accessibilityRole='button'
      accessibilityLabel='Add attachment'
      onPress={() => {
        if (onPress !== undefined) {
          onPress();
          return;
        }
        if (isOpeningSheetRef.current) return;

        isOpeningSheetRef.current = true;
        void (async () => {
          inputRef.current?.blur();
          await KeyboardController.dismiss();
          setIsAttachSheetOpenState(true);
          isOpeningSheetRef.current = false;
        })();
      }}
      className={cn('rounded-full ', className)}
      style={{
        backgroundColor: isInputFocused ? 'transparent' : 'rgba(128,128,128,0.08)',
        padding: isInputFocused ? 0 : COMPOSER_INPUT_ATTACHMENT_BUTTON_PADDING,
      }}
    >
      <Plus size={COMPOSER_INPUT_ATTACHMENT_ICON_SIZE} color={foregroundColor} />
    </Pressable>
  );
};
const AttachmentAction = memo(AttachmentActionComponent);

AttachmentAction.displayName = 'ChatInput.AttachmentAction';

export { AttachmentAction };
