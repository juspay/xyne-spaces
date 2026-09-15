import { useCallback, useMemo, useState } from 'react';
import { useSelector } from '@xstate/react';
import { stateMachineActor } from '../machines/stateMachine';
import {
  approveTwinReplyDraft,
  declineTwinReplyDraft,
  rowToTwinReplyDraftView,
  type TwinReplyDraftView,
  type PostedTarget,
} from '../components/Chat/TwinReplyDraft/twinReplyDraftApi';

const EMPTY: TwinReplyDraftView[] = [];

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
