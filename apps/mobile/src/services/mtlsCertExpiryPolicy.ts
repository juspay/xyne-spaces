/** Pure mTLS cert expiry warning policy (no native / MMKV I/O). */

/** Soft-warn when this many ms remain before `notAfter`. */
export const MTLS_EXPIRY_WARN_WINDOW_MS = 2 * 24 * 60 * 60 * 1000;

const DAY_MS = 24 * 60 * 60 * 1000;

export type MtlsExpiryWarningState =
  | { kind: 'none' }
  | { kind: 'warn'; notAfterIso: string; daysLeft: number; alreadyWarned: boolean };

/**
 * Pure check against a known `notAfter`. Does not mark as warned.
 */
export function evaluateMtlsExpiryWarning(
  notAfterIso: string,
  nowMs: number,
  warnedFor: string | null,
): MtlsExpiryWarningState {
  const notAfterMs = Date.parse(notAfterIso);
  if (Number.isNaN(notAfterMs)) return { kind: 'none' };

  const msLeft = notAfterMs - nowMs;
  // Already expired — hard health-check path handles this; no soft warn.
  if (msLeft <= 0) return { kind: 'none' };
  if (msLeft > MTLS_EXPIRY_WARN_WINDOW_MS) return { kind: 'none' };

  const daysLeft = Math.max(1, Math.ceil(msLeft / DAY_MS));
  return {
    kind: 'warn',
    notAfterIso,
    daysLeft,
    alreadyWarned: warnedFor === notAfterIso,
  };
}
