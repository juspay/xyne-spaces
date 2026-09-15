
export type TwinDraftAction = 'react' | 'reply' | 'react_and_reply';

export interface TwinDraftCitation {
  toolCallId: string;
  citations: unknown[];
}

export interface TwinReplyDraft {
  conversationId: string;
  ownerUserId: string;
  channelId: string;

  action: TwinDraftAction;
  message?: string;
  emoji?: string;

  reasoning?: string;
  clawCitations?: TwinDraftCitation[];
  clawCitationIcons?: Record<string, string>;

  destinationKind: string; // origin_thread | origin_channel | dm_sender | dm | channel | thread
  destinationChannelId?: string;
  destinationConversationId?: string;
  destinationUserId?: string;
  destinationChannelName?: string;
  destinationUserName?: string;
  destinationReason?: string;

  sourceMessageId?: string;
  mentionedUserId: string;
  workspaceId: string;
  senderId?: string;
  senderName?: string;
  channelName?: string;
  incomingTask?: string;
  agentSlug?: string;
  spacesAppId?: string;
  sessionId: string;

  createdAt: number;
}

export function coerceTwinReplyDraft(
  body: unknown,
): { draft: TwinReplyDraft } | { error: string } {
  if (!body || typeof body !== 'object') return { error: 'body must be an object' };
  const b = body as Record<string, unknown>;
  const str = (k: string): string | undefined => (typeof b[k] === 'string' && (b[k] as string).length > 0 ? (b[k] as string) : undefined);

  const conversationId = str('conversationId');
  const ownerUserId = str('ownerUserId') ?? str('mentionedUserId');
  const channelId = str('channelId');
  const mentionedUserId = str('mentionedUserId') ?? ownerUserId;
  const workspaceId = str('workspaceId');
  const sessionId = str('sessionId');
  const action = b['action'];
  if (!conversationId) return { error: 'conversationId is required' };
  if (!ownerUserId) return { error: 'ownerUserId (or mentionedUserId) is required' };
  if (!channelId) return { error: 'channelId is required' };
  if (!workspaceId) return { error: 'workspaceId is required' };
  if (!sessionId) return { error: 'sessionId is required' };
  if (action !== 'react' && action !== 'reply' && action !== 'react_and_reply') {
    return { error: 'action must be react | reply | react_and_reply' };
  }

  const citations = Array.isArray(b['clawCitations']) ? (b['clawCitations'] as TwinDraftCitation[]) : undefined;
  const icons = b['clawCitationIcons'] && typeof b['clawCitationIcons'] === 'object'
    ? (b['clawCitationIcons'] as Record<string, string>)
    : undefined;

  const draft: TwinReplyDraft = {
    conversationId,
    ownerUserId,
    channelId,
    action,
    mentionedUserId: mentionedUserId!,
    workspaceId,
    sessionId,
    destinationKind: str('destinationKind') ?? 'origin_thread',
    createdAt: Date.now(),
    ...(str('message') !== undefined ? { message: str('message') } : {}),
    ...(str('emoji') !== undefined ? { emoji: str('emoji') } : {}),
    ...(str('reasoning') !== undefined ? { reasoning: str('reasoning') } : {}),
    ...(citations ? { clawCitations: citations } : {}),
    ...(icons ? { clawCitationIcons: icons } : {}),
    ...(str('destinationChannelId') !== undefined ? { destinationChannelId: str('destinationChannelId') } : {}),
    ...(str('destinationConversationId') !== undefined ? { destinationConversationId: str('destinationConversationId') } : {}),
    ...(str('destinationUserId') !== undefined ? { destinationUserId: str('destinationUserId') } : {}),
    ...(str('destinationChannelName') !== undefined ? { destinationChannelName: str('destinationChannelName') } : {}),
    ...(str('destinationUserName') !== undefined ? { destinationUserName: str('destinationUserName') } : {}),
    ...(str('destinationReason') !== undefined ? { destinationReason: str('destinationReason') } : {}),
    ...(str('sourceMessageId') !== undefined ? { sourceMessageId: str('sourceMessageId') } : {}),
    ...(str('senderId') !== undefined ? { senderId: str('senderId') } : {}),
    ...(str('senderName') !== undefined ? { senderName: str('senderName') } : {}),
    ...(str('channelName') !== undefined ? { channelName: str('channelName') } : {}),
    ...(str('incomingTask') !== undefined ? { incomingTask: str('incomingTask') } : {}),
    ...(str('agentSlug') !== undefined ? { agentSlug: str('agentSlug') } : {}),
    ...(str('spacesAppId') !== undefined ? { spacesAppId: str('spacesAppId') } : {}),
  };
  return { draft };
}

export function destinationNameLookup(
  d: Pick<TwinReplyDraft, 'destinationKind' | 'destinationChannelId' | 'destinationChannelName' | 'destinationUserId' | 'destinationUserName'>,
):
  | { field: 'destinationChannelName'; id: string }
  | { field: 'destinationUserName'; id: string }
  | null {
  if ((d.destinationKind === 'channel' || d.destinationKind === 'thread') && !d.destinationChannelName && d.destinationChannelId) {
    return { field: 'destinationChannelName', id: d.destinationChannelId };
  }
  if (d.destinationKind === 'dm' && !d.destinationUserName && d.destinationUserId) {
    return { field: 'destinationUserName', id: d.destinationUserId };
  }
  return null;
}
