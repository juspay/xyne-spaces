import { useMemo } from 'react';
import { useSelector } from '@xstate/react';
import { stateMachineActor } from '../../../machines/stateMachine';
import type { TwinDraftAction } from './twinReplyDraftApi';

export interface TwinDraftBadge {
  conversationId: string;
  action: TwinDraftAction;
}

export function useTwinDraftBadge(conversationId?: string): TwinDraftBadge | undefined {
  const all = useSelector(stateMachineActor, state => state.context.twinDrafts);
  return useMemo(() => {
    if (!conversationId) return undefined;
    let newest: { createdAt: number; action: TwinDraftAction } | undefined;
    for (const d of all) {
      if (d.conversationId !== conversationId) continue;
      let action: TwinDraftAction = 'reply';
      if (typeof d.metadata === 'string') {
        try {
          action = (JSON.parse(d.metadata) as { action?: TwinDraftAction }).action ?? 'reply';
        } catch { /* ignore */ }
      }
      if (!newest || d.createdAt > newest.createdAt) newest = { createdAt: d.createdAt, action };
    }
    return newest ? { conversationId, action: newest.action } : undefined;
  }, [all, conversationId]);
}
