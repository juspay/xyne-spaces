import { useSelector } from '@xstate/react';
import { stateMachineActor } from '../machines/stateMachine';

export function useDraft(lookupId: string) {
  return useSelector(stateMachineActor, state => state.context.drafts[lookupId]);
}

export function saveDraft(lookupId: string, html: string, text: string): void {
  stateMachineActor.send({ type: 'SAVE_DRAFT', lookupId, html, text });
}

export function removeDraft(lookupId: string): void {
  stateMachineActor.send({ type: 'REMOVE_DRAFT', lookupId });
}
