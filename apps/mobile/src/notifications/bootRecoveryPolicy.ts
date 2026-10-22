/**
 * Pure decisions for the push-notification boot sequence.
 *
 * Why this exists: the boot sequence can stop early (permission denied, or no
 * FCM token yet). Before this policy, an early stop left the service marked as
 * started with no listeners and no registration, and nothing ever retried —
 * so a user who later enabled notifications in OS Settings stayed
 * unregistered (no push at all) until they signed out and back in.
 *
 * Kept free of React Native imports so it can be unit tested directly.
 */

/**
 * - `idle`: not started for this session (initial, or after stop()).
 * - `booting`: the boot sequence is running.
 * - `blocked`: boot stopped early; a foreground recovery may re-run it.
 * - `listening`: boot completed; payload + token-refresh listeners attached.
 */
export type NotificationBootPhase = 'idle' | 'booting' | 'blocked' | 'listening';

export type NotificationBootBlockReason = 'permission_denied' | 'token_unavailable';

export type ForegroundRecoveryAction = 'none' | 'reboot' | 'retry_registration';

/** A new boot may begin only when no boot is running or already complete. */
export function canBeginBoot(phase: NotificationBootPhase): boolean {
  return phase === 'idle' || phase === 'blocked';
}

export type ForegroundRecoveryInput = Readonly<{
  phase: NotificationBootPhase;
  hasAuthToken: boolean;
  registrationConfirmed: boolean;
  recoveryInFlight: boolean;
  /**
   * OS notification permission read WITHOUT prompting. `null` = unknown.
   * Recovery never prompts: a re-run boot only happens once permission is
   * already granted, so returning to the app never shows a permission dialog.
   */
  permissionGranted: boolean | null;
}>;

/** What to do when the app returns to the foreground. */
export function decideForegroundRecovery(input: ForegroundRecoveryInput): ForegroundRecoveryAction {
  if (!input.hasAuthToken || input.recoveryInFlight) return 'none';

  if (input.phase === 'blocked') {
    return input.permissionGranted === true ? 'reboot' : 'none';
  }

  if (input.phase === 'listening' && !input.registrationConfirmed) {
    return 'retry_registration';
  }

  return 'none';
}

/**
 * Map an OS permission label to "can show notifications". `unknown` → `null`
 * so recovery stays conservative and never acts on a status it could not read.
 */
export function isPermissionGranted(
  status: 'authorized' | 'provisional' | 'denied' | 'not_determined' | 'unknown',
): boolean | null {
  if (status === 'authorized' || status === 'provisional') return true;
  if (status === 'denied' || status === 'not_determined') return false;
  return null;
}

/** True only for a background/inactive → active transition. */
export function isForegroundTransition(previous: string, next: string): boolean {
  return previous !== 'active' && next === 'active';
}

const MAX_REGISTRATION_ERROR_LENGTH = 120;

/** Short, token-free error description for telemetry. */
export function describeRegistrationError(error: unknown): string {
  const raw =
    error instanceof Error ? `${error.name}: ${error.message}` : String(error ?? 'unknown');
  // Never ship anything that looks like a bearer or push token.
  const redacted = raw.replace(/[A-Za-z0-9_\-:.]{40,}/g, '[redacted]');
  return redacted.slice(0, MAX_REGISTRATION_ERROR_LENGTH);
}
