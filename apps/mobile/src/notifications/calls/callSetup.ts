import * as Notifications from 'expo-notifications';
import messaging from '@react-native-firebase/messaging';
import type { FirebaseMessagingTypes } from '@react-native-firebase/messaging';
import { AppState, DeviceEventEmitter, Platform } from 'react-native';
import VoipPushNotification from 'react-native-voip-push-notification';

import { callKitService } from '@/src/services/CallKitService';
import { callRuntimeNativeService } from '@/src/services/CallRuntimeNativeService';
import { logCallAction } from '@/src/services/Call/callActionLog';
import type { CallKitPayload } from '@/src/services/CallKit.types';
import { CallType } from '@xyne/shared';
import { registerMobilePushToken } from '@/src/services/NotificationServices';
import CallNotificationDataModule, {
  type CallNotificationData,
} from '@/src/modules/CallNotificationDataModule';
import { getString, setString } from '@/src/services/localStorage';
import {
  getAuthOperation,
  getAuthSessionGeneration,
  isAuthScopeCurrent,
} from '@/src/services/authSessionLifecycle';
import {
  isStaleCallPush,
  parseCallDismissPayload,
  parseCallPushSentAt,
  parseIncomingCallPayload,
  type CallDismissPayload,
} from '@/src/services/PushNotificationPayload';
import { ensureBackgroundNotificationTaskRegistered } from '@/src/services/PushNotificationBackgroundTask';
import type { CallConnectionState } from '@/src/services/CallRuntimeNativeService';
import { reportCallRingStatus } from './reportCallRingStatus';
import { canCommitVoipRegistration } from '../registrationLifecyclePolicy';

import {
  acceptIncomingCall,
  clearAcceptedCallTracking,
  clearNotificationV2CallSession,
  declineIncomingCall,
  dismissIncomingCall,
  handleCallKitEnd,
  setNotificationV2CallAuthToken,
} from './callActions';

const INCOMING_CALL_CATEGORY = 'INCOMING_CALL';
const PUSH_DEVICE_ID_KEY = '@lotus_push_device_id';
const IOS_VOIP_TOKEN_KEY = '@lotus_voip_token';

let disposed = false;
let callSetupGeneration = 0;
let expoReceivedSub: Notifications.EventSubscription | null = null;
let expoResponseSub: Notifications.EventSubscription | null = null;
let appStateSub: ReturnType<typeof AppState.addEventListener> | null = null;
let callKitReconcileSub: ReturnType<typeof AppState.addEventListener> | null = null;
let callActionEventSub: ReturnType<typeof DeviceEventEmitter.addListener> | null = null;
let voipRegisterSubscriptionAttached = false;
let voipNotificationSubscriptionAttached = false;
let pendingVoipToken: string | null = null;
let registeredVoipToken: string | null = null;
let voipRetryTimer: ReturnType<typeof setTimeout> | null = null;
let currentAuthToken: string | null = null;
/** LiveKit → CallKit/CallKeep bridge when the room disconnects without CALL_DISMISS. */
let rtCallStateUnsubscribe: (() => void) | null = null;
const processedAndroidCallActionKeys = new Set<string>();

function getOrCreateDeviceId(): string {
  const existing = getString(PUSH_DEVICE_ID_KEY);
  if (existing?.trim()) {
    return existing.trim();
  }
  const created =
    globalThis.crypto?.randomUUID?.() ??
    `lotus-${Date.now().toString(16)}-${Math.random().toString(16).slice(2, 10)}`;
  setString(PUSH_DEVICE_ID_KEY, created);
  return created;
}

function normalizeTokenData(rawToken: unknown): string | null {
  if (typeof rawToken === 'string') {
    const trimmed = rawToken.trim();
    return trimmed.length > 0 ? trimmed : null;
  }
  if (rawToken && typeof rawToken === 'object') {
    const token = (rawToken as { token?: unknown })['token'];
    if (typeof token === 'string') {
      const trimmed = token.trim();
      return trimmed.length > 0 ? trimmed : null;
    }
  }
  return null;
}

