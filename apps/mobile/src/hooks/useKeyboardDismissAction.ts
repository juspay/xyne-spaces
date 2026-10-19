import { useCallback, useEffect, useRef } from 'react';
import { Keyboard } from 'react-native';
import { KeyboardController } from 'react-native-keyboard-controller';

import { dismissRegisteredComposerFocus } from '@/src/utils/composerFocusDismissRegistry';

export function useKeyboardDismissAction(action: () => void): () => void {
  const actionRef = useRef(action);

  useEffect(() => {
    actionRef.current = action;
  }, [action]);

  return useCallback(() => {
    dismissRegisteredComposerFocus();
    Keyboard.dismiss();
    void KeyboardController.dismiss();
    actionRef.current();
  }, []);
}
