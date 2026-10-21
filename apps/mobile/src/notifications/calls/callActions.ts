import { router } from 'expo-router';
import { Platform } from 'react-native';

import { CallType } from '@xyne/shared';
import { roomActor } from '@/src/machines/roomMachine';
import { callKitService } from '@/src/services/CallKitService';
import type { CallKitPayload } from '@/src/services/CallKit.types';
import { isSameCallKitUUID } from '@/src/services/CallKitUUID';
import { callService, type JoinCallResponse } from '@/src/services/Call/callService';
import { callRuntimeNativeService } from '@/src/services/CallRuntimeNativeService';
import {
  isAnsweredDismissReason,
  resolveCallEndReason,
  type CallDismissPayload,
} from '@/src/services/PushNotificationPayload';

let authToken: string | null = null;
let pendingAccept: CallKitPayload | null = null;
let pendingDecline: CallKitPayload | null = null;
/** Invalidates in-flight accept/decline continuations on logout or account replacement. */
let callSessionGeneration = 0;

/**
 * Calls accepted on this device, with the time of acceptance. The backend
 * echoes CALL_DISMISS(answered) to the answering device too, and it can land
 * before the runtime reports `connecting`; an entry here keeps that from being
 * read as "answered elsewhere". Entries expire so a stale id never suppresses a
 * later, legitimate dismiss of the same call.
 */
const ACCEPTED_CALL_TRACKING_TTL_MS = 90_000;
const recentlyAcceptedCalls = new Map<string, number>();

export function markCallAccepted(callId: string): void {
  recentlyAcceptedCalls.set(callId, Date.now());
}

function wasRecentlyAccepted(callId: string): boolean {
  const acceptedAt = recentlyAcceptedCalls.get(callId);
  if (acceptedAt === undefined) {
    return false;
  }
  if (Date.now() - acceptedAt > ACCEPTED_CALL_TRACKING_TTL_MS) {
    recentlyAcceptedCalls.delete(callId);
    return false;
  }
  return true;
}

export function clearAcceptedCallTracking(callId?: string): void {
  if (callId) {
    recentlyAcceptedCalls.delete(callId);
    return;
  }
  recentlyAcceptedCalls.clear();
}

/**
 * True when the user is joining or already in this call (must not treat CALL_DISMISS as decline).
 */
export function isInActiveOrJoiningCall(callId?: string): boolean {
  const active = callRuntimeNativeService.getActiveCall();
  const state = callRuntimeNativeService.getConnectionState();

  if (state === 'connecting' || state === 'connected') {
    if (!callId) return true;
    if (active?.callId === callId) return true;
  }

  if (callId && wasRecentlyAccepted(callId)) {
    return true;
  }

  return false;
}

export function setNotificationV2CallAuthToken(token: string | null): void {
  authToken = token;
  if (token && pendingAccept) {
    const payload = pendingAccept;
    pendingAccept = null;
    void acceptIncomingCall(payload, callSessionGeneration);
  }
  if (token && pendingDecline) {
    const payload = pendingDecline;
    pendingDecline = null;
    void declineIncomingCall(payload, callSessionGeneration);
  }
}

export function clearNotificationV2CallSession(): void {
  callSessionGeneration += 1;
  authToken = null;
  pendingAccept = null;
  pendingDecline = null;
  recentlyAcceptedCalls.clear();
  callKitService.clearSessionState();
  void callKitService.clearPendingNativeState();
}

export interface DismissIncomingCallOptions {
  type?: CallDismissPayload['type'];
  /** Backend reason (answered / declined / cancelled / timeout …). */
  reason?: string;
  /** Where the dismissal came from — logs only. */
  source?: 'push' | 'sync' | 'timeout';
}

/**
 * Remote dismissal: CALL_DISMISS / MISSED_CALL push, or Zero reporting that
 * the invite is gone (answered / declined elsewhere, cancelled, ended).
 * Ends the native ring with the typed reason. Never touches a call this device
 * is joining or already in.
 */
export async function dismissIncomingCall(
  callId?: string,
  options: DismissIncomingCallOptions = {},
): Promise<void> {
  const endReason = resolveCallEndReason({
    type: options.type ?? 'CALL_DISMISS',
    ...(options.reason ? { reason: options.reason } : {}),
  });
  // eslint-disable-next-line no-console
  console.log('[XCALL][DISMISS] incoming call dismissed remotely', {
    callId,
    type: options.type ?? 'CALL_DISMISS',
    reason: options.reason,
    endReason,
    source: options.source ?? 'push',
  });

  if (Platform.OS === 'ios') {
    // A push-launched cold start can run this before call setup has replayed
    // CallKit's display events. With empty maps the ring's UUID would be derived
    // from this push's callId, which misses whenever the dismiss names the call
    // differently from the ring — so index those queued events first.
    await callKitService.indexQueuedDisplayedCalls();
    const activeUUID = callKitService.getActiveCallUUID();
    const ringUUID = callId ? callKitService.resolveCallKitUUID(callId) : activeUUID;

    if (isInActiveOrJoiningCall(callId)) {
      // We're in (or joining) a call: only a *different* ring may be ended.
      if (ringUUID && activeUUID && !isSameCallKitUUID(ringUUID, activeUUID)) {
        callKitService.reportCallEnded(ringUUID, endReason);
      }
      return;
    }

    if (!ringUUID) {
      return;
    }

    if (activeUUID && isSameCallKitUUID(ringUUID, activeUUID)) {
      if (isAnsweredDismissReason(options.reason)) {
        // activeUUID is set the moment Accept is tapped, before connect() runs:
        // an explicit "answered" for it is this device's own answer echoed back.
        return;
      }
      // Answered here, then ended remotely before/while connecting → tear down.
      callKitService.reportCallEnded(
        activeUUID,
        endReason === 'UNANSWERED' ? 'REMOTE_ENDED' : endReason,
      );
      await callRuntimeNativeService.disconnect();
      return;
    }

    callKitService.reportCallEnded(ringUUID, endReason);
    return;
  }

  if (isInActiveOrJoiningCall(callId)) {
    return;
  }

  const target = callId ?? callKitService.getActiveCallUUID();
  if (target) {
    callKitService.reportCallEnded(target, endReason);
  }
}

