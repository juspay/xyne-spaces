import CookieManager from '@react-native-cookies/cookies';

/** Short-lived (10 min) identity cookie set at sign-in, before a workspace is chosen. Not an access token. */
export const PENDING_AUTH_COOKIE = 'xyne_pending_auth';
export const XYNE_LAST_WORKSPACE_COOKIE = 'xyne_last_workspace';

/** The cookie holding a workspace's access JWT. */
export function workspaceTokenCookieName(workspaceId: string): string {
  return `xyne_ws_${workspaceId}_token`;
}

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

/**
 * Serializes the jar cookies that match `url` (origin or full URL, so path-scoped
 * cookies are included) into a single `Cookie` header value.
 */
export async function buildApiCookieHeader(url: string): Promise<string | undefined> {
  try {
    const cookies = await CookieManager.get(url);
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
