import { useEffect } from 'react';
import { xyneAIActor, ThreadInfo } from '../machines/xyneAIMachine';

interface UseAskAiTicketContextArgs {
  channelId: string | null | undefined;
  conversationId: string | null | undefined;
  previewText?: string;
  attachmentIds?: string[];
}

/**
 * Tells the global Ask AI sidebar which ticket the user is currently viewing.
 *
 * Call once near the top of any component that owns "the active ticket"
 * (today: SupportScreen). The hook fires SET_TICKET_CONTEXT on mount and on
 * channelId/conversationId change, and CLEAR_TICKET_CONTEXT on unmount.
 *
 * Effect: the global XyneAISidebar (mounted in AppRoot) reads channelId +
 * threadInfo from xyneAIActor state and shows the matching session — so the
 * one global sidebar is always pointed at the right ticket without needing
 * to be opened or having a separate panel.
 *
 * No-op until both channelId and conversationId are present.
 */
export function useAskAiTicketContext({
  channelId,
  conversationId,
  previewText,
  attachmentIds,
}: UseAskAiTicketContextArgs): void {
  useEffect(() => {
    if (!channelId || !conversationId) {
      return undefined;
    }

    const threadInfo: ThreadInfo = {
      conversationId,
      previewText: previewText ?? '',
      ...(attachmentIds && attachmentIds.length > 0 && { attachmentIds }),
    };

    xyneAIActor.send({ type: 'SET_TICKET_CONTEXT', channelId, threadInfo });

    return () => {
      xyneAIActor.send({ type: 'CLEAR_TICKET_CONTEXT' });
    };
  }, [channelId, conversationId, previewText]);
}
