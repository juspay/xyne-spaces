import { memo, type ReactElement } from 'react';
import { Pressable } from 'react-native';
import { X } from 'lucide-react-native';
import { useCSSVariable } from 'uniwind';

import { useChatInputActions } from './input-composer-context';

const CloseFormatComponent = (): ReactElement => {
  const { setIsFormattingVisibleState } = useChatInputActions();
  const foreground = useCSSVariable('--color-foreground') as string;

  return (
    <Pressable onPress={() => setIsFormattingVisibleState(false)}>
      <X size={18} color={foreground} />
    </Pressable>
  );
};

const CloseFormat = memo(CloseFormatComponent);
CloseFormat.displayName = 'ChatInput.CloseFormat';

export { CloseFormat };
