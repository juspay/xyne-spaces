import { useCallback, useEffect } from 'react';
import { useLocalSearchParams } from 'expo-router';
import { parseRepliesMd } from '@xyne/shared';

import { composerHtmlToPlainText } from '@/src/components/input-composer/utils/conversation-input.utils';
import { messageScopeParams } from '@/src/features/xyne-ai/model/askAIParams';
import { stateMachineActor } from '@/src/machines/stateMachine';

import { isAgentUserType } from '../model/agent';
import { markBubbleSeen, parkThread, unparkThread } from '../model/bubble-store';
import { bubbleFaceIds } from '../model/bubbles';
import { useBubbleScope } from './use-bubbles';

type ParkThreadSource = {
  channelId: string;
  threadId: string;
  /** "#payments-core", or the DM's name. */
  channelName: string;
  rootMessage: Parameters<typeof messageScopeParams>[0] | undefined;
  repliesMd: string | null | undefined;
  /** Leaves the thread once it is parked. */
  onBack: () => void;
};

/** Whether a workspace user is an agent, from the users the app already holds. */
function isAgentId(userId: string): boolean {
  const user = stateMachineActor.getSnapshot().context.users.find(entry => entry.id === userId);
  return isAgentUserType(user?.userType);
}

/**
 * The thread header's "−": parks the open thread as a bubble, from what the
 * header has already loaded, then leaves it. Opening a thread from the room
 * lets its bubble go; one opened from its bubble keeps it (hidden while the
 * card is up), so collapsing the card puts it back in the bubble it grew
 * out of, as a chat head does. A bubble is put down by dropping it on Close.
 */
export function useParkThread({
  channelId,
  threadId,
  channelName,
  rootMessage,
  repliesMd,
  onBack,
}: ParkThreadSource): () => void {
  const scope = useBubbleScope();
  const { surface, scopeType, bubble } = useLocalSearchParams<{
    surface?: string;
    scopeType?: string;
    bubble?: string;
  }>();
  const fromBubble = bubble === '1';

  useEffect(() => {
    if (fromBubble) markBubbleSeen(threadId);
    else unparkThread(threadId);
  }, [fromBubble, threadId]);

  return useCallback((): void => {
    if (scope !== null) {
      parkThread(scope, {
        channelId,
        threadId,
        title: rootMessage
          ? messageScopeParams(rootMessage, composerHtmlToPlainText).previewText
          : 'Thread',
        channelName,
        faceIds: bubbleFaceIds(
          rootMessage?.senderId,
          parseRepliesMd(repliesMd).repliers,
          isAgentId,
        ),
        surface,
        scopeType,
      });
    }
    onBack();
  }, [channelId, channelName, onBack, repliesMd, rootMessage, scope, scopeType, surface, threadId]);
}
