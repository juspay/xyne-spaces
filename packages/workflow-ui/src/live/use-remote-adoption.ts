import { useCallback, useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { wfKeys } from '../hooks/queries.js';
import { useWorkflowChanges } from './use-live-workflow.js';

export interface RemoteAdoption {
  /**
   * Feed into an editor's `key`. It increments only when a change made elsewhere
   * should replace what is on screen — and only once the new copy has actually
   * been read.
   */
  epoch: number;
  /** A change landed that was deliberately not applied, because of local edits. */
  stale: boolean;
  /** Apply the pending change, discarding local edits. */
  adopt: () => void;
  /** Forget a pending change — call when the local edits are gone. */
  clearStale: () => void;
}

/**
 * Decides when a workflow changed elsewhere should replace what the user is
 * looking at.
 *
 * Two rules, and both are easy to get wrong:
 *
 * 1. **Never remount before the new copy has been read.** `invalidateQueries`
 *    resolves when the refetch settles; bumping the epoch any earlier remounts
 *    the editor against the copy we already had. Editors here seed from their
 *    initial config and ignore it afterwards — deliberately, so a background
 *    refetch cannot overwrite someone's typing — so an early remount is not
 *    merely premature, it is permanent: the fresh config arrives moments later
 *    and has nowhere to go. The event looks delivered, the network shows the new
 *    data, and the screen never changes.
 *
 * 2. **Never remount over unsaved work.** Report it instead and let the user
 *    choose, via {@link RemoteAdoption.adopt}.
 */
export function useRemoteAdoption(
  workflowId: string | undefined,
  isDirty: () => boolean,
): RemoteAdoption {
  const queryClient = useQueryClient();
  const [epoch, setEpoch] = useState(0);
  const [stale, setStale] = useState(false);

  useWorkflowChanges(workflowId, () => {
    if (!workflowId) return;
    void queryClient
      .invalidateQueries({ queryKey: wfKeys.workflow(workflowId) })
      .then(() => {
        if (isDirty()) setStale(true);
        else setEpoch((previous) => previous + 1);
      })
      .catch(() => {
        // The refetch failed, so the cache still holds the old copy and there is
        // nothing new to show. The next notification, or a reconnect, retries.
      });
  });

  const adopt = useCallback(() => {
    setStale(false);
    setEpoch((previous) => previous + 1);
  }, []);

  const clearStale = useCallback(() => {
    setStale(false);
  }, []);

  // A different workflow starts with nothing pending.
  useEffect(() => {
    setStale(false);
  }, [workflowId]);

  return { epoch, stale, adopt, clearStale };
}
