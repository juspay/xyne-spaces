import { useMemo } from 'react';
import { useSelector } from '@xstate/react';
import { queryCacheActor } from '../machines/queryCacheMachine';
export function useChannelRecentSenders(
  channelId: string | undefined,
  windowDays = 30,
): Set<string> {
  const conversations = useSelector(queryCacheActor, state =>
    channelId ? state.context.channelConversations[channelId] : undefined,
  );

  return useMemo(() => {
    const set = new Set<string>();
    if (!channelId || !conversations || conversations.length === 0) return set;

    const cutoff = Date.now() - windowDays * 86_400_000;
    for (const c of conversations) {
      const lastActivity = c.lastActivityAt ?? 0;
      const createdAt = c.createdAt ?? 0;
      if (lastActivity < cutoff && createdAt < cutoff) continue;
      if (c.createdBy) set.add(c.createdBy);
    }
    return set;
  }, [channelId, conversations, windowDays]);
}