export function getLatestVoipTokenForSync(): string | null {
  const runtimeToken = pendingVoipToken ?? registeredVoipToken;
  if (runtimeToken) {
    return runtimeToken;
  }
  const persisted = getString(IOS_VOIP_TOKEN_KEY);
  if (!persisted) {
    return null;
  }
  const trimmed = persisted.trim();
  return trimmed.length > 0 ? trimmed : null;
}

async function syncVoipToken(authToken: string, voipToken: string): Promise<boolean> {
  if (Platform.OS !== 'ios') {
    return false;
  }

  const authGeneration = getAuthSessionGeneration();
  const authOperation = getAuthOperation();
  const setupGeneration = callSetupGeneration;
  const isAuthRegistrationCurrent = (): boolean =>
    !disposed &&
    setupGeneration === callSetupGeneration &&
    currentAuthToken === authToken &&
    isAuthScopeCurrent(authGeneration, authOperation);
  const isCurrentRegistration = (): boolean =>
    canCommitVoipRegistration(voipToken, pendingVoipToken, isAuthRegistrationCurrent);
  if (!isCurrentRegistration()) return false;

  const fcmToken = (await messaging().getToken())?.trim();
  if (!fcmToken || !isCurrentRegistration()) {
    console.log('[XYNE_CALL] syncVoipToken: no FCM token, skipping');
    return false;
  }

  console.log('[XYNE_CALL] syncVoipToken: registering voip token with backend', {
    hasVoipToken: true,
    hasFcmToken: true,
  });

  await registerMobilePushToken(authToken, {
    fcmToken,
    voipToken,
    platform: 'ios',
    deviceId: getOrCreateDeviceId(),
  });

  // The request may finish after logout or call-session teardown. Do not
  // restore old-account VoIP state into the next session.
  if (!canCommitVoipRegistration(voipToken, pendingVoipToken, isAuthRegistrationCurrent)) {
    return false;
  }

  registeredVoipToken = voipToken;
  pendingVoipToken = voipToken;
  setString(IOS_VOIP_TOKEN_KEY, voipToken);
  console.log('[XYNE_CALL] syncVoipToken: success');
  return true;
}

async function handleVoipTokenFromEvent(
  authToken: string | null,
  rawToken: unknown,
  isCurrentSetup: () => boolean = () => !disposed,
): Promise<void> {
  if (!isCurrentSetup()) return;
  const voipToken = normalizeTokenData(rawToken);
  if (!voipToken) {
    console.log('[XYNE_CALL] handleVoipTokenFromEvent: empty token, ignoring');
    return;
  }

  console.log('[XYNE_CALL] handleVoipTokenFromEvent: received voip token', {
    hasVoipToken: true,
    hasAuthToken: !!authToken,
  });

  pendingVoipToken = voipToken;
  setString(IOS_VOIP_TOKEN_KEY, voipToken);
  if (!isCurrentSetup()) return;
  if (!authToken) {
    console.log('[XYNE_CALL] handleVoipTokenFromEvent: no auth token yet, token stored for later');
    return;
  }

  if (registeredVoipToken === voipToken) {
    console.log('[XYNE_CALL] handleVoipTokenFromEvent: token already registered, skip');
    return;
  }

  try {
    const synced = await syncVoipToken(authToken, voipToken);
    console.log('[XYNE_CALL] handleVoipTokenFromEvent: sync result', { synced });
  } catch (error) {
    console.warn('[NotificationV2Call] Failed syncing VoIP token from event', error);
  }
}

async function maybeSyncPendingVoipToken(authToken: string): Promise<void> {
  const voipToken = pendingVoipToken;
  if (Platform.OS !== 'ios' || !voipToken) {
    return;
  }
  if (registeredVoipToken === voipToken) {
    return;
  }
  try {
    await syncVoipToken(authToken, voipToken);
  } catch (error) {
    console.warn('[NotificationV2Call] Failed syncing pending VoIP token', error);
  }
}

