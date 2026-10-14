import type { CallEndReason, CallKitPayload } from './CallKit.types';
import { CallType } from '@xyne/shared';

/**
 * How long a call may ring on this device before it is reported as unanswered.
 * Enforced natively on both platforms (works with the JS runtime dead) and
 * mirrored in JS. Keep in sync with `ringTimeoutSeconds` in
 * plugins/withVoipPushIOS.cjs and `RING_TIMEOUT_MS` in
 * plugins/withNativeIncomingCallAndroid.cjs.
 */
export const CALL_RING_TIMEOUT_MS = 30_000;

/**
 * A ring push older than this never rings: APNs/FCM held it while the device
 * was offline, and the call is long over. Age comes from the backend `sentAt`
 * (iOS + Android) or FCM's server `sentTime` (Android).
 */
export const STALE_CALL_PUSH_THRESHOLD_MS = 30_000;

function parseMetadata(data: Record<string, unknown>): Record<string, unknown> {
  const metadataRaw = data['metadata'];
  if (typeof metadataRaw === 'string') {
    try {
      return JSON.parse(metadataRaw) as Record<string, unknown>;
    } catch {
      return {};
    }
  }

  if (typeof metadataRaw === 'object' && metadataRaw !== null) {
    return metadataRaw as Record<string, unknown>;
  }

  return {};
}

export function parseIncomingCallPayload(data: unknown): CallKitPayload | null {
  if (!data || typeof data !== 'object') {
    return null;
  }

  const payloadData = data as Record<string, unknown>;
  const type = typeof payloadData['type'] === 'string' ? payloadData['type'] : '';
  const isIncomingCall = payloadData['isIncomingCall'] === true;
  const callAction = typeof payloadData['callAction'] === 'string' ? payloadData['callAction'] : '';

  // Accept:
  // - type === 'INCOMING_CALL'
  // - isIncomingCall === true
  // - callAction is 'answer' or 'decline' (background notification actions)
  const isValidCallNotification =
    type === 'INCOMING_CALL' ||
    isIncomingCall ||
    callAction === 'answer' ||
    callAction === 'decline';

  if (!isValidCallNotification) {
    return null;
  }

  const metadata = parseMetadata(payloadData);
  const callId =
    (typeof metadata['callId'] === 'string' ? metadata['callId'] : null) ||
    (typeof payloadData['callId'] === 'string' ? payloadData['callId'] : null) ||
    (typeof payloadData['relatedEntityId'] === 'string' ? payloadData['relatedEntityId'] : null);

  if (!callId) {
    return null;
  }

  const callerName =
    (typeof metadata['callerName'] === 'string' ? metadata['callerName'] : null) ||
    (typeof payloadData['msg_title'] === 'string' ? payloadData['msg_title'] : null) ||
    'Unknown Caller';

  const callType = metadata['callType'] === 'VIDEO' ? CallType.VIDEO : CallType.AUDIO;
  const channelId = typeof metadata['channelId'] === 'string' ? metadata['channelId'] : undefined;
  const token = typeof metadata['token'] === 'string' ? metadata['token'] : undefined;
  const liveKitUrl =
    typeof metadata['liveKitUrl'] === 'string' ? metadata['liveKitUrl'] : undefined;
  const serverUrlFromMetadata =
    typeof metadata['serverUrl'] === 'string' ? metadata['serverUrl'] : undefined;

  const payload: CallKitPayload = {
    callId,
    callUUID: callId,
    callerName,
    callType,
  };

  if (channelId) {
    payload.channelId = channelId;
  }
  if (token) {
    payload.token = token;
  }
  const serverUrl = liveKitUrl ?? serverUrlFromMetadata;
  if (serverUrl) {
    payload.serverUrl = serverUrl;
  }

  return payload;
}

export interface CallDismissPayload {
  type: 'CALL_DISMISS' | 'MISSED_CALL';
  callId?: string;
  /** Backend-provided reason (answered / declined / cancelled / timeout …), lower-cased. */
  reason?: string;
}

export function parseCallDismissPayload(data: unknown): CallDismissPayload | null {
  if (!data || typeof data !== 'object') {
    return null;
  }

  const payloadData = data as Record<string, unknown>;
  const type = typeof payloadData['type'] === 'string' ? payloadData['type'] : '';
  if (type !== 'CALL_DISMISS' && type !== 'MISSED_CALL') {
    return null;
  }

  const metadata = parseMetadata(payloadData);
  const callId =
    (typeof metadata['callId'] === 'string' ? metadata['callId'] : null) ||
    (typeof payloadData['callId'] === 'string' ? payloadData['callId'] : null) ||
    (typeof payloadData['relatedEntityId'] === 'string' ? payloadData['relatedEntityId'] : null);

  const rawReason = metadata['reason'] ?? payloadData['reason'];
  const reason =
    typeof rawReason === 'string' && rawReason.trim().length > 0
      ? rawReason.trim().toLowerCase()
      : null;

  return {
    type: type as 'CALL_DISMISS' | 'MISSED_CALL',
    ...(callId ? { callId } : {}),
    ...(reason ? { reason } : {}),
  };
}

