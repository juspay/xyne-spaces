/**
 * Service layer for Ask AI session API calls.
 * All raw HTTP interactions live here; hooks import from this file.
 */

import { apiInstance } from '../clients/apiClient';
import type {
  ConversationHistory as ConversationHistoryType,
  StoredMessage,
} from '../../components/Chat/XyneAISidebar/utils/XyneAITypes';

interface SessionsResponse {
  sessions: SessionListItem[];
}

// ============================================================================
// API response types
// ============================================================================

export async function fetchSessionsByConversationId(
  conversationId: string,
): Promise<SessionListItem[]> {
  const response = await apiInstance.get<SessionsResponse>('/xyne-ai/sessions', {
    params: { conversationId },
  });
  return response.data.sessions;
}

export interface SessionListItem {
  sessionId: string;
  title: string;
  channelId: string;
  threadConversationId?: string;
  isStarred: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface SessionDetailMessage {
  id: string;
  type: 'user' | 'bot';
  content: string;
  timestamp: string;
  summarizerOutput?: {
    summary: string;
    keyPoints: Array<{ text: string; citations?: unknown[] }>;
  };
}

export interface BackendMessage {
  id: string;
  type: 'user' | 'bot';
  content: string;
  timestamp: string;
  parentId?: string | null;
  feedback?: 0 | 1 | 2;
  attachments?: Array<{ filename: string; mimeType: string; data: string }>;
  toolOutputs?: unknown[];
  parsedContent?: {
    summary: string;
    keypoints: string[];
    citations: Record<number, number>;
    isComplete: boolean;
  };
  messageIdMapping?: Record<string, string>;
  conversationIdMapping?: Record<string, string>;
  channelIdMapping?: Record<string, string>;
  userTags?: Record<string, { name: string; userId: string }>;
}

export interface SessionDetailResponse {
  id: string;
  sessionId: string;
  channelId: string;
  threadConversationId?: string;
  title: string;
  isStarred: boolean;
  branchSelections: Record<string, string>;
  createdAt: string;
  updatedAt: string;
  messages: BackendMessage[];
}

export type SessionMetadataPayload = {
  branchSelections?: Record<string, string>;
  feedbackMap?: Record<string, number>;
  title?: string;
};

// ============================================================================
// Data conversion
// ============================================================================

export function backendMessageToStoredMessage(msg: BackendMessage): StoredMessage {
  const result: StoredMessage = {
    id: msg.id,
    type: msg.type,
    content: msg.content,
    timestamp: new Date(msg.timestamp),
    parentId: msg.parentId ?? null,
  };

  if (msg.feedback !== undefined) result.feedback = msg.feedback;
  if (msg.attachments !== undefined) result.attachments = msg.attachments;
  if (msg.toolOutputs !== undefined) {
    result.toolOutputs = msg.toolOutputs as NonNullable<StoredMessage['toolOutputs']>;
  }
  if (msg.parsedContent !== undefined) result.parsedContent = msg.parsedContent;
  if (msg.messageIdMapping !== undefined) result.messageIdMapping = msg.messageIdMapping;
  if (msg.conversationIdMapping !== undefined)
    result.conversationIdMapping = msg.conversationIdMapping;
  if (msg.channelIdMapping !== undefined) result.channelIdMapping = msg.channelIdMapping;

  return result;
}

export function sessionDetailToConversationHistory(
  detail: SessionDetailResponse,
): ConversationHistoryType {
  const result: ConversationHistoryType = {
    id: detail.sessionId,
    channelId: detail.channelId,
    sessionId: detail.sessionId,
    title: detail.title,
    messages: detail.messages.map(backendMessageToStoredMessage),
    createdAt: new Date(detail.createdAt),
    lastUpdated: new Date(detail.updatedAt),
    isStarred: detail.isStarred,
  };

  if (detail.threadConversationId !== undefined)
    result.threadConversationId = detail.threadConversationId;
  if (detail.branchSelections !== undefined) result.branchSelections = detail.branchSelections;

  return result;
}

// ============================================================================
// API functions
// ============================================================================

export async function fetchSessions(): Promise<ConversationHistoryType[]> {
  const response = await apiInstance.get<{ sessions: SessionListItem[] }>('/xyne-ai/sessions');
  return response.data.sessions.map(s => {
    const history: ConversationHistoryType = {
      id: s.sessionId,
      channelId: s.channelId,
      sessionId: s.sessionId,
      title: s.title,
      messages: [],
      createdAt: new Date(s.createdAt),
      lastUpdated: new Date(s.updatedAt),
      isStarred: s.isStarred,
    };
    if (s.threadConversationId !== undefined) history.threadConversationId = s.threadConversationId;
    return history;
  });
}

export async function fetchSessionDetail(sessionId: string): Promise<SessionDetailResponse> {
  const response = await apiInstance.get<SessionDetailResponse>(`/xyne-ai/sessions/${sessionId}`);
  return response.data;
}

export async function toggleStarApi(sessionId: string): Promise<{ isStarred: boolean }> {
  const response = await apiInstance.patch<{ success: boolean; isStarred: boolean }>(
    `/xyne-ai/sessions/${sessionId}/star`,
  );
  return response.data;
}

export async function renameSessionApi(sessionId: string, title: string): Promise<void> {
  await apiInstance.patch(`/xyne-ai/sessions/${sessionId}/rename`, { title });
}

export async function deleteSessionApi(sessionId: string): Promise<void> {
  await apiInstance.delete(`/xyne-ai/sessions/${sessionId}`);
}

export async function updateSessionMetadataApi(
  sessionId: string,
  metadata: SessionMetadataPayload,
): Promise<void> {
  await apiInstance.patch(`/xyne-ai/sessions/${sessionId}/metadata`, metadata);
}