function isCallFcmData(data: FirebaseMessagingTypes.RemoteMessage['data'] | undefined): boolean {
  if (!data) return false;
  const type = String(data['type'] ?? '');
  return (
    type === 'INCOMING_CALL' ||
    type === 'CALL_DISMISS' ||
    type === 'MISSED_CALL' ||
    String(data['isIncomingCall'] ?? '').toLowerCase() === 'true'
  );
}

/** Backend `sentAt` when present; otherwise FCM's server send time (Android). */
function getRemoteMessageSentAt(
  remoteMessage: FirebaseMessagingTypes.RemoteMessage,
): number | null {
  const fromPayload = parseCallPushSentAt(remoteMessage.data);
  if (fromPayload !== null) {
    return fromPayload;
  }
  const sentTime = remoteMessage.sentTime;
  return typeof sentTime === 'number' && sentTime > 0 ? sentTime : null;
}

function dismissFromPush(dismiss: CallDismissPayload): Promise<void> {
  return dismissIncomingCall(dismiss.callId, {
    type: dismiss.type,
    ...(dismiss.reason ? { reason: dismiss.reason } : {}),
    source: 'push',
  });
}

async function setupIncomingCallCategory(): Promise<void> {
  if (Platform.OS === 'ios') return;

  await Notifications.setNotificationCategoryAsync(
    INCOMING_CALL_CATEGORY,
    [
      {
        identifier: 'accept',
        buttonTitle: 'Accept',
        options: {
          opensAppToForeground: true,
          isAuthenticationRequired: true,
        },
      },
      {
        identifier: 'decline',
        buttonTitle: 'Decline',
        options: {
          isDestructive: true,
          opensAppToForeground: false,
        },
      },
    ],
    { customDismissAction: true },
  );
}

function completeVoipNotification(rawNotification: unknown): void {
  const voipEvent = rawNotification as Record<string, unknown> | null;
  const uuid = voipEvent && typeof voipEvent['uuid'] === 'string' ? voipEvent['uuid'] : null;
  const voipModule = VoipPushNotification as unknown as {
    onVoipNotificationCompleted?: (eventId: string) => void;
  };
  if (uuid && typeof voipModule.onVoipNotificationCompleted === 'function') {
    voipModule.onVoipNotificationCompleted(uuid);
  }
}

function handleVoipNotificationEvent(rawNotification: unknown): void {
  console.log('[XYNE_CALL] handleVoipNotificationEvent: VoIP push received');
  const raw =
    typeof rawNotification === 'object' && rawNotification !== null
      ? (rawNotification as Record<string, unknown>)
      : null;

  // A CALL_DISMISS / MISSED_CALL sent over PushKit: native already ended the
  // ring; this keeps the in-app modal, machine state and our maps in step.
  const dismiss = raw ? parseCallDismissPayload(raw) : null;
  if (dismiss) {
    void dismissFromPush(dismiss);
    completeVoipNotification(rawNotification);
    return;
  }

  // Every other VoIP push is a ring by construction (the backend never sets
  // `type` on them), so parse it as INCOMING_CALL.
  const payload = parseIncomingCallPayload(
    raw ? { ...raw, type: 'INCOMING_CALL' } : rawNotification,
  );
  if (!payload) {
    console.log('[XYNE_CALL] handleVoipNotificationEvent: payload parse failed, ignoring');
    completeVoipNotification(rawNotification);
    return;
  }

  // Native (LotusCallPushRouter) already decided whether this rings: it reports
  // the call, ends stale ones immediately and owns the ring timeout. JS only
  // caches the payload so an answer can resolve credentials — and never for a
  // stale push, which native has already logged as missed.
  if (isStaleCallPush(parseCallPushSentAt(raw))) {
    console.log('[XYNE_CALL] handleVoipNotificationEvent: stale ring ignored', {
      callId: payload.callId,
    });
    completeVoipNotification(rawNotification);
    return;
  }

  callKitService.cacheIncomingCallPayload(payload);

  if (Platform.OS === 'android') {
    void callKitService.displayIncomingCall(payload).catch(() => {});
  }
  completeVoipNotification(rawNotification);
}

