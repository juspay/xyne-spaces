/**
 * §8.1 reuse gate: **Adopt**. Characterised against v2 awaitKeyboardHidden.
 * Pure aside from the injected driver — no React, no KeyboardController import.
 *
 * `dismiss()` resolves on `keyboardDidHide`. If that event is lost, the wait is
 * bounded so a long-press sheet never hangs. The bound sits above a normal
 * Android IME hide (~250–300ms) so the common case still waits for the real
 * event rather than timing out into the animation we are avoiding.
 */

export const KEYBOARD_HIDE_TIMEOUT_MS = 400;

export type KeyboardDismissalDriver = {
  isVisible: () => boolean;
  dismiss: () => Promise<void>;
};

export type AwaitKeyboardHiddenOptions = {
  timeoutMs?: number;
  /**
   * Snapshot taken before another operation (for example, blurring the input)
   * can make `isVisible()` return false while the native hide is still running.
   */
  wasVisible?: boolean;
};

export const awaitKeyboardHidden = async (
  keyboard: KeyboardDismissalDriver,
  {
    timeoutMs = KEYBOARD_HIDE_TIMEOUT_MS,
    wasVisible = keyboard.isVisible(),
  }: AwaitKeyboardHiddenOptions = {},
): Promise<void> => {
  if (!wasVisible) {
    return;
  }

  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      keyboard.dismiss().catch(() => undefined),
      new Promise<void>(resolve => {
        timer = setTimeout(resolve, timeoutMs);
      }),
    ]);
  } catch {
    // A dismiss that rejects must not block the caller either.
  } finally {
    if (timer !== undefined) {
      clearTimeout(timer);
    }
  }
};
