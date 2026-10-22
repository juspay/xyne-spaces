import { useCallback, useRef } from 'react';
import { Keyboard, type GestureResponderEvent } from 'react-native';
import { KeyboardController } from 'react-native-keyboard-controller';

const TAP_DISMISS_MOVE_THRESHOLD = 8;

type TapDismissTouch = {
  pageX: number;
  pageY: number;
  moved: boolean;
};

/**
 * Dismiss the keyboard when the user taps scroll content without dragging.
 * Used by surfaces that place the shared composer over scrollable content.
 */
export function useTapToDismissKeyboard(enabled = true): {
  dismissKeyboard: () => void;
  onTouchStart: (event: GestureResponderEvent) => void;
  onTouchMove: (event: GestureResponderEvent) => void;
  onTouchEnd: () => void;
} {
  const tapDismissTouchRef = useRef<TapDismissTouch>({ pageX: 0, pageY: 0, moved: false });

  const dismissKeyboard = useCallback((): void => {
    Keyboard.dismiss();
    KeyboardController.dismiss();
  }, []);

  const onTouchStart = useCallback(
    (event: GestureResponderEvent): void => {
      if (!enabled) return;
      const { pageX, pageY } = event.nativeEvent;
      tapDismissTouchRef.current = { pageX, pageY, moved: false };
    },
    [enabled],
  );

  const onTouchMove = useCallback(
    (event: GestureResponderEvent): void => {
      if (!enabled) return;
      const { pageX, pageY } = event.nativeEvent;
      const start = tapDismissTouchRef.current;
      if (
        Math.abs(pageX - start.pageX) > TAP_DISMISS_MOVE_THRESHOLD ||
        Math.abs(pageY - start.pageY) > TAP_DISMISS_MOVE_THRESHOLD
      ) {
        start.moved = true;
      }
    },
    [enabled],
  );

  const onTouchEnd = useCallback((): void => {
    if (!enabled) return;
    if (!tapDismissTouchRef.current.moved) {
      dismissKeyboard();
    }
  }, [dismissKeyboard, enabled]);

  return { dismissKeyboard, onTouchStart, onTouchMove, onTouchEnd };
}