/**
 * FCM call control (foreground, and background on iOS). iOS mirrors old Push:
 * INCOMING_CALL = cache only; CALL_DISMISS / MISSED_CALL = end the ring with the
 * backend's reason (never decline while joining/connected).
 */
export async function handleFcmCallMessage(
  remoteMessage: FirebaseMessagingTypes.RemoteMessage,
): Promise<void> {
  const data = remoteMessage.data;
  if (!data) return;
  console.log('[XYNE_CALL] handleFcmCallMessage: type=', data['type']);

  const dismiss = parseCallDismissPayload(data);
  if (dismiss) {
    await dismissFromPush(dismiss);
    return;
  }

  const type = String(data['type'] ?? '');

  if (Platform.OS === 'ios' && type !== 'INCOMING_CALL') {
    return;
  }

  const payload = parseIncomingCallPayload(data);
  if (!payload) return;

  const sentAt = getRemoteMessageSentAt(remoteMessage);
  if (isStaleCallPush(sentAt)) {
    // Held by FCM while offline; the call is over. The backend's MISSED_CALL covers the UX.
    console.log('[XYNE_CALL] handleFcmCallMessage: stale INCOMING_CALL ignored', {
      callId: payload.callId,
      ageMs: sentAt === null ? null : Date.now() - sentAt,
    });
    return;
  }

  callKitService.cacheIncomingCallPayload(payload);

  if (Platform.OS === 'ios') {
    return;
  }

  await callKitService.displayIncomingCall(payload);
}

type CallSetupGuard = () => boolean;

async function checkCallNotificationData(
  isCurrentSetup: CallSetupGuard = () => true,
): Promise<void> {
  if (Platform.OS !== 'android' || !isCurrentSetup()) return;

  const data: CallNotificationData | null = await CallNotificationDataModule.getCallData();
  if (!isCurrentSetup() || !data?.callId) return;

  const callAction =
    data.callAction === 'answer' || data.callAction === 'decline' ? data.callAction : null;
  if (!callAction) {
    if (isCurrentSetup()) {
      await CallNotificationDataModule.clearCallData();
    }
    return;
  }

  const actionKey = `${callAction}:${data.callId}`;
  if (processedAndroidCallActionKeys.has(actionKey)) {
    console.log('[XYNE_CALL] duplicate Android call action ignored', {
      callId: data.callId,
      callAction,
    });
    if (isCurrentSetup()) {
      await CallNotificationDataModule.clearCallData();
    }
    return;
  }
  if (!isCurrentSetup()) return;
  processedAndroidCallActionKeys.add(actionKey);

  const payload: CallKitPayload = {
    callId: data.callId,
    callUUID: data.callId,
    callerName: data.callerName ?? 'Unknown Caller',
    callType: data.callType === 'VIDEO' ? CallType.VIDEO : CallType.AUDIO,
    ...(data.channelId ? { channelId: data.channelId } : {}),
  };

  console.log('[XYNE_CALL] processing Android call action', {
    callId: data.callId,
    callAction,
  });

  try {
    if (callAction === 'answer') {
      if (!isCurrentSetup()) return;
      await acceptIncomingCall(payload);
      return;
    }

    if (!isCurrentSetup()) return;
    await declineIncomingCall(payload);
  } finally {
    // A logout/account replacement may have installed a newer native action
    // while this read or API call was in flight. Do not clear that action.
    if (isCurrentSetup()) {
      await CallNotificationDataModule.clearCallData();
    }
  }
}

