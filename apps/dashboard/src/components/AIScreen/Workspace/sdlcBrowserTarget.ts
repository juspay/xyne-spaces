import type { ElectronWebviewElement } from '../../../types/electron';
import { SDLC_FRAME_MESSAGE } from '../../../routes/SdlcScreen/sdlcFrameMessages';

let webviewGetter: (() => ElectronWebviewElement | null) | null = null;
let framePoster: ((message: unknown) => void) | null = null;
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

export function registerSdlcFramePoster(post: (message: unknown) => void): () => void {
  framePoster = post;
  return () => {
    if (framePoster === post) framePoster = null;
  };
}

export function requestSdlcBrowser(): boolean {
  if (!framePoster) return false;
  framePoster({ type: SDLC_FRAME_MESSAGE.showBrowser });
  return true;
}
