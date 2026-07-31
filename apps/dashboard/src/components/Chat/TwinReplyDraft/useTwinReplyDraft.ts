import { useCallback, useMemo, useState } from 'react';
import { useSelector } from '@xstate/react';
import { stateMachineActor } from '../../../machines/stateMachine';
import {
  approveTwinReplyDraft,
  declineTwinReplyDraft,
  rowToTwinReplyDraftView,
  type TwinReplyDraftView,
  type PostedTarget,
} from './twinReplyDraftApi';

const EMPTY: TwinReplyDraftView[] = [];

export interface TwinReplyDraftState {
  /** This thread's pending Twin proposals, newest-first (may be empty). A thread
   *  can hold several — one per @mention of the twin. */
  drafts: TwinReplyDraftView[];
  hasDraft: boolean;
  /** Draft ids with an approve/decline currently in flight (per-card spinners). */
  pending: ReadonlySet<string>;
  /** Approve one draft (by id) — posts/reacts as the user, resolves with where it
   *  landed (null for react-only). The row clears itself via Zero on success. */
  approve: (draftId: string, editedMessage?: string) => Promise<PostedTarget | null>;
  /** Decline one draft (by id) — records feedback, clears the row. */
  decline: (draftId: string) => Promise<void>;
}

/**
 * The caller's OWN pending Digital Twin reply proposals for a thread, read
 * straight from Zero-synced state (the `twinDrafts` slice → draft_messages rows
 * with origin='twin'). Proposals appear and clear LIVE via Zero replication — no
 * bespoke fetch or socket. Owner-only: the twinDrafts query is scoped to the
 * authenticated user, so only the owner's proposals are ever in state.
 */
export function useTwinReplyDraft(conversationId: string | undefined): TwinReplyDraftState {
  // Subscribe to the whole slice (a stable ref that only changes when the set of
  // proposals changes), then derive this thread's views with useMemo — avoids a
  // new array on every unrelated state-machine event.
  const allTwinDrafts = useSelector(stateMachineActor, state => state.context.twinDrafts);

  const drafts = useMemo(() => {
    if (!conversationId) return EMPTY;
    const views = allTwinDrafts
      .filter(d => d.conversationId === conversationId)
      .map(rowToTwinReplyDraftView)
      .filter((v): v is TwinReplyDraftView => v !== null)
      .sort((a, b) => b.createdAt - a.createdAt);
    return views.length > 0 ? views : EMPTY;
  }, [allTwinDrafts, conversationId]);

  const [pending, setPending] = useState<ReadonlySet<string>>(() => new Set());
  const mark = useCallback((id: string, on: boolean) => {
    setPending(prev => {
      const next = new Set(prev);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });
  }, []);

  const approve = useCallback(
    async (draftId: string, editedMessage?: string): Promise<PostedTarget | null> => {
      mark(draftId, true);
      try {
        return await approveTwinReplyDraft(draftId, editedMessage);
      } finally {
        mark(draftId, false);
      }
    },
    [mark],
  );

  const decline = useCallback(
    async (draftId: string): Promise<void> => {
      mark(draftId, true);
      try {
        await declineTwinReplyDraft(draftId);
      } finally {
        mark(draftId, false);
      }
    },
    [mark],
  );

  return { drafts, hasDraft: drafts.length > 0, pending, approve, decline };
}
