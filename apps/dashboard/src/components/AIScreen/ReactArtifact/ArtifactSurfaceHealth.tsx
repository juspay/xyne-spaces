import { useEffect, useRef, type MutableRefObject } from 'react';
import { useSandpack } from '@codesandbox/sandpack-react';
import { isAppArtifactMessage } from './artifactData.constants';
import type { PreviewClientRef } from './useArtifactDataBridge';

export type ArtifactSurfaceHealthState = 'ready' | 'failed';

/** A boot that has not painted by then counts as a failure. */
const BOOT_TIMEOUT_MS = 45_000;

/**
 * Reports whether an overlay or widget started, in place of the boot and error
 * overlays a page gets. Neither fits there: an overlay must never cover the
 * window with a loader or an error card, and a widget shows its own card from
 * the shell.
 *
 * The same three signals as those overlays: the bundler's `done` (painted), its
 * error or timeout, and the app's own error report from its root boundary. One
 * report per boot; the shell remounts the sandbox to try again.
 */
export const ArtifactSurfaceHealth = ({
  previewRef,
  healthRef,
}: {
  previewRef: MutableRefObject<PreviewClientRef | null>;
  healthRef: MutableRefObject<((state: ArtifactSurfaceHealthState) => void) | null>;
}): null => {
  const { sandpack, listen } = useSandpack();
  const reported = useRef(false);

  useEffect(() => {
    const report = (state: ArtifactSurfaceHealthState): void => {
      if (reported.current) return;
      reported.current = true;
      healthRef.current?.(state);
    };
    const timer = window.setTimeout(() => report('failed'), BOOT_TIMEOUT_MS);
    const unsubscribe = listen(message => {
      if (message.type === 'done') {
        window.clearTimeout(timer);
        report('ready');
      }
    });
    // The app's own report from its root boundary, which also arrives after
    // `done` when the app throws later on.
    const onMessage = (event: MessageEvent): void => {
      const frame = previewRef.current?.getClient()?.iframe?.contentWindow;
      if (!frame || event.source !== frame) return;
      if (isAppArtifactMessage(event.data) && event.data.type === 'error') {
        reported.current = false;
        report('failed');
      }
    };
    window.addEventListener('message', onMessage);
    return (): void => {
      window.clearTimeout(timer);
      unsubscribe();
      window.removeEventListener('message', onMessage);
    };
  }, [listen, previewRef, healthRef]);

  useEffect(() => {
    if (!sandpack.error && sandpack.status !== 'timeout') return;
    // Also after `ready`: a later bundler error is a failure all the same.
    reported.current = true;
    healthRef.current?.('failed');
  }, [sandpack.error, sandpack.status, healthRef]);

  return null;
};