/** Upper bound on leaving the current call before answering another; the join goes ahead after. */
const LEAVE_CURRENT_CALL_TIMEOUT_MS = 15_000;

/**
 * Answering while already in (or joining) another call: leave it first. roomMachine takes
 * JOIN_CALL_WITH_CREDENTIALS only in `idle`, so a join sent mid-call — or while iOS's
 * "End & Accept" is still disconnecting the first call — would be silently dropped.
 * Transient states (initiating / joining / connecting / disconnecting) settle on their own;
 * `connected` is told to DISCONNECT.
 */
async function leaveCurrentCall(nextCallId: string): Promise<void> {
  const initial = roomActor.getSnapshot();
  if (initial.matches('idle') || initial.context.externalId === nextCallId) {
    return;
  }
  // eslint-disable-next-line no-console
  console.log('[XCALL][ACCEPT] leaving current call before answering', {
    currentCallId: initial.context.externalId,
    nextCallId,
  });

  await new Promise<void>(resolve => {
    let disconnectSent = false;
    let settled = false;
    let subscription: { unsubscribe: () => void } | null = null;
    const finish = (): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      subscription?.unsubscribe();
      resolve();
    };
    const timeout = setTimeout(finish, LEAVE_CURRENT_CALL_TIMEOUT_MS);
    const check = (snapshot: ReturnType<typeof roomActor.getSnapshot>): void => {
      if (snapshot.matches('idle')) {
        finish();
        return;
      }
      if (!disconnectSent && snapshot.matches('connected')) {
        disconnectSent = true;
        roomActor.send({ type: 'DISCONNECT' });
      }
    };
    subscription = roomActor.subscribe(check);
    check(roomActor.getSnapshot());
  });
}

export async function acceptIncomingCall(
  payload: CallKitPayload,
  expectedGeneration = callSessionGeneration,
): Promise<void> {
  if (expectedGeneration !== callSessionGeneration) return;
  // Before the auth gate: the backend's CALL_DISMISS(answered) echo can arrive
  // while the accept is still parked on `pendingAccept`.
  markCallAccepted(payload.callId);

  if (!authToken) {
    pendingAccept = payload;
    return;
  }

  if (Platform.OS === 'ios') {
    callKitService.bringToForeground();
  }

  let credentials: JoinCallResponse | null = null;
  try {
    if (payload.token && payload.serverUrl) {
      credentials = {
        token: payload.token,
        livekitUrl: payload.serverUrl,
        externalId: payload.callId,
        roomLink: '',
        ...(payload.channelId ? { channelId: payload.channelId } : {}),
      };
    } else {
      credentials = await callService.joinCall({ callId: payload.callId });
    }
  } catch {
    // Continue — native screen may still resolve credentials
  }

  if (expectedGeneration !== callSessionGeneration) return;

  callKitService.reportCallConnected(payload.callUUID);
  pendingAccept = null;

  if (credentials?.token && credentials.livekitUrl) {
    await leaveCurrentCall(payload.callId);
    if (expectedGeneration !== callSessionGeneration) return;
    roomActor.send({
      type: 'JOIN_CALL_WITH_CREDENTIALS',
      callId: payload.callId,
      token: credentials.token,
      serverUrl: credentials.livekitUrl,
      ...(credentials.channelId ? { channelId: credentials.channelId } : {}),
      callType: payload.callType,
      viewMode: 'full',
    });
  }

  router.replace({
    pathname: '/(protected)/native-call',
    params: {
      channelId: payload.callId,
      callType: payload.callType,
      initiateCall: 'false',
    },
  });
}

export async function declineIncomingCall(
  payload: CallKitPayload,
  expectedGeneration = callSessionGeneration,
): Promise<void> {
  if (expectedGeneration !== callSessionGeneration) return;
  if (!authToken) {
    pendingDecline = payload;
    return;
  }

  pendingDecline = null;
  clearAcceptedCallTracking(payload.callId);

  try {
    await callService.declineCall(payload.callId);
  } catch {
    // Still end local UI
  }
  if (expectedGeneration !== callSessionGeneration) return;
  callKitService.endCall(payload.callUUID);
  await callRuntimeNativeService.disconnect();
}

/**
 * User declined/ended from CallKit UI. Do not call endCall() again — CallKit already cleaned up
 * and a second endCall causes an infinite decline loop.
 */
export async function handleCallKitEnd(callUUID: string, payload?: CallKitPayload): Promise<void> {
  const activeCall = callRuntimeNativeService.getActiveCall();
  const callId = payload?.callId ?? activeCall?.callId;

  if (callId && isInActiveOrJoiningCall(callId)) {
    await callRuntimeNativeService.disconnect();
    return;
  }

  if (!callId) {
    await callRuntimeNativeService.disconnect();
    return;
  }

  if (!authToken) {
    pendingDecline = payload
      ? { ...payload, callUUID }
      : {
          callId,
          callUUID,
          callerName: 'Unknown',
          callType: CallType.AUDIO,
        };
    await callRuntimeNativeService.disconnect();
    return;
  }

  clearAcceptedCallTracking(callId);

  try {
    await callService.declineCall(callId);
  } catch {
    // ignore
  }

  await callRuntimeNativeService.disconnect();
}
