/**
 * `dismiss()` resolves on `keyboardDidHide`. If that event is ever lost, the
 * promise never settles, so the wait is bounded — a long press must never be
 * swallowed by a keyboard that failed to report itself. The bound sits above a
 * normal Android IME hide (~250-300ms) so the common case still waits for the
 * real event rather than timing out into the animation we are avoiding.
 */
const KEYBOARD_HIDE_TIMEOUT_MS = 400;

export type KeyboardDismissalDriver = {
  isVisible: () => boolean;
  dismiss: () => Promise<void>;
};

type AwaitKeyboardHiddenOptions = {
  timeoutMs?: number;
  /**
   * Snapshot taken before another operation (for example, blurring the input)
   * can make `isVisible()` return false while the native hide is still running.
   */
  wasVisible?: boolean;
};

/**
 * Waits for the keyboard hide animation to finish before the caller proceeds,
 * e.g. mounting a bottom sheet. The composer dock rides a `KeyboardStickyView`,
 * so it is still travelling to its resting position while the IME hides;
 * mounting a sheet mid-animation is what leaves it floating for a few frames.
 */
export const awaitKeyboardHidden = async (
  keyboard: KeyboardDismissalDriver,
  {
    timeoutMs = KEYBOARD_HIDE_TIMEOUT_MS,
    wasVisible = keyboard.isVisible(),
  }: AwaitKeyboardHiddenOptions = {},
): Promise<void> => {
  if (!wasVisible) return;

  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      keyboard.dismiss(),
      new Promise<void>(resolve => {
        timer = setTimeout(resolve, timeoutMs);
      }),
    ]);
  } catch {
    // A dismiss that rejects must not block the caller either.
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
};
