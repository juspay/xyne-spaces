import { useMemo } from 'react';
import { useSelector } from '@xstate/react';
import { DelayedMessageStatus } from '@xyne/shared';
import { stateMachineActor } from '../machines/stateMachine';

export function useUserDelayedMessages() {
  return useSelector(stateMachineActor, state => state.context.delayedMessages);
}

export function usePendingDelayedMessagesCount(): number {
  const delayedMessages = useUserDelayedMessages();
  return useMemo(
    () => delayedMessages.filter(message => message.status === DelayedMessageStatus.PENDING).length,
    [delayedMessages],
  );
}

export function useUpcomingDelayedMessage(
  channelId: string,
  conversationId: string | null,
): number | null {
  const delayedMessages = useUserDelayedMessages();

  return useMemo(() => {
    const now = Date.now();
    const inContext = delayedMessages.filter(message => {
      if (message.channelId !== channelId) return false;
      if ((message.conversationId ?? null) !== conversationId) return false;
      if (message.status !== DelayedMessageStatus.PENDING) return false;
      return true;
    });
    if (inContext.length === 0) return null;

    const future = inContext
      .filter(message => message.scheduledFor >= now)
      .sort((a, b) => a.scheduledFor - b.scheduledFor);
    if (future.length > 0) return future[0]?.scheduledFor ?? null;

    return [...inContext].sort((a, b) => a.scheduledFor - b.scheduledFor)[0]?.scheduledFor ?? null;
  }, [delayedMessages, channelId, conversationId]);
}
