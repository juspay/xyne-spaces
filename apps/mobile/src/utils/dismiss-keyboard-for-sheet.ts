import { Keyboard } from 'react-native';
import { KeyboardController } from 'react-native-keyboard-controller';

/**
 * Serializes keyboard dismissal before presenting an overlay sheet.
 *
 * WARNING: this can hang. `Keyboard.dismiss()` already starts the hide, so by
 * the time `KeyboardController.isVisible()` is checked the "did hide" event may
 * have been consumed and the awaited `dismiss()` never settles. Await it only
 * where a stuck promise is harmless — global search's filter row calls
 * `Keyboard.dismiss()` synchronously instead, and input-composer-action-emoji
 * holds `isOpeningPickerRef` across the await, which would dead-end that button
 * for the session. Fix or drop this helper rather than adding awaited callers.
 */
export async function dismissKeyboardForSheet(): Promise<void> {
  // KeyboardController can resolve immediately if a just-focused input has not
  // emitted keyboardWillShow. Dismiss natively, yield one frame for that state
  // to settle, then await the real native hide if it became visible.
  Keyboard.dismiss();

  await new Promise<void>(resolve => {
    requestAnimationFrame(() => resolve());
  });

  if (KeyboardController.isVisible()) {
    await KeyboardController.dismiss();
  }
}
