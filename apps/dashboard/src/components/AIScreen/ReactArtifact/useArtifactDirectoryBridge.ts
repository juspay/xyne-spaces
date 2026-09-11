import { useEffect, type MutableRefObject } from 'react';
import { stateMachineActor } from '../../../machines/stateMachine';
import { buildArtifactDirectory, directorySourceRefs } from './artifactDirectory';
import { ARTIFACT_DATA_PROTOCOL_VERSION, isAppArtifactMessage } from './artifactData.constants';
import type { HostDirectoryMessage } from './artifactData.constants';
import type { PreviewClientRef } from './useArtifactDataBridge';

interface DirectoryBridgeArgs {
  /** Needed by the canonical DM resolver: it excludes you from participant lists
   *  and renders a self-DM as "You". A plain string, so it cannot destabilise the
   *  memoized sandbox the way an object prop would. */
  currentUserId: string;
  previewRef: MutableRefObject<PreviewClientRef | null>;
}

/**
 * Pushes resolved id → name lookups into an artifact app.
 *
 * Separate from the data bridge on purpose. That hook skips its listener
 * entirely for an artifact with no `dataRequirements`, and the directory is
 * useful beyond declared reads — an app rendering rows it got from an agent run
 * still needs names. Keeping it apart also means this touches none of the
 * working read/write path.
 *
 * Costs no network call: everything comes from the store `InitialStateLoader`
 * already populated, so an app open resolves names for free rather than
 * re-fetching the user table.
 */
export function useArtifactDirectoryBridge({
  currentUserId,
  previewRef,
}: DirectoryBridgeArgs): void {
  useEffect(() => {
    if (!currentUserId) return;

    let cancelled = false;
    let lastRefs = { users: undefined as unknown, channels: undefined as unknown };

    const appWindow = (): Window | null =>
      previewRef.current?.getClient()?.iframe?.contentWindow ?? null;

    const post = (): void => {
      const target = appWindow();
      if (!target) return;
      const message: HostDirectoryMessage = {
        source: 'xyne-artifact-host',
        v: ARTIFACT_DATA_PROTOCOL_VERSION,
        type: 'directory',
        directory: buildArtifactDirectory(currentUserId),
      };
      try {
        target.postMessage(message, '*');
      } catch {
        /* structured-clone failure — names simply stay unresolved in the app */
      }
    };

    const onMessage = (event: MessageEvent): void => {
      if (!isAppArtifactMessage(event.data)) return;
      const target = appWindow();
      if (!target || event.source !== target) return;
      // An iframe reload loses the app's copy; `ready` is how it asks again.
      if (event.data.type === 'ready') post();
    };

    window.addEventListener('message', onMessage);
    post();

    // Re-push only when the store actually swaps the arrays (a colleague joins,
    // a DM is created). Reference comparison is enough because the machine
    // replaces them wholesale, and it keeps a chatty store from rebuilding the
    // directory on every unrelated event.
    const subscription = stateMachineActor.subscribe(() => {
      if (cancelled) return;
      const refs = directorySourceRefs();
      if (refs.users === lastRefs.users && refs.channels === lastRefs.channels) return;
      lastRefs = refs;
      post();
    });

    lastRefs = directorySourceRefs();

    return (): void => {
      cancelled = true;
      window.removeEventListener('message', onMessage);
      subscription.unsubscribe();
    };
  }, [currentUserId, previewRef]);
}