// ---------------------------------------------------------------------------
// Typed end reasons
// ---------------------------------------------------------------------------

const ANSWERED_REASONS = new Set([
  'answered',
  'accepted',
  'joined',
  'answered_elsewhere',
  'answered-elsewhere',
  'answeredelsewhere',
]);
const DECLINED_REASONS = new Set([
  'declined',
  'rejected',
  'busy',
  'declined_elsewhere',
  'declined-elsewhere',
  'declinedelsewhere',
]);
const UNANSWERED_REASONS = new Set([
  'timeout',
  'timed_out',
  'ring_timeout',
  'unanswered',
  'missed',
  'no_answer',
  'no-answer',
  'noanswer',
  'unavailable',
  'expired',
]);
const REMOTE_ENDED_REASONS = new Set([
  'cancelled',
  'canceled',
  'caller_cancelled',
  'caller_canceled',
  'ended',
  'call_ended',
  'hangup',
  'hung_up',
  'remote_ended',
  'left',
]);
const FAILED_REASONS = new Set(['failed', 'error']);

/** True when the backend explicitly says the call was answered (on some device). */
export function isAnsweredDismissReason(reason: string | undefined): boolean {
  return !!reason && ANSWERED_REASONS.has(reason);
}

/**
 * Map a dismiss push to the CXCallEndedReason we report. This drives the
 * system call log: only UNANSWERED produces a "missed call" entry.
 */
export function resolveCallEndReason(
  dismiss: Pick<CallDismissPayload, 'type' | 'reason'>,
): CallEndReason {
  if (dismiss.type === 'MISSED_CALL') {
    return 'UNANSWERED';
  }
  const reason = dismiss.reason ?? '';
  if (ANSWERED_REASONS.has(reason)) {
    return 'ANSWERED_ELSEWHERE';
  }
  if (DECLINED_REASONS.has(reason)) {
    return 'DECLINED_ELSEWHERE';
  }
  if (UNANSWERED_REASONS.has(reason)) {
    return 'UNANSWERED';
  }
  if (REMOTE_ENDED_REASONS.has(reason)) {
    return 'REMOTE_ENDED';
  }
  if (FAILED_REASONS.has(reason)) {
    return 'FAILED';
  }
  // No / unknown reason: the server dismissed the ring for something other
  // than a local action. Answered-elsewhere leaves no missed-call badge.
  return 'ANSWERED_ELSEWHERE';
}

// ---------------------------------------------------------------------------
// Stale ring detection
// ---------------------------------------------------------------------------

/**
 * Keys that carry the time the *push* was sent. Deliberately not `createdAt`
 * or `startedAt`: those describe the call, and a user invited ten minutes into
 * a running call must still ring.
 */
const SENT_AT_KEYS = ['sentAt', 'sent_at', 'pushSentAt'] as const;
const MIN_PLAUSIBLE_SENT_AT_MS = Date.UTC(2020, 0, 1);

function normalizeEpochMs(value: number): number {
  // Anything below 1e11 cannot be a millisecond timestamp after 1973 — treat as seconds.
  return value < 1e11 ? Math.round(value * 1000) : Math.round(value);
}

function toEpochMs(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return normalizeEpochMs(value);
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) {
      return null;
    }
    if (/^\d+(\.\d+)?$/.test(trimmed)) {
      return normalizeEpochMs(Number(trimmed));
    }
    const parsed = Date.parse(trimmed);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

/** Epoch ms the backend stamped on a call push, or null when it did not. */
export function parseCallPushSentAt(data: unknown): number | null {
  if (!data || typeof data !== 'object') {
    return null;
  }
  const payloadData = data as Record<string, unknown>;
  const metadata = parseMetadata(payloadData);
  for (const key of SENT_AT_KEYS) {
    const candidate = toEpochMs(payloadData[key]) ?? toEpochMs(metadata[key]);
    if (candidate !== null && candidate >= MIN_PLAUSIBLE_SENT_AT_MS) {
      return candidate;
    }
  }
  return null;
}

/** True when a ring push is too old to ring. Unknown age is never stale. */
export function isStaleCallPush(
  sentAt: number | null | undefined,
  now: number = Date.now(),
  thresholdMs: number = STALE_CALL_PUSH_THRESHOLD_MS,
): boolean {
  if (sentAt === null || sentAt === undefined) {
    return false;
  }
  return now - sentAt > thresholdMs;
}
