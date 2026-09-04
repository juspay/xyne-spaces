import { CallType } from '@xyne/shared';

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