async function checkCallNotificationDataWithRetry(
  attempts: number,
  delayMs: number,
  isCurrentSetup: CallSetupGuard,
): Promise<void> {
  for (let i = 0; i < attempts; i++) {
    if (!isCurrentSetup()) return;
    await checkCallNotificationData(isCurrentSetup);
    if (i < attempts - 1) {
      await new Promise(r => setTimeout(r, delayMs));
    }
  }
}

function registerCallKitHandlers(): void {
  callKitService.setEventHandlers({
    onAnswerCall: (callUUID, payload) => {
      const resolved =
        payload ?? (callKitService.getCallPayload(callUUID) as CallKitPayload | null);
      if (!resolved) {
        void acceptIncomingCall({
          callId: callUUID,
          callUUID,
          callerName: 'Unknown Caller',
          callType: CallType.AUDIO,
        });
        return;
      }
      void acceptIncomingCall({ ...resolved, callUUID });
    },
    onEndCall: (callUUID, payload) => {
      void handleCallKitEnd(callUUID, payload ? { ...payload, callUUID } : undefined);
    },
    // iOS: CallKit is ringing — tell the caller (Calling… → Ringing… / On another call), like the
    // dashboard does. Busy when CallKit saw another call (SIM, other VoIP) or we're in one of ours.
    // Android reports this natively from LotusIncomingCallMessagingService instead.
    onIncomingCallDisplayed: payload => {
      const busy = !!payload.onAnotherCall || callRuntimeNativeService.getActiveCall() !== null;
      reportCallRingStatus(payload.callId, busy ? 'BUSY' : 'RINGING');
    },
    onSetMuted: (callUUID, muted) => {
      logCallAction('mic_pressed', {
        callId: callRuntimeNativeService.getActiveCall()?.callId,
        callUUID,
        source: 'callkit',
        enable: !muted,
      });
      // No-op when no LiveKit room is up; idempotent when already in that state.
      void callRuntimeNativeService.toggleMic(!muted).catch(error => {
        console.warn('[NotificationV2Call] CallKit mute sync failed', error);
      });
    },
  });
}

function registerExpoCallListeners(): void {
  expoReceivedSub = Notifications.addNotificationReceivedListener(notification => {
    const data = notification.request.content.data;
    const dismiss = parseCallDismissPayload(data);
    if (dismiss) {
      void dismissFromPush(dismiss);
      return;
    }

    const payload = parseIncomingCallPayload(data);
    if (!payload) return;

    if (isStaleCallPush(parseCallPushSentAt(data))) {
      console.log('[XYNE_CALL] expo received: stale INCOMING_CALL ignored', {
        callId: payload.callId,
      });
      return;
    }

    callKitService.cacheIncomingCallPayload(payload);

    if (Platform.OS === 'android') {
      void callKitService.displayIncomingCall(payload);
    }
  });

  expoResponseSub = Notifications.addNotificationResponseReceivedListener(response => {
    const data = response.notification.request.content.data;
    const payload = parseIncomingCallPayload(data);
    if (!payload) return;

    if (Platform.OS === 'android') {
      const callAction = typeof data?.['callAction'] === 'string' ? data['callAction'] : null;
      if (callAction === 'answer' || callAction === 'decline') {
        return;
      }
    }

    const callAction = typeof data?.['callAction'] === 'string' ? data['callAction'] : null;

    const isAccept =
      response.actionIdentifier === 'accept' ||
      (Platform.OS === 'android' &&
        response.actionIdentifier === 'expo.modules.notifications.actions.DEFAULT' &&
        callAction === 'answer');

    const isDecline =
      response.actionIdentifier === 'decline' ||
      response.actionIdentifier?.toLowerCase().includes('decline') ||
      (Platform.OS === 'android' &&
        response.actionIdentifier === 'expo.modules.notifications.actions.DEFAULT' &&
        callAction === 'decline');

    if (isAccept) {
      void acceptIncomingCall(payload);
      return;
    }
    if (isDecline) {
      void declineIncomingCall(payload);
    }
  });
}

