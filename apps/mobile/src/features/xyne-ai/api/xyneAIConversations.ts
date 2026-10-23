import { apiGet, apiRequest } from '@/src/services/apiClient';

import type { ToolInvocation } from './xyneAIEvents';
import type { AttachedContextItem } from './xyneAIRequest';
import type { Rating } from './xyneAIStream';

export interface ConversationSummary {
  rowId: string;
  conversationId: string;
  title: string;
  pinned?: boolean;
  lastMessageAt: string;
  /** The agent to open and continue the conversation with. */
  agentSlug: string;
  /** Every agent that answered, in first-use order; absent from older servers. */
  agentSlugs?: string[];
}

export interface ConversationPage {
  data: ConversationSummary[];
  nextCursor?: string | null;
}

export interface StoredAttachment {
  id: string;
  originalFilename: string;
  mimeType: string;
  width: number | null;
  height: number | null;
  metadata?: Record<string, unknown>;
}

export type ConversationRef = Pick<ConversationSummary, 'conversationId' | 'agentSlug'>;

export interface StoredMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  createdAt: string;
  /** The message this one answers or follows; absent on conversations stored before branching. */
  parentId?: string | null;
  parts?: unknown;
  followUpSuggestions?: string[];
  durationMs?: number;
  attachedContext?: AttachedContextItem[];
  attachments?: StoredAttachment[];
  /** Decoded defensively: the payload is not versioned. */
  pendingActions?: unknown[];
  /** Flow cards the answer carries; decoded defensively like `pendingActions`. */
  uiFlows?: unknown[];
}

export interface StoredConversation {
  data: StoredMessage[];
  invocationsByMsgId?: Record<string, ToolInvocation[]>;
  ratingByMsgId?: Record<string, { rating: Rating | null }>;
}

export type ConversationPatch = { title: string } | { pinned: boolean };

const conversationPath = (conversation: ConversationRef): string =>
  `/xyne-ai/v2/conversations/${encodeURIComponent(conversation.conversationId)}`;

const agentQuery = (conversation: ConversationRef): string =>
  `agentSlug=${encodeURIComponent(conversation.agentSlug)}`;

export const fetchConversations = (cursor: string | undefined): Promise<ConversationPage> =>
  apiGet(
    `/xyne-ai/v2/conversations?allAgents=1${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`,
  );

// scope=conversation returns every agent's turns, for a chat that switched agents.
export const fetchConversationMessages = (
  conversation: ConversationRef,
): Promise<StoredConversation> =>
  apiGet(
    `${conversationPath(conversation)}/messages?${agentQuery(conversation)}&scope=conversation`,
  );

export const updateConversation = (
  conversation: ConversationSummary,
  patch: ConversationPatch,
): Promise<unknown> =>
  apiRequest(`${conversationPath(conversation)}?${agentQuery(conversation)}`, {
    method: 'PATCH',
    body: patch,
  });

export const deleteConversation = (conversation: ConversationSummary): Promise<unknown> =>
  apiRequest(`${conversationPath(conversation)}?${agentQuery(conversation)}`, {
    method: 'DELETE',
  });
