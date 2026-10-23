import * as SecureStore from 'expo-secure-store';
import CookieManager from '@react-native-cookies/cookies';

import {
  AUTH_SESSION_COOKIE,
  USER_SESSION_ID_COOKIE,
  getCookieValueFromJar,
} from '@/src/utils/apiCookieHeader';
import { isStoredAuthTokenSignedOut } from './protectedAuthTokenStore';

/**
 * SecureStore mirror of the refresh-session cookie (`xs`, falling back to the
 * legacy `user_session_id`). The cookie jar remains the transport mechanism;
 * this mirror restores the jar when it is lost (OS eviction, jar corruption)
 * so a cold start can still refresh instead of forcing a re-login.
 */
const REFRESH_SESSION_TOKEN_KEY = 'lotus_refresh_session_token_v1';

/** Same durability policy as the protected access token. */
const SECURE_STORE_OPTIONS: SecureStore.SecureStoreOptions = {
  keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY,
};

/** The server enforces the real expiry; the restored cookie just has to outlive it. */
const RESTORED_COOKIE_MAX_AGE_SECONDS = 180 * 24 * 60 * 60;

interface StoredRefreshSessionToken {
  name: typeof AUTH_SESSION_COOKIE | typeof USER_SESSION_ID_COOKIE;
  value: string;
}

function parseStoredRecord(raw: string | null): StoredRefreshSessionToken | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<StoredRefreshSessionToken>;
    if (
      (parsed.name === AUTH_SESSION_COOKIE || parsed.name === USER_SESSION_ID_COOKIE) &&
      typeof parsed.value === 'string' &&
      parsed.value.length > 0
    ) {
      return { name: parsed.name, value: parsed.value };
    }
  } catch {
    // Corrupt record; treat as absent.
  }
  return null;
}

/**
 * Persist the refresh-session cookie currently in the jar. Call after a
 * response whose Set-Cookie headers carried a session cookie.
 */
export async function mirrorRefreshSessionTokenFromJar(origin: string): Promise<void> {
  if (isStoredAuthTokenSignedOut()) return;
  try {
    const xsValue = await getCookieValueFromJar(origin, AUTH_SESSION_COOKIE);
    const record: StoredRefreshSessionToken | null = xsValue
      ? { name: AUTH_SESSION_COOKIE, value: xsValue }
      : await (async (): Promise<StoredRefreshSessionToken | null> => {
          const legacyValue = await getCookieValueFromJar(origin, USER_SESSION_ID_COOKIE);
          return legacyValue ? { name: USER_SESSION_ID_COOKIE, value: legacyValue } : null;
        })();
    if (!record) return;

    const existing = parseStoredRecord(
      await SecureStore.getItemAsync(REFRESH_SESSION_TOKEN_KEY, SECURE_STORE_OPTIONS),
    );
    if (existing && existing.name === record.name && existing.value === record.value) return;

    await SecureStore.setItemAsync(
      REFRESH_SESSION_TOKEN_KEY,
      JSON.stringify(record),
      SECURE_STORE_OPTIONS,
    );
  } catch {
    // Best-effort mirror; the jar still holds the cookie.
  }
}

/**
 * Write the mirrored refresh-session cookie back into the jar and return its
 * value, or undefined when nothing usable is stored. Call when the jar has no
 * session cookie before giving up on a refresh.
 */
export async function restoreRefreshSessionTokenToJar(
  origin: string,
): Promise<string | undefined> {
  if (isStoredAuthTokenSignedOut()) return undefined;
  try {
    const record = parseStoredRecord(
      await SecureStore.getItemAsync(REFRESH_SESSION_TOKEN_KEY, SECURE_STORE_OPTIONS),
    );
    if (!record) return undefined;

    const attributes = origin.startsWith('http://')
      ? 'Path=/; SameSite=Lax'
      : 'Path=/; Secure; HttpOnly; SameSite=Lax';
    await CookieManager.setFromResponse(
      origin,
      `${record.name}=${record.value}; ${attributes}; Max-Age=${RESTORED_COOKIE_MAX_AGE_SECONDS}`,
    );
    return record.value;
  } catch {
    return undefined;
  }
}

export async function deleteStoredRefreshSessionToken(): Promise<void> {
  await SecureStore.deleteItemAsync(REFRESH_SESSION_TOKEN_KEY, SECURE_STORE_OPTIONS);
}
