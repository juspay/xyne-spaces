import { memo, type ReactElement, useEffect } from 'react';
import { Platform } from 'react-native';
import { KeyboardEvents } from 'react-native-keyboard-controller';

import { useChatInputActions } from './input-composer-context';

const KeyboardLifecycleComponent = (): ReactElement | null => {
  const {
    setIsFormattingVisibleState,
    setIsMentionOpenState,
    setMentionQueryState,
    setMentionModeState,
  } = useChatInputActions();

  useEffect(() => {
    const hideEvent = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';
    const hideSub = KeyboardEvents.addListener(hideEvent, () => {
      setIsFormattingVisibleState(false);
      setIsMentionOpenState(false);
      setMentionQueryState('');
      setMentionModeState('@');
    });
    return (): void => {
      hideSub.remove();
    };
  }, [
    setIsFormattingVisibleState,
    setIsMentionOpenState,
    setMentionQueryState,
    setMentionModeState,
  ]);

  return null;
};
const KeyboardLifecycle = memo(KeyboardLifecycleComponent);

KeyboardLifecycle.displayName = 'ChatInput.KeyboardLifecycle';

export { KeyboardLifecycle };
