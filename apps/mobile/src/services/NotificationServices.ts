import { apiPost } from './apiClient';
import { buildAuthenticatedHeaders } from './authToken';

export type MobilePlatform = 'ios' | 'android' | 'unknown';

interface RegisterMobilePushTokenRequest {
  fcmToken: string;
  voipToken?: string;
  platform: MobilePlatform;
  deviceId?: string;
}

interface RegisterMobilePushTokenResponse {
  success: boolean;
}

interface UnregisterMobilePushTokenResponse {
  success: boolean;
}

export interface UnregisterMobilePushTokenRequest {
  /** Stable per-install identifier used to revoke only this device binding. */
  deviceId: string;
  /** Optional workspace scope when the backend stores bindings per workspace. */
  workspaceId?: string;
}

export async function registerMobilePushToken(
  authToken: string,
  request: RegisterMobilePushTokenRequest,
): Promise<void> {
  const trimmedAuthToken = authToken.trim();
  if (!trimmedAuthToken) return;
  // Registration is session-bound. Do not resolve a newer global token after
  // this operation starts; that could register one account's device using a
  // different account's credential during logout/login replacement.
  const headers = { Authorization: `Bearer ${trimmedAuthToken}` };

  const body = {
    fcmToken: request.fcmToken,
    platform: request.platform,
    ...(request.deviceId ? { deviceId: request.deviceId } : {}),
    ...(request.voipToken ? { voipToken: request.voipToken } : {}),
  };

  await apiPost<RegisterMobilePushTokenResponse>('/notifications/mobile/register', body, {
    headers,
  });

  console.log('[NotificationServices] Token registered successfully');
}

export async function unregisterMobilePushToken(
  authToken: string,
  request: UnregisterMobilePushTokenRequest,
): Promise<void> {
  const deviceId = request.deviceId?.trim();
  if (!deviceId) {
    throw new Error('A device-scoped identifier is required to unregister push notifications.');
  }

  // Logout must use the current session directly. Resolving headers first can
  // trigger a refresh after the caller has already started ending the session.
  const headers = authToken.trim()
    ? { Authorization: `Bearer ${authToken}` }
    : await buildAuthenticatedHeaders();

  await apiPost<UnregisterMobilePushTokenResponse>(
    '/notifications/mobile/unregister',
    {
      deviceId,
      ...(request.workspaceId?.trim() ? { workspaceId: request.workspaceId.trim() } : {}),
    },
    {
      headers,
    },
  );

  console.log('[NotificationServices] Token unregistered successfully');
}
