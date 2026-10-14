import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

import { parseIncomingCallPayload } from './PushNotificationPayload';
import type { CallKitCallType } from './CallKit.types';
import CallNotificationDataModule from '../modules/CallNotificationDataModule';
import { CallType } from '@xyne/shared';

export interface ColdStartCallInfo {
  callId: string;
  callUUID: string;
  callerName: string;
  callType: CallKitCallType;
  token?: string | undefined;
  serverUrl?: string | undefined;
  channelId?: string | undefined;
}

/**
 * Check if app was launched from a call notification (cold start).
 * This should be called EARLY in app initialization to avoid unnecessary
 * navigation to default routes before handling the call.
 */
export async function checkColdStartCall(): Promise<ColdStartCallInfo | null> {
  // Only check on cold start - if app is already running, this isn't relevant
  if (Platform.OS === 'android') {
    return checkAndroidColdStartCall();
  }
  return checkIOSColdStartCall();
}

async function checkAndroidColdStartCall(): Promise<ColdStartCallInfo | null> {
  try {
    const callData = await CallNotificationDataModule.getCallData();

    if (!callData?.callId) {
      return null;
    }

    // Only handle accept action - decline shouldn't auto-navigate to call
    if (callData.callAction !== 'answer') {
      return null;
    }

    return {
      callId: callData.callId,
      callUUID: callData.callId,
      callerName: callData.callerName ?? 'Unknown Caller',
      callType: callData.callType === CallType.VIDEO ? CallType.VIDEO : CallType.AUDIO,
    };
  } catch (error) {
    console.warn('[ColdStartCallDetector] Failed to check Android call data', error);
    return null;
  }
}

async function checkIOSColdStartCall(): Promise<ColdStartCallInfo | null> {
  try {
    const lastNotificationResponse = await Notifications.getLastNotificationResponseAsync();

    if (!lastNotificationResponse) {
      return null;
    }

    const payload = parseIncomingCallPayload(
      lastNotificationResponse.notification.request.content.data,
    );

    if (!payload) {
      return null;
    }

    // Only handle accept actions
    const actionIdentifier = lastNotificationResponse.actionIdentifier;
    const isAcceptAction =
      actionIdentifier === 'accept' ||
      (actionIdentifier === 'expo.modules.notifications.actions.DEFAULT' &&
        (lastNotificationResponse.notification.request.content.data as Record<string, unknown>)?.[
          'callAction'
        ] === 'answer');

    if (!isAcceptAction) {
      return null;
    }

    return {
      callId: payload.callId,
      callUUID: payload.callUUID,
      callerName: payload.callerName,
      callType: payload.callType,
      ...(payload.token ? { token: payload.token } : {}),
      ...(payload.serverUrl ? { serverUrl: payload.serverUrl } : {}),
      ...(payload.channelId ? { channelId: payload.channelId } : {}),
    };
  } catch (error) {
    console.warn('[ColdStartCallDetector] Failed to check iOS notification response', error);
    return null;
  }
}

/**
 * Check if there's a pending call notification that should be handled immediately.
 * This is synchronous and can be used to decide initial routing before async calls complete.
 */
let cachedColdStartCall: ColdStartCallInfo | null = null;
let hasCheckedColdStart = false;

export function getCachedColdStartCall(): ColdStartCallInfo | null {
  return cachedColdStartCall;
}

export function hasColdStartCallBeenChecked(): boolean {
  return hasCheckedColdStart;
}

export async function initializeColdStartDetection(): Promise<void> {
  if (hasCheckedColdStart) {
    return;
  }

  hasCheckedColdStart = true;
  cachedColdStartCall = await checkColdStartCall();

  if (cachedColdStartCall) {
    console.log('[ColdStartCallDetector] Found cold start call', {
      callId: cachedColdStartCall.callId,
    });
  }
}

/**
 * Clear the cached cold start call info after it's been processed.
 */
export function clearColdStartCallCache(): void {
  cachedColdStartCall = null;
}
