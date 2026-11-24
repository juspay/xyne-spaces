import { memo, useEffect } from 'react';

import { useAgentProgress } from '@/src/hooks/useAgentProgress';

import { reportBubbleAgents } from '../../model/bubble-store';

type BubbleAgentWatchProps = {
  channelId: string;
  threadId: string;
};

/**
 * Follows one parked thread's agents through the progress feed the thread's
 * typing bar already reads (its rehydrate call and the socket), and reports
 * them to the bubbles: working while any runs, answered when they finish.
 * Draws nothing.
 */
export const BubbleAgentWatch = memo(function BubbleAgentWatch({
  channelId,
  threadId,
}: BubbleAgentWatchProps): null {
  const { agents } = useAgentProgress(threadId, channelId);
  const running = agents.length > 0;
  const agentKey = agents
    .map(agent => agent.agentUserId)
    .filter((id): id is string => !!id)
    .join(',');
  const agentName = agents.find(agent => agent.agentName)?.agentName ?? null;

  useEffect(() => {
    // Keyed by the agents, so a new tool label on the same run is not a change.
    reportBubbleAgents(
      threadId,
      running ? { agentIds: agentKey ? agentKey.split(',') : [], agentName } : null,
    );
  }, [agentKey, agentName, running, threadId]);

  return null;
});
