import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSelector } from '@xstate/react';
import { stateMachineActor } from '../machines/stateMachine';
import {
  approveTwinReplyDraft,
  declineTwinReplyDraft,
  rowToTwinReplyDraftView,
  type TwinReplyDraftView,
  type PostedTarget,
} from '../components/Chat/TwinReplyDraft/twinReplyDraftApi';
import { globalClickTracker } from '../services/Analytics/globalClickTracker';
import { lengthBucket } from '../services/Analytics/trackSource';

const EMPTY: TwinReplyDraftView[] = [];

/**
 * When each draft was first put on screen, by draft id. Module-level so the
 * dock's send / edit / decline buttons can stamp `shownAt` into their metadata
 * (the delta is `timestamp - shownAt` at query time — computing it at render
 * would freeze it at the last re-render, not the click).
 */
const twinDraftShownAtById = new Map<string, number>();

export function twinDraftShownAt(draftId: string): number | null {
  return twinDraftShownAtById.get(draftId) ?? null;
}

export interface TwinReplyDraftState {
  drafts: TwinReplyDraftView[];
  hasDraft: boolean;
  pending: ReadonlySet<string>;
  approve: (draftId: string, editedMessage?: string) => Promise<PostedTarget | null>;
  decline: (draftId: string) => Promise<void>;
}

export function useTwinReplyDraft(conversationId: string | undefined): TwinReplyDraftState {
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

  // Impression: a twin draft became visible for this thread. The dock's
  // send / edit / decline clicks need it as their denominator. Once per draft
  // id for the life of the page; a re-render or re-mount is silent.
  useEffect(() => {
    for (const draft of drafts) {
      if (twinDraftShownAtById.has(draft.id)) continue;
      const shownAt = Date.now();
      twinDraftShownAtById.set(draft.id, shownAt);
      globalClickTracker.trackManualEvent('twin-dock', 'TWIN_DRAFT_SHOWN', undefined, {
        draftId: draft.id,
        conversationId: draft.conversationId,
        action: draft.action,
        destinationKind: draft.destinationKind,
        draftLengthBucket: lengthBucket(draft.message?.length ?? 0),
        hasReasoning: !!draft.reasoning,
        hasSources: Array.isArray(draft.clawCitations) && draft.clawCitations.length > 0,
        draftAgeMs: Math.max(0, shownAt - draft.createdAt),
        shownAt,
      });
    }
  }, [drafts]);

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
