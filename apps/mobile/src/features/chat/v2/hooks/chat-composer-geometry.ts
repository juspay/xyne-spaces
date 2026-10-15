/**
 * Animate list inset only when the IME is fully gone. While `useKeyboardState`
 * reports visible (willShow → didHide), snap instead so height remounts do not
 * race KeyboardStickyView.
 */
export const shouldAnimateComposerHeight = (
  keyboardIsVisible: boolean,
  didReset = false,
): boolean => !didReset && !keyboardIsVisible;
