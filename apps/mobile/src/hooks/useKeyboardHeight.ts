import { useState, useEffect } from 'react';
import { Keyboard, Platform } from 'react-native';

/**
 * Hook to track keyboard height for positioning calculations.
 * On iOS, returns the actual keyboard height when visible.
 * On Android, returns 0 as the keyboard resizes the view.
 */
export function useKeyboardHeight(): number {
  const [keyboardHeight, setKeyboardHeight] = useState(0);

  useEffect(() => {
    if (Platform.OS === 'android') {
      return;
    }

    const showSub = Keyboard.addListener('keyboardWillShow', e => {
      setKeyboardHeight(e.endCoordinates.height);
    });

    const hideSub = Keyboard.addListener('keyboardWillHide', () => {
      setKeyboardHeight(0);
    });

    return () => {
      showSub.remove();
      hideSub.remove();
    };
  }, []);

  return keyboardHeight;
}