function registerVoipListeners(isCurrentSetup: () => boolean): void {
  if (Platform.OS !== 'ios') return;

  if (!voipRegisterSubscriptionAttached) {
    VoipPushNotification.addEventListener('register', token => {
      void handleVoipTokenFromEvent(currentAuthToken, token, isCurrentSetup);
    });
    voipRegisterSubscriptionAttached = true;
  }

  if (!voipNotificationSubscriptionAttached) {
    VoipPushNotification.addEventListener('notification', handleVoipNotificationEvent);
    VoipPushNotification.addEventListener('didLoadWithEvents', events => {
      if (!Array.isArray(events) || events.length === 0) {
        return;
      }
      const voipModule = VoipPushNotification as unknown as {
        RNVoipPushRemoteNotificationReceivedEvent?: string;
      };
      const receivedEventName =
        voipModule.RNVoipPushRemoteNotificationReceivedEvent ||
        'RNVoipPushRemoteNotificationReceivedEvent';

      for (const event of events) {
        if (!event || typeof event !== 'object') {
          continue;
        }
        const typedEvent = event as { name?: unknown; data?: unknown };
        if (typedEvent.name === receivedEventName) {
          handleVoipNotificationEvent(typedEvent.data);
        }
      }
    });
    voipNotificationSubscriptionAttached = true;
  }

  console.log('[XYNE_CALL] registerVoipListeners: calling registerVoipToken()');
  VoipPushNotification.registerVoipToken();

  if (voipRetryTimer) {
    clearTimeout(voipRetryTimer);
  }
  voipRetryTimer = setTimeout(() => {
    if (!registeredVoipToken && !pendingVoipToken) {
      VoipPushNotification.registerVoipToken();
    }
  }, 2000);
}

/**
 * When LiveKit drops from connected to disconnected without a CALL_DISMISS
 * (remote hang-up, server closed the room), clear the system call so the
 * CallKit / Telecom UI never outlives the media session. Both platforms.
 */
function registerLiveKitCallKitDisconnectBridge(): void {
  let prevRTState: CallConnectionState = 'idle';
  let lastConnectedCallId: string | null = null;

  rtCallStateUnsubscribe?.();
  rtCallStateUnsubscribe = callRuntimeNativeService.subscribe(snapshot => {
    const { connectionState } = snapshot;

    if (connectionState === 'connected') {
      lastConnectedCallId = snapshot.activeCall?.callId ?? lastConnectedCallId;
    }

    if (prevRTState === 'connected' && connectionState === 'disconnected') {
      const activeKitUUID = callKitService.getActiveCallUUID();
      if (activeKitUUID) {
        callKitService.reportCallEnded(activeKitUUID, 'REMOTE_ENDED');
      }
      if (lastConnectedCallId) {
        clearAcceptedCallTracking(lastConnectedCallId);
        lastConnectedCallId = null;
      }
    }

    prevRTState = connectionState;
  });
}

/**
 * iOS: native may have ended a ring (CALL_DISMISS via PushKit/APNs, or the
 * 30s ring timeout) while JS was suspended. Re-sync our bookkeeping with the
 * system call list whenever the app comes back to the foreground.
 */
function registerCallKitForegroundReconcile(): void {
  if (Platform.OS !== 'ios') return;

  let previous = AppState.currentState;
  callKitReconcileSub?.remove();
  callKitReconcileSub = AppState.addEventListener('change', next => {
    if (previous !== 'active' && next === 'active') {
      void callKitService.reconcileWithSystemCalls();
    }
    previous = next;
  });
}

function registerAndroidForegroundDeclineBridge(isCurrentSetup: CallSetupGuard): void {
  if (Platform.OS !== 'android') return;

  let previous = AppState.currentState;
  appStateSub = AppState.addEventListener('change', next => {
    if (previous !== 'active' && next === 'active') {
      setTimeout(() => {
        if (!isCurrentSetup()) return;
        void checkCallNotificationData(isCurrentSetup);
      }, 300);
    }
    previous = next;
  });

  callActionEventSub = DeviceEventEmitter.addListener('CALL_ACTION_FROM_RECEIVER', () => {
    setTimeout(() => {
      if (!isCurrentSetup()) return;
      void checkCallNotificationData(isCurrentSetup);
    }, 100);
  });
}

