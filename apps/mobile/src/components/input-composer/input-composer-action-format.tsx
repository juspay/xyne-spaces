import { CaseSensitive } from 'lucide-react-native';
import { memo, type ReactElement } from 'react';
import { Pressable } from 'react-native';
import { useCSSVariable } from 'uniwind';

import { useChatInputActions, useChatInputPanelState } from './input-composer-context';
import type { ChatInputActionProps } from './input-composer.types';

const FormatActionComponent = ({ className }: ChatInputActionProps): ReactElement => {
  const { isFormattingVisible } = useChatInputPanelState();
  const { setIsFormattingVisibleState } = useChatInputActions();
  const secondaryForeground = useCSSVariable('--color-secondary-foreground') as string;

  return (
    <Pressable
      accessibilityRole='button'
      accessibilityLabel='Toggle formatting options'
      onPress={() => setIsFormattingVisibleState(!isFormattingVisible)}
      className={className ?? 'p-2 rounded-full items-center justify-center'}
      style={{
        backgroundColor: isFormattingVisible ? 'rgba(0,0,0,0.08)' : 'transparent',
      }}
    >
      <CaseSensitive size={20} color={secondaryForeground} />
    </Pressable>
  );
};
const FormatAction = memo(FormatActionComponent);

FormatAction.displayName = 'ChatInput.FormatAction';

export { FormatAction };
