import type { MutableRefObject } from 'react';
import type { SandpackPreviewRef } from '@codesandbox/sandpack-react';

export interface ArtifactFrame {
  window: Window;
  origin: string;
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

export function isFromArtifactFrame(
  event: MessageEvent,
  previewRef: MutableRefObject<SandpackPreviewRef | null>,
): boolean {
  const frame = artifactFrame(previewRef);
  return !!frame && event.source === frame.window && event.origin === frame.origin;
}
