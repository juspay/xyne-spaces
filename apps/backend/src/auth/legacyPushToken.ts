/**
 * Pure helpers for the legacy `workflow.user_sessions` push columns, which store
 * `<platform>:<raw token>` and keep `appVersion` inside the `deviceInfo` JSON blob.
 * New `auth_sessions` rows store raw tokens + `pushPlatform` + `appVersion` columns instead.
 */
import type { PushPlatform } from './types';

export function normalizePushPlatform(platform?: string | null): PushPlatform {
  switch ((platform ?? '').trim().toLowerCase()) {
    case 'ios':
      return 'ios';
    case 'android':
      return 'android';
    default:
      return 'unknown';
  }
}

/** `<platform>:<token>` → parts; a bare token is platform `unknown`. */
export function parseLegacyPushToken(stored?: string | null): { platform: PushPlatform; token: string } | null {
  if (!stored || stored.trim().length === 0) return null;
  const i = stored.indexOf(':');
  if (i === -1) return { platform: 'unknown', token: stored };
  const token = stored.slice(i + 1);
  if (!token) return null;
  return { platform: normalizePushPlatform(stored.slice(0, i)), token };
}

export function appVersionFromDeviceInfo(deviceInfo: string | null | undefined): string | undefined {
  if (!deviceInfo) return undefined;
  try {
    const parsed = JSON.parse(deviceInfo) as { appVersion?: unknown };
    return typeof parsed.appVersion === 'string' && parsed.appVersion ? parsed.appVersion : undefined;
  } catch {
    return undefined;
  }
}
