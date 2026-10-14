import { NativeModules, Platform } from 'react-native';

interface NativeCallNotificationDataModule {
  getCallData?: () => Promise<CallNotificationData | null>;
  clearCallData?: () => Promise<void>;
  returnToKeyguardIfLockedAnsweredCall?: () => Promise<boolean>;
  cacheCallerAvatars?: (filePathsByUserId: Record<string, string>) => void;
}

const CallNotificationDataModule = NativeModules['CallNotificationDataModule'] as
  NativeCallNotificationDataModule | undefined;

/** How long resolved avatars are collected before a single native call persists them. */
const AVATAR_FLUSH_DELAY_MS = 1000;

/** userId -> local avatar file path, waiting for the next flush. */
const pendingAvatars = new Map<string, string>();
let avatarFlushTimer: ReturnType<typeof setTimeout> | null = null;

function flushCallerAvatars(): void {
  avatarFlushTimer = null;
  const filePathsByUserId = Object.fromEntries(pendingAvatars);
  pendingAvatars.clear();
  try {
    CallNotificationDataModule?.cacheCallerAvatars?.(filePathsByUserId);
  } catch {
    // best-effort
  }
}

export interface CallNotificationData {
  callId?: string;
  callAction?: 'answer' | 'decline';
  callerName?: string;
  callType?: 'AUDIO' | 'VIDEO';
  isIncomingCall?: boolean;
  actionUrl?: string;
  channelId?: string;
}

export default {
  /**
   * Get stored call notification data from killed state launch.
   * Returns null if no data available or data is stale (>60s old).
   * Automatically clears data after reading to prevent duplicate processing.
   *
   * On iOS: data is written by CallKitDeclineService when the user declines
   * from the CallKit notification before JS has loaded.
   * On Android: data is written by the native notification receiver.
   */
  getCallData: async (): Promise<CallNotificationData | null> => {
    if (!CallNotificationDataModule?.getCallData) return null;
    return CallNotificationDataModule.getCallData();
  },

  /**
   * Clear stored call data without reading it.
   */
  clearCallData: async (): Promise<void> => {
    if (!CallNotificationDataModule) return;
    await CallNotificationDataModule.clearCallData?.();
  },

  /**
   * Android only: if the app was opened by answering a call from the lock screen
   * and the keyguard is still locked, background the task so the lock screen is shown.
   */
  returnToKeyguardIfLockedAnsweredCall: async (): Promise<boolean> => {
    if (Platform.OS !== 'android' || !CallNotificationDataModule) return false;
    try {
      return (await CallNotificationDataModule.returnToKeyguardIfLockedAnsweredCall?.()) ?? false;
    } catch {
      return false;
    }
  },

  /**
   * Android only: remembers a user's already-cached avatar file (a local `file://` path from
   * the app's own avatar cache) so the lock-screen incoming-call UI can show their real photo
   * instead of initials — the FCM service that builds it runs fully native, before/without JS,
   * so it can only use whatever was cached here on a previous, unrelated screen. Best-effort and
   * fire-and-forget: whether this succeeds must never affect the avatar it was resolved for.
   *
   * Avatars are collected briefly and sent together, so a screen full of them costs one native
   * call rather than one each.
   */
  cacheCallerAvatar: (userId: string, fileUri: string): void => {
    if (Platform.OS !== 'android' || !userId || !fileUri) return;
    if (!CallNotificationDataModule?.cacheCallerAvatars) return;
    pendingAvatars.set(userId, fileUri.replace(/^file:\/\//, ''));
    avatarFlushTimer ??= setTimeout(flushCallerAvatars, AVATAR_FLUSH_DELAY_MS);
  },
};
