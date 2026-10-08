import type { MutableRefObject } from 'react';
import type { SandpackPreviewRef } from '@codesandbox/sandpack-react';

export interface ArtifactFrame {
  window: Window;
  origin: string;
}

/** Whether the app is on screen, and a hook to run held work when it comes back. */
export interface ArtifactVisibility {
  isActive: () => boolean;
  onResume: (fn: () => void) => () => void;
}

function originOf(url: unknown): string | null {
  if (typeof url !== 'string' || !url) return null;
  try {
    const { origin } = new URL(url);
    return origin === 'null' ? null : origin;
  } catch {
    return null;
  }
}

/** App window plus its boot origin, so a frame navigated elsewhere stops matching. */
export function artifactFrame(
  previewRef: MutableRefObject<SandpackPreviewRef | null>,
): ArtifactFrame | null {
  const client = previewRef.current?.getClient();
  const iframe = client?.iframe;
  const frameWindow = iframe?.contentWindow;
  if (!client || !iframe || !frameWindow) return null;
  // `bundlerURL` exists only on the runtime client.
  const origin = originOf((client as { bundlerURL?: unknown }).bundlerURL) ?? originOf(iframe.src);
  return origin ? { window: frameWindow, origin } : null;
}

let warnedOriginMismatch = false;

export function isFromFrame(event: MessageEvent, frame: ArtifactFrame | null): boolean {
  if (!frame || event.source !== frame.window) return false;
  if (event.origin === frame.origin) return true;
  // Fine after the app navigates away; otherwise the origin is derived wrong and every message is lost.
  if (!warnedOriginMismatch) {
    warnedOriginMismatch = true;
    // eslint-disable-next-line no-console -- the only signal when every bridge message is being dropped
    console.warn('[artifact-app] dropped bridge message from unexpected origin', {
      expected: frame.origin,
      got: event.origin,
    });
  }
  return false;
}

export function isFromArtifactFrame(
  event: MessageEvent,
  previewRef: MutableRefObject<SandpackPreviewRef | null>,
): boolean {
  return isFromFrame(event, artifactFrame(previewRef));
}
