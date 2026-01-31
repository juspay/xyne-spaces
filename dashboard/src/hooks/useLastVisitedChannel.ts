import { useSelector } from '@xstate/react';
import { stateMachineActor } from '../machines/stateMachine';

export function useLastVisitedChannel(): string | null {
  return useSelector(stateMachineActor, state => state.context.lastVisitedChannelId);
}

export function setLastVisitedChannel(channelId: string | null): void {
  stateMachineActor.send({ type: 'SET_LAST_VISITED_CHANNEL', channelId });
}
