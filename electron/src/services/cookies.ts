import { session } from 'electron';

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
    const [nameValue] = cookieStr.split(';');
    const [name, ...valueParts] = nameValue.split('=');
    const value = valueParts.join('=');
    // Use 'no_restriction' (SameSite=None) to allow cookies to be sent from
    // custom protocol (xyne-spaces://) to the backend. This requires secure: true.
    return session.defaultSession.cookies.set({
      url: baseUrl,
      name,
      value,
      httpOnly: true,
      secure: true,
      sameSite: 'no_restriction',
    }).catch((error) => {
      console.error('Failed to set cookie:', error);
    });
  });

  await Promise.all(cookiePromises);
}
