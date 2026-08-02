import { useMemo } from 'react';
import { useSelector } from '@xstate/react';
import { stateMachineActor } from '../../../machines/stateMachine';
import type { TwinDraftAction } from './twinReplyDraftApi';

/** Minimal marker that a thread has a pending Twin proposal (enough to render the
 *  row indicator without the full draft). */
export interface TwinDraftBadge {
  conversationId: string;
  action: TwinDraftAction;
}

/**
 * Whether a thread has a pending Digital Twin proposal — derived straight from
 * Zero-synced state (the `twinDrafts` slice → draft_messages rows with
 * origin='twin'). No fetch, no socket, no provider: the same rows that drive the
 * in-thread dock also drive the row indicator, so a badge appears and clears the
 * instant the proposal does. Returns the NEWEST proposal's marker (a thread may
 * hold several); undefined when there's none. Owner-only by construction — the
 * twinDrafts query is scoped to the authenticated user.
 */
export function useTwinDraftBadge(conversationId?: string): TwinDraftBadge | undefined {
  const all = useSelector(stateMachineActor, state => state.context.twinDrafts);
  return useMemo(() => {
    if (!conversationId) return undefined;
    let newest: { createdAt: number; action: TwinDraftAction } | undefined;
    for (const d of all) {
      if (d.conversationId !== conversationId) continue;
      // metadata is stringified JSON (TEXT column) — parse to read the action.
      let action: TwinDraftAction = 'reply';
      if (typeof d.metadata === 'string') {
        try {
          action = (JSON.parse(d.metadata) as { action?: TwinDraftAction }).action ?? 'reply';
        } catch {
          // malformed metadata → keep default 'reply'
        }
      }
      if (!newest || d.createdAt > newest.createdAt) newest = { createdAt: d.createdAt, action };
    }
    return newest ? { conversationId, action: newest.action } : undefined;
  }, [all, conversationId]);
}
