let pendingSuppression = false;

/** Skip the next scroll-surface tap that would dismiss the keyboard. */
export function suppressListTapDismissKeyboard(): void {
  pendingSuppression = true;
}

/** Returns true once when a child input requested tap-dismiss suppression. */
export function consumeListTapDismissSuppression(): boolean {
  if (!pendingSuppression) return false;
  pendingSuppression = false;
  return true;
}
