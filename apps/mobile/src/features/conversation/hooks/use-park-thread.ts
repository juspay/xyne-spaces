import { useCallback, useEffect } from 'react';
import { useLocalSearchParams } from 'expo-router';
import { parseRepliesMd } from '@xyne/shared';

import { composerHtmlToPlainText } from '@/src/components/input-composer/utils/conversation-input.utils';
import { messageScopeParams } from '@/src/features/xyne-ai/model/askAIParams';
import { stateMachineActor } from '@/src/machines/stateMachine';

import { isAgentUserType } from '../model/agent';
import { parkThread, unparkThread } from '../model/bubble-store';
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
 * The thread header's "−": parks the open thread as a bubble over the room,
 * from what the header has already loaded, then leaves it. An open thread is
 * never parked, so opening one (from its bubble or the room) lets it go.
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
  const { surface, scopeType } = useLocalSearchParams<{ surface?: string; scopeType?: string }>();

  useEffect(() => unparkThread(threadId), [threadId]);

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
