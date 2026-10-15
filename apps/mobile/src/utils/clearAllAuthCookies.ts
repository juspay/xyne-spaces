/**
 * Clears the HTTP cookie jar used for API session cookies and the dashboard WebView.
 *
 * iOS keeps two stores (NSHTTPCookieStorage and WKWebView). Android's native
 * clearAll implementation removes all cookies and flushes the CookieManager.
 */
export type CookieJar = {
  clearAll: (useWebKit?: boolean) => Promise<boolean>;
};

export async function clearAllAuthCookies(
  cookieJar: CookieJar,
  os: string,
  isCurrent: () => boolean = () => true,
): Promise<void> {
  let didFail = false;
  let firstError: unknown;

  if (!isCurrent()) {
    return;
  }
  try {
    await cookieJar.clearAll(false);
  } catch (error) {
    didFail = true;
    firstError = error;
  }

  if (os === 'ios' && isCurrent()) {
    try {
      await cookieJar.clearAll(true);
    } catch (error) {
      if (!didFail) {
        firstError = error;
      }
      didFail = true;
    }
  }

  if (didFail) {
    throw firstError;
  }
}
