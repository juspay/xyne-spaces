import CookieManager from '@react-native-cookies/cookies';

export const GOOGLE_ACCESS_TOKEN_COOKIE = 'google_access_token';
export const USER_SESSION_ID_COOKIE = 'user_session_id';
export const XYNE_SESSION_COOKIE = 'xyne_session';
export const XYNE_LAST_WORKSPACE_COOKIE = 'xyne_last_workspace';

function cookieEntryToValue(
  entry: string | { value: string } | undefined | null,
): string | undefined {
  if (entry === null) return undefined;
  if (typeof entry === 'string') return entry;
  if (typeof entry === 'object' && 'value' in entry && typeof entry.value === 'string') {
    return entry.value;
  }
  return undefined;
}

export async function getCookieValueFromJar(
  origin: string,
  name: string,
): Promise<string | undefined> {
  try {
    const cookies = await CookieManager.get(origin);
    return cookieEntryToValue(cookies[name]);
  } catch {
    return undefined;
  }
}

export async function getSessionIdFromJar(origin: string): Promise<string | undefined> {
  const xyneSessionId = await getCookieValueFromJar(origin, XYNE_SESSION_COOKIE);
  if (xyneSessionId) {
    return xyneSessionId;
  }
  return getCookieValueFromJar(origin, USER_SESSION_ID_COOKIE);
}

/**
 * Serializes all cookies for `origin` into a single `Cookie` header value.
 */
export async function buildApiCookieHeader(origin: string): Promise<string | undefined> {
  try {
    const cookies = await CookieManager.get(origin);
    const parts: string[] = [];
    for (const [name, raw] of Object.entries(cookies)) {
      const value = cookieEntryToValue(raw);
      if (value !== undefined && value !== '') {
        parts.push(`${name}=${value}`);
      }
    }
    if (parts.length === 0) return undefined;
    return parts.join('; ');
  } catch {
    return undefined;
  }
}

/**
 * Merge jar cookies with an optional explicit `Cookie` from request options.
 */
export function mergeCookieHeader(
  jarHeader: string | undefined,
  explicit: string | undefined,
): string | undefined {
  const parts = [explicit, jarHeader].filter(Boolean) as string[];
  if (parts.length === 0) return undefined;
  return parts.join('; ');
}
