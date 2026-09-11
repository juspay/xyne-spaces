import { session } from 'electron';
import log from 'electron-log/main';
import { Logger } from './logger/Logger';

/**
 * Clears all cookies from the default session
 */
export async function clearAllCookies(): Promise<void> {
  try {
    const cookies = await session.defaultSession.cookies.get({});
    for (const cookie of cookies) {
      const url = `${cookie.secure ? 'https' : 'http'}://${cookie.domain}${cookie.path}`;
      await session.defaultSession.cookies.remove(url, cookie.name);
    }
  } catch (error) {
    Logger.logError('cookies.clear.failed', error);
  }
}

/**
 * Sets cookies from Set-Cookie headers
 */
export async function setCookiesFromHeaders(
  setCookieHeaders: string | string[] | undefined,
  baseUrl: string
): Promise<void> {
  if (!setCookieHeaders) return;

  const cookies = Array.isArray(setCookieHeaders) ? setCookieHeaders : [setCookieHeaders];

  const cookiePromises = cookies.map((cookieStr) => {
    const parts = cookieStr.split(';');
    const [nameValue] = parts;
    const [name, ...valueParts] = nameValue.split('=');
    const value = valueParts.join('=');

    // Parse cookie attributes (Max-Age, Expires)
    let maxAge: number | null = null;
    let expires: string | null = null;

    for (let i = 1; i < parts.length; i++) {
      const part = parts[i].trim();
      const [attrName, ...attrValueParts] = part.split('=');
      const attrValue = attrValueParts.join('=').trim();
      const normalizedAttrName = attrName.trim().toLowerCase();

      if (normalizedAttrName === 'max-age') {
        const parsedMaxAge = parseInt(attrValue, 10);
        if (!isNaN(parsedMaxAge)) {
          maxAge = parsedMaxAge;
        }
      } else if (normalizedAttrName === 'expires') {
        expires = attrValue;
      }
    }

    log.info(`Setting cookie: ${name}=${value}, Max-Age=${maxAge}, Expires=${expires}`);
    // Calculate expirationDate
    let expirationDate: number | undefined;

    if (maxAge !== null && maxAge > 0) {
      // Max-Age takes priority
      expirationDate = Math.floor(Date.now() / 1000) + maxAge;
    } else if (expires && maxAge === null) {
      // Fallback to Expires if Max-Age not present
      const expiresDate = new Date(expires);
      if (!isNaN(expiresDate.getTime())) {
        expirationDate = Math.floor(expiresDate.getTime() / 1000);
      }
    }
    // Max-Age <= 0 or invalid formats: treat as session cookie (no expirationDate)

    // Use 'no_restriction' (SameSite=None) to allow cookies to be sent from
    // custom protocol (xyne-spaces://) to the backend. This requires secure: true.
    return session.defaultSession.cookies.set({
      url: baseUrl,
      name,
      value,
      httpOnly: true,
      secure: true,
      sameSite: 'no_restriction',
      ...(expirationDate !== undefined && { expirationDate }),
    }).catch((error) => {
      Logger.logError('cookies.set.failed', error, { cookie_name: name });
    });
  });

  await Promise.all(cookiePromises);
}

/**
 * Clears all cookies and storage for the browser-tabs partition
 */
export async function clearBrowserTabsData(): Promise<void> {
  try {
    const browserSession = session.fromPartition('persist:browser-tabs');
    await browserSession.clearStorageData();
    log.info('Cleared browser tabs data');
  } catch (error) {
    Logger.logError('browser-tabs.storage.clear.failed', error);
  }
}

/**
 * Partition used exclusively for tabs loading Xyne-internal URLs inside the
 * browser panel. Keeping it separate from `persist:browser-tabs` (used for
 * arbitrary external sites) ensures our auth cookies are never present in the
 * same jar as untrusted third-party sites.
 */
const XYNE_SPACES_PARTITION = 'persist:xyne-spaces';

/**
 * Copies the main-app auth cookies for a given Xyne origin from the default
 * session into the `persist:xyne-spaces` partition. This is what lets a Xyne
 * URL opened in the browser panel inherit the main window's sign-in state
 * without forcing the user to log in again.
 *
 * Contract: only called with URLs we control (Xyne origins). The cookie copy
 * preserves the original attributes (domain, path, secure, httpOnly, sameSite,
 * expirationDate), so Chromium still enforces domain/sameSite scoping — these
 * cookies cannot leak to any non-Xyne requests.
 */
export async function syncXyneCookiesToBrowserPanel(xyneUrl: string): Promise<void> {
  let origin: string;
  try {
    origin = new URL(xyneUrl).origin;
  } catch (error) {
    log.warn('[syncXyneCookiesToBrowserPanel] Invalid URL:', xyneUrl, error);
    return;
  }

  try {
    const src = session.defaultSession;
    const dst = session.fromPartition(XYNE_SPACES_PARTITION);
    const cookies = await src.cookies.get({ url: origin });
    await Promise.all(
      cookies.map((cookie) =>
        dst.cookies
          .set({
            url: origin,
            name: cookie.name,
            value: cookie.value,
            domain: cookie.domain,
            path: cookie.path,
            secure: cookie.secure,
            httpOnly: cookie.httpOnly,
            sameSite: cookie.sameSite,
            ...(cookie.expirationDate !== undefined && {
              expirationDate: cookie.expirationDate,
            }),
          })
          .catch((error) => {
            Logger.logError('browser-tabs.cookies.set.failed', error, {
              cookie_name: cookie.name,
            });
          }),
      ),
    );
  } catch (error) {
    Logger.logError('browser-tabs.cookies.sync.failed', error);
  }
}
