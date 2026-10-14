import { callService } from '@/src/services/Call/callService';

export type ReportedRingStatus = 'RINGING' | 'BUSY';

/** `callId:status` pairs this device already sent. */
const reported = new Set<string>();

/**
 * Tells the caller this device has the incoming call — "Ringing…", or "On another call" when you
 * already are on one — the same signal the dashboard sends. Sent once per call and status; the
 * backend only ever raises it, so a late RINGING can't undo BUSY. Best-effort: on failure the
 * caller keeps seeing "Calling…", so it is logged and left free to retry.
 */
export function reportCallRingStatus(callId: string, ringStatus: ReportedRingStatus): void {
  const key = `${callId}:${ringStatus}`;
  if (!callId || reported.has(key)) return;
  reported.add(key);
  callService.reportRingStatus(callId, ringStatus).catch((error: unknown) => {
    reported.delete(key);
    console.warn('[XYNE_CALL] reportCallRingStatus failed', { callId, ringStatus, error });
  });
}
