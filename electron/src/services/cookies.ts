import { session } from 'electron';
import log from 'electron-log/main';

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
    console.error('Failed to clear cookies:', error);
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
      console.error('Failed to set cookie:', error);
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
    console.log('Cleared browser tabs data');
  } catch (error) {
    console.error('Failed to clear browser tabs data:', error);
  }
}
