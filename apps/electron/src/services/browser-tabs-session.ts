import { session } from 'electron';
import log from 'electron-log/main';

/**
 * Outside sites in the in-app browsers see a plain Chrome user agent. Electron's own
 * names the app and "Electron", and some sign-ins — Google's above all — refuse a
 * browser that says so ("This browser or app may not be secure"), even with the
 * reader's own browser sessions imported. Xyne's own pages keep their jar and their
 * handling (request-interceptor.ts); only `persist:browser-tabs` changes here.
 */
export function setupBrowserTabsUserAgent(): void {
  const chromeMajor = (process.versions.chrome ?? '').split('.')[0];
  if (!chromeMajor) return;
  const platform =
    process.platform === 'darwin'
      ? 'Macintosh; Intel Mac OS X 10_15_7'
      : process.platform === 'win32'
        ? 'Windows NT 10.0; Win64; x64'
        : 'X11; Linux x86_64';
  // Chrome itself reports only its major version, the rest as zeros.
  const userAgent = `Mozilla/5.0 (${platform}) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${chromeMajor}.0.0.0 Safari/537.36`;
  session.fromPartition('persist:browser-tabs').setUserAgent(userAgent);
  log.info('[BrowserTabs] User agent set for outside sites');
}
