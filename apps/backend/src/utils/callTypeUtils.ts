import { CallType, ShareableEntityType, RecordingType } from '@xyne/shared';

/**
 * Calls and recordings share the `Call` table and are told apart only by
 * `callType`: HEADLESS is a NOTE_TAKER ("Xyne Oats") recording, everything else
 * is a real meeting. That comparison is spread across the call controller, the
 * recording endpoints and the LiveKit webhooks, so it lives here once.
 *
 * Accepts anything carrying a `callType` — a Prisma row, a Zero row, or parsed
 * room metadata — and treats a missing call as not a recording.
 */
type CallTypeCarrier = { callType?: CallType | string | null };

export function isRecording(call: CallTypeCarrier | null | undefined): boolean {
  return call?.callType === CallType.HEADLESS;
}

export function callSubject(call: CallTypeCarrier | null | undefined): 'recording' | 'call' {
  return isRecording(call) ? 'recording' : 'call';
}

/**
 * The `ShareableEntityType` a call's shares are filed under. Recordings and
 * regular calls each own their own type, so a share of one never widens the
 * audience of the other.
 */
export function shareEntityTypeFor(call: CallTypeCarrier | string | null | undefined): string {
  const callType = typeof call === 'string' ? call : call?.callType;
  return callType === CallType.HEADLESS
    ? ShareableEntityType.NOTE_TAKER
    : ShareableEntityType.CALL;
}

export function isRecordingType(value: unknown): value is RecordingType {
  return Object.values(RecordingType).includes(value as RecordingType);
}
