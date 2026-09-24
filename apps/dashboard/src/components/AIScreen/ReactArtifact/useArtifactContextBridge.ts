import { useEffect, type MutableRefObject } from 'react';
import {
  ARTIFACT_DATA_PROTOCOL_VERSION,
  isAppArtifactMessage,
  type HostContextMessage,
  type XyneAppContext,
} from './artifactData.constants';
import type { PreviewClientRef } from './useArtifactDataBridge';

interface BridgeArgs {
  previewRef: MutableRefObject<PreviewClientRef | null>;
  /**
   * The current context, held in a ref rather than passed as a value: the
   * sandbox is memoized and a changing prop would re-run it, so the bridge
   * reads the latest at the moment it answers.
   */
  contextRef: MutableRefObject<XyneAppContext | null>;
  /**
   * Assigned by this hook. The owner calls it when the context changes, which
   * pushes the new value into a RUNNING app — the alternative, remounting, would
   * reboot the app and lose its state every time the user changed channel.
   */
  pushRef: MutableRefObject<(() => void) | null>;
}

/**
 * Tells an app where it is open: the rail, the Inbox menubar, a channel tab, the
 * Agent Hub, or inline in a chat.
 *
 * Only the host can answer this — the backend has no notion of where an iframe
 * is mounted — so it travels over the same postMessage channel as the other
 * bridges. The app asks once on boot (`context-request`) and the host also
 * pushes on change.
 *
 * Nothing here grants access. The value is unforgeable by the app, but every
 * request an app makes is still authorized as the viewer, so an app that treats
 * `channel.id` as permission rather than as a hint is wrong and the API will
 * still refuse it.
 */
export function useArtifactContextBridge({ previewRef, contextRef, pushRef }: BridgeArgs): void {
  useEffect(() => {
    /** The app's window, resolved at call time — the iframe is replaced on reload. */
    const appWindow = (): Window | null =>
      previewRef.current?.getClient()?.iframe?.contentWindow ?? null;

    const send = (): void => {
      const context = contextRef.current;
      const target = appWindow();
      if (!context || !target) return;
      const message: HostContextMessage = {
        source: 'xyne-artifact-host',
        v: ARTIFACT_DATA_PROTOCOL_VERSION,
        type: 'context',
        context,
      };
      try {
        target.postMessage(message, '*');
      } catch {
        // The app retries its request a few times; a lost push is recovered by
        // the next change, and neither case is worth failing the render over.
      }
    };

    const onMessage = (event: MessageEvent): void => {
      if (event.source !== appWindow()) return;
      if (!isAppArtifactMessage(event.data)) return;
      if (event.data.type !== 'context-request') return;
      send();
    };

    window.addEventListener('message', onMessage);
    pushRef.current = send;
    return (): void => {
      window.removeEventListener('message', onMessage);
      pushRef.current = null;
    };
  }, [previewRef, contextRef, pushRef]);
}
