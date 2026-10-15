import { Platform } from 'react-native';

import {
  registerMobilePushToken,
  unregisterMobilePushToken,
} from '@/src/services/NotificationServices';
import { isMtlsRequestError } from '@/src/services/apiClient';
import { getString, setString } from '@/src/services/localStorage';
// Reads the persisted VoIP token (MMKV, sync). We must resend it on iOS so this
// registration does NOT wipe the VoIP token the call setup stored — the backend
// overwrites voipToken to null when it isn't included in the register call.
import { getLatestVoipTokenForSync } from '../calls/callSetup';

import { DEVICE_ID_STORAGE_KEY, getSupportedPlatform } from '../config';
import { canCommitDeviceRegistration } from '../registrationLifecyclePolicy';
import {
  getAuthOperation,
  getAuthSessionGeneration,
  isAuthScopeCurrent,
} from '@/src/services/authSessionLifecycle';
import { getActiveWorkspaceId } from '@/src/utils/activeWorkspace';

// Remembers the token we last registered this session so identical calls are
// skipped (avoids spamming the backend on every refresh/re-init).
let lastRegisteredToken: string | null = null;
// Only the newest registration attempt may commit its completion. This keeps
// out-of-order token rotations from restoring an obsolete dedupe value.
let latestRegistrationAttempt = 0;
const DEVICE_UNREGISTER_TIMEOUT_MS = 5_000;
const DEVICE_UNREGISTER_MAX_ATTEMPTS = 2;
const DEVICE_UNREGISTER_RETRY_DELAY_MS = 250;

export type DeviceRegistrationScope = {
  generation?: number;
  operation?: number;
  isCurrent?: () => boolean;
};

// Returns a stable device id, creating + persisting one on first use.
function getOrCreateDeviceId(): string {
  const existing = getString(DEVICE_ID_STORAGE_KEY);
  if (existing?.trim()) return existing.trim();

  // Prefer a real UUID; fall back to a timestamp+random id if crypto is absent.
  const created =
    globalThis.crypto?.randomUUID?.() ??
    `notif-v4-${Date.now().toString(16)}-${Math.random().toString(16).slice(2, 10)}`;

  setString(DEVICE_ID_STORAGE_KEY, created);
  return created;
}

function getExistingDeviceId(): string | undefined {
  const existing = getString(DEVICE_ID_STORAGE_KEY)?.trim();
  return existing || undefined;
}

// Sends this device's FCM token to the backend so it knows where to deliver
// pushes for the signed-in user. Safe to call repeatedly; it dedupes.
export async function registerDeviceWithBackend(
  authToken: string,
  fcmToken: string,
  scope: DeviceRegistrationScope = {},
): Promise<void> {
  const generation = scope.generation ?? getAuthSessionGeneration();
  const operation = scope.operation ?? getAuthOperation();
  const isCurrent = (): boolean =>
    isAuthScopeCurrent(generation, operation) && (scope.isCurrent?.() ?? true);

  const platform = getSupportedPlatform();
  if (!platform) return;
  if (!authToken.trim() || !fcmToken.trim() || !isCurrent()) return;

  // Already registered this exact token this session — nothing to do.
  if (fcmToken === lastRegisteredToken) {
    return;
  }

  const registrationAttempt = ++latestRegistrationAttempt;
  const isCurrentRegistration = (): boolean =>
    isCurrent() && registrationAttempt === latestRegistrationAttempt;

  // On iOS only, include the persisted VoIP token so we don't clear it.
  const voipToken = Platform.OS === 'ios' ? getLatestVoipTokenForSync() : undefined;

  await registerMobilePushToken(authToken, {
    fcmToken,
    platform,
    deviceId: getOrCreateDeviceId(),
    ...(voipToken ? { voipToken } : {}),
  });
  // Logout or a notification-service stop may have invalidated this request
  // while the backend call was in flight. Do not let an old completion poison
  // the next account's dedupe state.
  if (!canCommitDeviceRegistration(fcmToken, lastRegisteredToken, isCurrentRegistration)) return;
  lastRegisteredToken = fcmToken;
}

// Clears session state on sign-out so the next user registers cleanly.
export function resetDeviceRegistrationState(): void {
  latestRegistrationAttempt += 1;
  lastRegisteredToken = null;
}

async function unregisterDeviceAttempt(
  authToken: string,
  deviceId: string,
  workspaceId?: string,
  timeoutMs = DEVICE_UNREGISTER_TIMEOUT_MS,
): Promise<void> {
  let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timeoutHandle = setTimeout(
      () => reject(new Error(`Push unregister timed out after ${timeoutMs}ms`)),
      timeoutMs,
    );
  });

  try {
    await Promise.race([
      unregisterMobilePushToken(authToken, {
        deviceId,
        ...(workspaceId ? { workspaceId } : {}),
      }),
      timeout,
    ]);
  } finally {
    if (timeoutHandle) clearTimeout(timeoutHandle);
  }
}

async function waitForDeviceUnregisterRetry(delayMs: number): Promise<void> {
  if (delayMs <= 0) return;
  await new Promise<void>(resolve => {
    setTimeout(resolve, delayMs);
  });
}

function shouldRetryDeviceUnregister(error: unknown): boolean {
  if (!isMtlsRequestError(error)) return true;
  return error.statusCode === 0 || [408, 429, 500, 502, 503, 504].includes(error.statusCode);
}

/**
 * Remove this app instance's push binding before the auth session is revoked.
 * A failed network call must not block local logout; callers intentionally use
 * this as a best-effort stage and reset the dedupe state in all cases. The
 * request is idempotent (device/workspace scoped), so a single short retry can
 * recover from a transient timeout without retaining credentials for later use.
 */
export async function unregisterDeviceWithBackend(authToken: string): Promise<void> {
  const generation = getAuthSessionGeneration();
  const operation = getAuthOperation();
  const isCurrent = (): boolean => isAuthScopeCurrent(generation, operation);
  try {
    if (authToken.trim() && isCurrent()) {
      const deviceId = getExistingDeviceId();
      if (!deviceId) {
        throw new Error('Cannot unregister push notifications without a device binding.');
      }
      const workspaceId = getActiveWorkspaceId() ?? undefined;
      const deadline = Date.now() + DEVICE_UNREGISTER_TIMEOUT_MS;
      let lastError: unknown;
      for (let attempt = 0; attempt < DEVICE_UNREGISTER_MAX_ATTEMPTS; attempt += 1) {
        if (!isCurrent()) return;
        const remainingMs = deadline - Date.now();
        if (remainingMs <= 0) break;
        try {
          await unregisterDeviceAttempt(
            authToken,
            deviceId,
            workspaceId,
            Math.min(remainingMs, DEVICE_UNREGISTER_TIMEOUT_MS),
          );
          return;
        } catch (error) {
          lastError = error;
          if (!isCurrent()) return;
          if (!shouldRetryDeviceUnregister(error)) throw error;
          if (attempt + 1 >= DEVICE_UNREGISTER_MAX_ATTEMPTS) break;
          const retryDelayMs = Math.min(DEVICE_UNREGISTER_RETRY_DELAY_MS, deadline - Date.now());
          if (retryDelayMs <= 0) break;
          await waitForDeviceUnregisterRetry(retryDelayMs);
        }
      }
      if (lastError) throw lastError;
      throw new Error('Push unregister deadline elapsed before an attempt could complete.');
    }
  } finally {
    resetDeviceRegistrationState();
  }
}
