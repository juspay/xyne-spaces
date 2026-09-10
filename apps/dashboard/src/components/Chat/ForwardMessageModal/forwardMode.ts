import { ChannelScopeType } from '@xyne/shared';
export type ForwardMode = 'message' | 'conversation';
export interface ForwardModeChannel {
  scopeType: ChannelScopeType;
  isArchived?: boolean | undefined;
}
export function canShareWholeConversation(
  sourceScopeType: ChannelScopeType | undefined,
  agentCount: number,
  sharingEnabled = true,
): boolean {
  return sharingEnabled && sourceScopeType === ChannelScopeType.DM && agentCount === 1;
}

export function isShareableTarget(channel: ForwardModeChannel): boolean {
  return (
    (channel.scopeType === ChannelScopeType.DEFAULT ||
      channel.scopeType === ChannelScopeType.GROUP_DM) &&
    channel.isArchived !== true
  );
}
export interface ConversationShareSubmission {
  channelId: string;
  agentSlug: string;
  sourceConversationId: string;
  addAgentConfirmed: boolean;
  reShareConfirmed: boolean;
  shareOperationId: string;
  note?: string;
}

export function buildConversationShareSubmission(
  channelId: string,
  agentSlug: string,
  sourceConversationId: string,
  addAgentConfirmed: boolean,
  reShareConfirmed: boolean,
  shareOperationId: string,
  note?: string,
): ConversationShareSubmission {
  return {
    channelId,
    agentSlug,
    sourceConversationId,
    addAgentConfirmed,
    reShareConfirmed,
    shareOperationId,
    ...(note?.trim() ? { note: note.trim() } : {}),
  };
}
