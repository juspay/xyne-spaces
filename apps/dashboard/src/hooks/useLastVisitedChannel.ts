import { useSelector } from '@xstate/react';
import { stateMachineActor } from '../machines/stateMachine';

export function useLastVisitedChannel(workspaceId: string): string | null {
  return useSelector(
    stateMachineActor,
    state => state.context.lastVisitedChannelIds[workspaceId] ?? null,
  );
}

export function setLastVisitedChannel(channelId: string | null, workspaceId: string): void {
  stateMachineActor.send({ type: 'SET_LAST_VISITED_CHANNEL', channelId, workspaceId });
}
