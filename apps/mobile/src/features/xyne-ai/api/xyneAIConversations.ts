import { apiGet, apiRequest } from '@/src/services/apiClient';

import type { ToolInvocation } from './xyneAIEvents';
import type { AttachedContextItem } from './xyneAIRequest';
import type { Rating } from './xyneAIStream';

export interface ConversationSummary {
  /** Unique per list row; a chat that switched agents is one row. */
  rowId: string;
  conversationId: string;
  title: string;
  pinned?: boolean;
  lastMessageAt: string;
  /** The agent to continue the conversation with. */
  agentSlug: string;
}

export interface ConversationPage {
  data: ConversationSummary[];
  nextCursor?: string | null;
}

export interface StoredMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  createdAt: string;
  parts?: unknown;
  followUpSuggestions?: string[];
  durationMs?: number;
  attachedContext?: AttachedContextItem[];
}

export interface StoredConversation {
  data: StoredMessage[];
  invocationsByMsgId?: Record<string, ToolInvocation[]>;
  ratingByMsgId?: Record<string, { rating: Rating | null }>;
}

export type ConversationPatch = { title: string } | { pinned: boolean };

const conversationPath = (conversation: ConversationSummary): string =>
  `/xyne-ai/v2/conversations/${encodeURIComponent(conversation.conversationId)}`;

const agentQuery = (conversation: ConversationSummary): string =>
  `agentSlug=${encodeURIComponent(conversation.agentSlug)}`;

export const fetchConversations = (cursor: string | undefined): Promise<ConversationPage> =>
  apiGet(
    `/xyne-ai/v2/conversations?allAgents=1${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`,
  );

// scope=conversation returns every agent's turns, for a chat that switched agents.
export const fetchConversationMessages = (
  conversation: ConversationSummary,
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
