import { useEffect } from 'react';
import { useLocalSearchParams, useRouter } from 'expo-router';

import { useQuery } from '@/src/hooks/useQuery';
import { queries } from '@/src/zero/queries';

/**
 * Dashboard `/support/{channelId}?conversationId=` lands on the desk, then
 * replaces itself with the ticket once that conversation's xyneId is known.
 */
export function useOpenDeskConversation(channelId: string): void {
  const router = useRouter();
  const {
    conversationId: conversationParam,
    messageId: messageParam,
    tab: tabParam,
  } = useLocalSearchParams<{
    conversationId?: string;
    messageId?: string;
    tab?: string;
  }>();
  const conversationId = typeof conversationParam === 'string' ? conversationParam.trim() : '';
  const messageId = typeof messageParam === 'string' ? messageParam.trim() : '';
  const tab =
    tabParam === 'messages' || tabParam === 'details' || tabParam === 'email' ? tabParam : '';
  const [conversation] = useQuery(
    queries.getConversationById({ conversationId: conversationId || '_' }),
    { enabled: Boolean(channelId && conversationId) },
  );

  useEffect(() => {
    const ticketUuid = conversation?.ticket?.id?.trim();
    const xyneId = conversation?.ticket?.xyneId?.trim();
    const pathId = xyneId || ticketUuid;
    if (!channelId || !conversationId || !pathId) return;
    router.replace({
      pathname: '/xyne-desks/[channelId]/[ticketId]',
      params: {
        channelId,
        ticketId: pathId,
        ...(ticketUuid ? { id: ticketUuid } : {}),
        ...(messageId ? { messageId } : {}),
        ...(tab ? { tab } : {}),
      },
    });
  }, [channelId, conversation, conversationId, messageId, router, tab]);
}
