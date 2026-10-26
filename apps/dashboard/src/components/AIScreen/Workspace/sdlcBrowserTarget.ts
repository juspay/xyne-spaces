import type { ElectronWebviewElement } from '../../../types/electron';

let webviewGetter: (() => ElectronWebviewElement | null) | null = null;
let browserOpener: (() => boolean) | null = null;
const webviewListeners = new Set<() => void>();

export function registerSdlcWebviewGetter(get: () => ElectronWebviewElement | null): () => void {
  webviewGetter = get;
  sdlcWebviewChanged();
  return () => {
    if (webviewGetter !== get) return;
    webviewGetter = null;
    sdlcWebviewChanged();
  };
}

/** Said by the SDLC browser when the page it shows may be another: one opened,
 *  closed, or another tab shown. */
export function sdlcWebviewChanged(): void {
  webviewListeners.forEach(listener => listener());
}

/** Hears the SDLC browser's shown page change. */
export function subscribeToSdlcWebview(listener: () => void): () => void {
  webviewListeners.add(listener);
  return () => webviewListeners.delete(listener);
}

export function getSdlcWebview(): ElectronWebviewElement | null {
  return webviewGetter?.() ?? null;
}

/** Set by the SDLC screen while it is open: shows the open folder's browsing tab. */
export function registerSdlcBrowserOpener(open: () => boolean): () => void {
  browserOpener = open;
  return () => {
    if (browserOpener === open) browserOpener = null;
  };
}

/** False when no SDLC screen is open to show a browser in. */
export function requestSdlcBrowser(): boolean {
  return browserOpener?.() ?? false;
}
