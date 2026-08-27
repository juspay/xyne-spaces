import type { BrowserContext } from 'playwright';
import { config } from '@/config';

interface HeaderEntry {
  name: string;
  value: string;
}

interface ResponseWithHeaders {
  headersArray?(): HeaderEntry[] | Promise<HeaderEntry[]>;
}

interface ParsedCookie {
  name: string;
  value: string;
  path?: string;
  expires?: number;
  httpOnly?: boolean;
  secure?: boolean;
  sameSite?: 'Strict' | 'Lax' | 'None';
}

function isXyneAuthCookie(name: string): boolean {
  return (
    (name.startsWith('xyne_ws_') && name.endsWith('_token')) ||
    name === 'xyne_last_workspace' ||
    name === 'xyne_session' ||
    name === 'user_session_id' ||
    name === 'is_new_user'
  );
}

async function getSetCookieHeaders(response: ResponseWithHeaders | undefined): Promise<string[]> {
  if (!response) {
    return [];
  }

  const headerArray = (await response.headersArray?.()) ?? [];
  return headerArray
    .filter((header) => header.name.toLowerCase() === 'set-cookie')
    .map((header) => header.value);
}

function parseSetCookieHeader(header: string): ParsedCookie | null {
  const [nameValuePair, ...attributes] = header.split(';').map((part) => part.trim());
  const separatorIndex = nameValuePair.indexOf('=');

  if (separatorIndex <= 0) {
    return null;
  }

  const cookie: ParsedCookie = {
    name: nameValuePair.slice(0, separatorIndex),
    value: nameValuePair.slice(separatorIndex + 1),
    path: '/',
  };

  for (const attribute of attributes) {
    const [rawName, ...rawValueParts] = attribute.split('=');
    const name = rawName.toLowerCase();
    const value = rawValueParts.join('=');

    if (name === 'path' && value) {
      cookie.path = value;
    } else if (name === 'expires' && value) {
      const parsedDate = Date.parse(value);
      if (!Number.isNaN(parsedDate)) {
        cookie.expires = Math.floor(parsedDate / 1000);
      }
    } else if (name === 'max-age' && value) {
      const maxAgeSeconds = Number(value);
      if (Number.isFinite(maxAgeSeconds)) {
        cookie.expires = Math.floor(Date.now() / 1000 + maxAgeSeconds);
      }
    } else if (name === 'httponly') {
      cookie.httpOnly = true;
    } else if (name === 'secure') {
      cookie.secure = true;
    } else if (name === 'samesite') {
      const normalized = value.toLowerCase();
      if (normalized === 'strict' || normalized === 'lax' || normalized === 'none') {
        cookie.sameSite = (normalized.charAt(0).toUpperCase() +
          normalized.slice(1)) as ParsedCookie['sameSite'];
      }
    }
  }

  return cookie;
}

/**
 * CI talks to backend and dashboard through different Docker hostnames.
 * Test-login cookies are written for the backend origin, while the dashboard
 * can only read cookies scoped to its own origin.
 */
export async function mirrorBackendAuthCookiesToDashboard(
  context: BrowserContext,
  response?: ResponseWithHeaders
): Promise<void> {
  const responseCookies = (await getSetCookieHeaders(response))
    .map(parseSetCookieHeader)
    .filter((cookie): cookie is ParsedCookie => Boolean(cookie))
    .filter((cookie) => isXyneAuthCookie(cookie.name));
  const backendCookies = await context.cookies(config.backend.baseUrl);
  const contextCookies = backendCookies
    .filter((cookie) => isXyneAuthCookie(cookie.name))
    .map((cookie) => ({
      name: cookie.name,
      value: cookie.value,
      path: cookie.path,
      expires: cookie.expires,
      httpOnly: cookie.httpOnly,
      secure: cookie.secure,
      sameSite: cookie.sameSite,
    }));
  const authCookies = responseCookies.length > 0 ? responseCookies : contextCookies;

  if (authCookies.length === 0) {
    throw new Error(
      `No Xyne auth cookies were available after test login. Backend origin: ${config.backend.baseUrl}`
    );
  }

  await context.addCookies(
    authCookies.map((cookie) => ({
      name: cookie.name,
      value: cookie.value,
      url: config.dashboard.baseUrl,
      expires: cookie.expires,
      httpOnly: cookie.httpOnly,
      secure: cookie.secure,
      sameSite: cookie.sameSite,
    }))
  );
}