/** Single entry from NotificationV2Service.onMessage — avoids duplicate FCM listeners. */
export async function handleForegroundCallRemoteMessage(
  remoteMessage: FirebaseMessagingTypes.RemoteMessage,
): Promise<boolean> {
  if (!isCallFcmData(remoteMessage.data)) return false;
  await handleFcmCallMessage(remoteMessage);
  return true;
}

/**
 * Background FCM entry (setBackgroundMessageHandler → NotificationService).
 * iOS only: a CALL_DISMISS / MISSED_CALL that arrives while the app is
 * backgrounded must still end the CallKit ring. Android handles call pushes
 * natively in LotusIncomingCallMessagingService, so it is left alone here.
 */
export async function handleBackgroundCallRemoteMessage(
  remoteMessage: FirebaseMessagingTypes.RemoteMessage,
): Promise<boolean> {
  if (Platform.OS !== 'ios') return false;
  if (!isCallFcmData(remoteMessage.data)) return false;
  await handleFcmCallMessage(remoteMessage);
  return true;
}

export async function startNotificationV2CallSetup(authToken: string): Promise<void> {
  const generation = ++callSetupGeneration;
  const isCurrentSetup = (): boolean => !disposed && generation === callSetupGeneration;
  console.log('[XYNE_CALL] startNotificationV2CallSetup: begin');
  disposed = false;
  currentAuthToken = authToken;
  setNotificationV2CallAuthToken(authToken);

  await setupIncomingCallCategory();
  if (!isCurrentSetup()) return;

  try {
    await callKitService.initialize();
  } catch {
    // Non-fatal
  }
  if (!isCurrentSetup()) return;

  registerCallKitHandlers();
  registerVoipListeners(isCurrentSetup);
  await maybeSyncPendingVoipToken(authToken);
  if (!isCurrentSetup()) return;
  registerExpoCallListeners();
  registerLiveKitCallKitDisconnectBridge();
  registerCallKitForegroundReconcile();
  registerAndroidForegroundDeclineBridge(isCurrentSetup);

  void ensureBackgroundNotificationTaskRegistered().catch(error => {
    console.warn('[NotificationV2Call] Failed to register background notification task', error);
  });

  await checkCallNotificationDataWithRetry(3, 500, isCurrentSetup);
  if (!isCurrentSetup()) return;
  console.log('[XYNE_CALL] startNotificationV2CallSetup: complete');
}

export function stopNotificationV2CallSetup(): void {
  callSetupGeneration += 1;
  if (disposed) return;
  disposed = true;

  expoReceivedSub?.remove();
  expoReceivedSub = null;
  expoResponseSub?.remove();
  expoResponseSub = null;
  appStateSub?.remove();
  appStateSub = null;
  callKitReconcileSub?.remove();
  callKitReconcileSub = null;
  callActionEventSub?.remove();
  callActionEventSub = null;

  if (Platform.OS === 'ios') {
    VoipPushNotification.removeEventListener('register');
    VoipPushNotification.removeEventListener('notification');
    VoipPushNotification.removeEventListener('didLoadWithEvents');
  }

  if (voipRetryTimer) {
    clearTimeout(voipRetryTimer);
    voipRetryTimer = null;
  }

  rtCallStateUnsubscribe?.();
  rtCallStateUnsubscribe = null;

  voipRegisterSubscriptionAttached = false;
  voipNotificationSubscriptionAttached = false;
  pendingVoipToken = null;
  registeredVoipToken = null;
  currentAuthToken = null;
  processedAndroidCallActionKeys.clear();

  clearNotificationV2CallSession();
}
