// postMessage contract between the main bundle and the SDLC lane's iframe. The
// frame is kept alive across route changes, so it cannot be navigated by swapping
// `src` — that would reload it. Paths on the wire are basename-free: both bundles
// share one route table and react-router strips the basename, so a path means the
// same thing on both sides.

export const SDLC_FRAME_MESSAGE = {
  navigate: 'xyne:sdlc-frame:navigate',
  route: 'xyne:sdlc-frame:route',
  ready: 'xyne:sdlc-frame:ready',
  reset: 'xyne:sdlc-frame:reset',
} as const;

export interface SdlcFrameNavigateMessage {
  type: typeof SDLC_FRAME_MESSAGE.navigate;
  path: string;
}

export interface SdlcFrameRouteMessage {
  type: typeof SDLC_FRAME_MESSAGE.route;
  path: string;
}

export interface SdlcFrameReadyMessage {
  type: typeof SDLC_FRAME_MESSAGE.ready;
}

/** Frame → parent: destroy this frame and mount a fresh one at the SDLC root. */
export interface SdlcFrameResetMessage {
  type: typeof SDLC_FRAME_MESSAGE.reset;
}

export type SdlcFrameMessage =
  | SdlcFrameNavigateMessage
  | SdlcFrameRouteMessage
  | SdlcFrameReadyMessage
  | SdlcFrameResetMessage;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/**
 * Both sync directions check this rather than the viewport alone: leaving /sdlc
 * updates the location and clears the viewport in separate effects, so there is a
 * render where the new non-SDLC path is visible while the viewport still looks
 * active — enough to push the frame onto /chat and lose its state.
 */
export function isSdlcPath(pathname: string): boolean {
  return /^\/[^/]+\/sdlc(\/|$)/.test(pathname);
}

/** Narrows the shape only — callers must also check `event.origin`. */
export function parseSdlcFrameMessage(data: unknown): SdlcFrameMessage | null {
  if (!isRecord(data)) return null;
  const { type } = data;

  if (type === SDLC_FRAME_MESSAGE.ready || type === SDLC_FRAME_MESSAGE.reset) {
    return { type };
  }

  if (type === SDLC_FRAME_MESSAGE.navigate || type === SDLC_FRAME_MESSAGE.route) {
    // Rooted same-origin paths only; '//' would be another host.
    const { path } = data;
    if (typeof path !== 'string' || !path.startsWith('/') || path.startsWith('//')) {
      return null;
    }
    return { type, path };
  }

  return null;
}
