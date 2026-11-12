/**
 * Decides when a LiveKit `EncryptionError` is worth telling the user about.
 *
 * Every error is logged. A burst of `MissingKey` right after someone joins is the
 * sender's first frames arriving before its encryptor is attached (the mobile SDK
 * does this), so it only becomes a user-facing error if it is still happening after
 * a grace period. A wrong key or any other failure is reported immediately.
 */

// livekit-client does not export CryptorError, so match its `reason` values.
const REASON_MISSING_KEY = 1;

export const MISSING_KEY_GRACE_MS = 3000;
// "Still happening" means an error arrived within this window before the grace ended.
const STILL_FAILING_WINDOW_MS = 1000;

export type EncryptionErrorKind = 'missing_key' | 'decrypt_failure';

type Deps = {
  log: (fields: Record<string, unknown>) => void;
  notify: (kind: EncryptionErrorKind) => void;
  graceMs?: number;
  now?: () => number;
};

type Burst = { firstAt: number; lastAt: number; timer: ReturnType<typeof setTimeout> };

export function createEncryptionErrorReporter({
  log,
  notify,
  graceMs = MISSING_KEY_GRACE_MS,
  now = Date.now,
}: Deps) {
  const bursts = new Map<string, Burst>();
  let notified = false;

  const notifyOnce = (kind: EncryptionErrorKind) => {
    if (notified) return;
    notified = true;
    notify(kind);
  };

  const settle = (participant: string) => {
    const burst = bursts.get(participant);
    if (!burst) return;
    bursts.delete(participant);
    const stillFailing = now() - burst.lastAt <= STILL_FAILING_WINDOW_MS;
    log({
      eventName: stillFailing
        ? 'encryption_missing_key_persisted'
        : 'encryption_missing_key_resolved',
      participantIdentity: participant,
      durationMs: burst.lastAt - burst.firstAt,
    });
    if (stillFailing) notifyOnce('missing_key');
  };

  return {
    report(error: Error, participantIdentity?: string) {
      const reason = (error as { reason?: number }).reason;
      const participant = participantIdentity ?? 'unknown';
      const isMissingKey = reason === REASON_MISSING_KEY;
      log({
        eventName: 'encryption_error',
        participantIdentity: participant,
        reason,
        error: error.message,
      });

      if (!isMissingKey) {
        notifyOnce('decrypt_failure');
        return;
      }
      const burst = bursts.get(participant);
      if (burst) {
        burst.lastAt = now();
        return;
      }
      bursts.set(participant, {
        firstAt: now(),
        lastAt: now(),
        timer: setTimeout(() => settle(participant), graceMs),
      });
    },
    dispose() {
      for (const burst of bursts.values()) clearTimeout(burst.timer);
      bursts.clear();
    },
  };
}
