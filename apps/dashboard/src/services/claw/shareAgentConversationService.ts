import { ChannelScopeType } from '@xyne/shared';
import { apiInstance } from '../clients/apiClient';

export interface PreShareStatus {
  previouslyShared: boolean;
  lastSharedAt: string | null;
  hasNewSinceLastShare: boolean;
  agentInChannel: boolean;
  canAddAgent: boolean;
  agentInstalled: boolean;
  channelVisibility: string;
  channelScopeType: ChannelScopeType;
}

export interface AgentConversationPreviewTurn {
  role: string;
  name: string;
  userId: string | null;
  content: string;
}

export interface AgentConversationPreview {
  messageCount: number;
  turns: AgentConversationPreviewTurn[];
  previewTruncated: boolean;
  tipMessageId: string | null;
}

export interface ShareResult {
  conversationId: string;
  messageId: string;
  sharedMessageCount: number;
  agentAdded: boolean;
  reusedExisting: boolean;
}

export interface GetShareStatusParams {
  channelId: string;
  agentSlug: string;
  sourceConversationId: string;

  activePathTipMessageId?: string | null;
}

export interface ShareParams {
  channelId: string;
  agentSlug: string;
  sourceConversationId: string;

  addAgentConfirmed?: boolean;

  reShareConfirmed?: boolean;

  shareOperationId?: string;

  note?: string;
}

export type ShareErrorCode =
  | 'CHANNEL_NOT_FOUND'
  | 'NOT_A_CHANNEL_MEMBER'
  | 'INVALID_TARGET_CHANNEL'
  | 'CHANNEL_ARCHIVED'
  | 'RESHARE_CONFIRMATION_REQUIRED'
  | 'EMPTY_TRANSCRIPT'
  | 'TRANSCRIPT_TOO_LARGE'
  | 'NO_NEW_MESSAGES'
  | 'ADD_AGENT_FORBIDDEN'
  | 'AGENT_NOT_INSTALLED';

export interface ShareApiError {
  error: string;
  code?: ShareErrorCode;
}

export async function getShareAgentConversationStatus(
  params: GetShareStatusParams,
): Promise<PreShareStatus> {
  const { channelId, agentSlug, sourceConversationId, activePathTipMessageId } = params;
  const search = new URLSearchParams({ agentSlug, sourceConversationId });
  if (activePathTipMessageId) search.set('activePathTipMessageId', activePathTipMessageId);

  const { data } = await apiInstance.get<PreShareStatus>(
    `/channels/${encodeURIComponent(channelId)}/share-agent-conversation/status?${search.toString()}`,
  );
  return data;
}

export async function getAgentConversationPreview(params: {
  agentSlug: string;
  sourceConversationId: string;
}): Promise<AgentConversationPreview> {
  const search = new URLSearchParams({
    agentSlug: params.agentSlug,
    sourceConversationId: params.sourceConversationId,
  });
  const { data } = await apiInstance.get<AgentConversationPreview>(
    `/xyne-ai/agent-conversation-preview?${search.toString()}`,
  );
  return data;
}

export async function shareAgentConversationToChannel(params: ShareParams): Promise<ShareResult> {
  const {
    channelId,
    agentSlug,
    sourceConversationId,
    addAgentConfirmed,
    reShareConfirmed,
    shareOperationId,
    note,
  } = params;
  const { data } = await apiInstance.post<ShareResult>(
    `/channels/${encodeURIComponent(channelId)}/share-agent-conversation`,
    {
      agentSlug,
      sourceConversationId,
      addAgentConfirmed,
      reShareConfirmed,
      shareOperationId,
      note,
    },
  );
  return data;
}
