export type LogAppVariant = 'dev' | 'sandbox' | 'prod' | 'community' | undefined;

/**
 * Raw email may be included only in release logs sent directly to the first-party
 * Godel event endpoint for the selected application environment.
 */
export function canIncludeEmailInRemoteLogs(
  endpoint: string,
  appVariant: LogAppVariant,
  isDevelopmentBuild: boolean,
): boolean {
  const expectedHost =
    appVariant === 'prod'
      ? 'spaces.xyne.juspay.net'
      : appVariant === 'sandbox'
        ? 'spaces.sandbox.xyne.juspay.net'
        : appVariant === 'community'
          ? 'spaces.xyne.ai'
          : null;
  if (!expectedHost) return false;

  try {
    const parsed = new URL(endpoint);
    return (
      !isDevelopmentBuild &&
      parsed.protocol === 'https:' &&
      parsed.hostname.toLowerCase() === expectedHost &&
      (parsed.port.length === 0 || parsed.port === '443') &&
      parsed.pathname === '/godel/events' &&
      parsed.search.length === 0 &&
      parsed.hash.length === 0 &&
      parsed.username.length === 0 &&
      parsed.password.length === 0
    );
  } catch {
    return false;
  }
}
