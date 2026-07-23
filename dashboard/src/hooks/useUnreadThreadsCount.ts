import { useMemo } from 'react';
import { useSelector } from '@xstate/react';
import { ActivityClassification } from '@xyne/shared';
import { stateMachineActor } from '../machines/stateMachine';

type ThreadActivity = {
  actorAction: string;
  conversationId?: string | null;
  classification?: ActivityClassification | null;
  isThreadActivity?: boolean | null;
};

export type ThreadSidebarState = {
  mentionCount: number;
  hasUnreadThreads: boolean;
  unreadThreadConversationIds: ReadonlySet<string>;
};

const THREAD_REPLY_ACTIONS = new Set(['replied', 'replied_v2']);
const THREAD_MENTION_ACTIONS = new Set(['mentioned_user', 'group_mention']);

export const deriveThreadSidebarState = (
  unreadActivities: readonly ThreadActivity[] | null | undefined,
): ThreadSidebarState => {
  let mentionCount = 0;
  let hasUnreadThreads = false;
  const unreadThreadConversationIds = new Set<string>();

  for (const activity of unreadActivities ?? []) {
    if (activity.classification === ActivityClassification.SKIP) continue;

    const isThreadReply = THREAD_REPLY_ACTIONS.has(activity.actorAction);
    const isThreadMention =
      activity.isThreadActivity === true && THREAD_MENTION_ACTIONS.has(activity.actorAction);

    if (isThreadMention && activity.actorAction === 'mentioned_user') {
      mentionCount += 1;
    }

    if (isThreadReply || isThreadMention) {
      hasUnreadThreads = true;
      if (activity.conversationId) {
        unreadThreadConversationIds.add(activity.conversationId);
      }
    }
  }

  return { mentionCount, hasUnreadThreads, unreadThreadConversationIds };
};

export const useThreadSidebarState = (): ThreadSidebarState => {
  const unreadActivities = useSelector(stateMachineActor, state => state.context.unreadActivities);

  return useMemo(() => deriveThreadSidebarState(unreadActivities), [unreadActivities]);
};

export const useUnreadThreadsCount = (): number => useThreadSidebarState().mentionCount;

export const useUnreadThreadConversationIds = (): ReadonlySet<string> =>
  useThreadSidebarState().unreadThreadConversationIds;
