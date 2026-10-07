import type { ElectronWebviewElement } from '../../../types/electron';
import { SDLC_FRAME_MESSAGE } from '../../../routes/SdlcScreen/sdlcFrameMessages';

let webviewGetter: (() => ElectronWebviewElement | null) | null = null;
let framePoster: ((message: unknown) => void) | null = null;

export function registerSdlcWebviewGetter(get: () => ElectronWebviewElement | null): () => void {
  webviewGetter = get;
  return () => {
    if (webviewGetter === get) webviewGetter = null;
  };
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
