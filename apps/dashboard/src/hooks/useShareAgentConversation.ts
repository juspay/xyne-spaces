import { useMutation, useQuery, type UseQueryResult } from '@tanstack/react-query';
import {
  getAgentConversationPreview,
  getShareAgentConversationStatus,
  shareAgentConversationToChannel,
  type AgentConversationPreview,
  type PreShareStatus,
  type ShareParams,
  type ShareResult,
} from '../services/claw/shareAgentConversationService';

export const useShareAgentConversationStatus = (args: {
  channelId: string | undefined;
  agentSlug: string | undefined;
  sourceConversationId: string | undefined;
  activePathTipMessageId?: string | null | undefined;
}): UseQueryResult<PreShareStatus, Error> => {
  const { channelId, agentSlug, sourceConversationId, activePathTipMessageId } = args;
  return useQuery({
    queryKey: [
      'share-agent-conversation-status',
      channelId,
      agentSlug,
      sourceConversationId,
      activePathTipMessageId ?? null,
    ],
    queryFn: () =>
      getShareAgentConversationStatus({
        channelId: channelId!,
        agentSlug: agentSlug!,
        sourceConversationId: sourceConversationId!,
        activePathTipMessageId: activePathTipMessageId ?? null,
      }),
    enabled: !!channelId && !!agentSlug && !!sourceConversationId,
    staleTime: 5 * 1000,
  });
};

export const useAgentConversationPreview = (args: {
  agentSlug: string | undefined;
  sourceConversationId: string | undefined;
  enabled: boolean;
}): UseQueryResult<AgentConversationPreview, Error> => {
  const { agentSlug, sourceConversationId, enabled } = args;
  return useQuery({
    queryKey: ['agent-conversation-preview', agentSlug, sourceConversationId],
    queryFn: () =>
      getAgentConversationPreview({
        agentSlug: agentSlug!,
        sourceConversationId: sourceConversationId!,
      }),
    enabled: enabled && !!agentSlug && !!sourceConversationId,
    staleTime: 5 * 1000,
  });
};

export const useShareAgentConversation = () =>
  useMutation<ShareResult, Error, ShareParams>({
    mutationFn: params => shareAgentConversationToChannel(params),
  });
