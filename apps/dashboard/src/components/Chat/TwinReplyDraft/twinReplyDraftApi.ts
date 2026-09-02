import { apiInstance } from '../../../services/clients/apiClient';
import type { ToolInvocation } from '../XyneAISidebar/utils/XyneAITypes';

export type TwinDraftAction = 'react' | 'reply' | 'react_and_reply';

export interface TwinDraftClawCitation {
  toolCallId: string;
  citations: ToolInvocation['citations'];
}

export interface TwinReplyDraftView {
  id: string;
  conversationId: string;
  action: TwinDraftAction;
  message?: string;
  emoji?: string;
  reasoning?: string;
  clawCitations?: TwinDraftClawCitation[];
  clawCitationIcons?: Record<string, string>;
  destinationKind: string;
  destinationChannelName?: string;
  destinationUserName?: string;
  destinationReason?: string;
  sourceMessageId?: string;
  /** Who the twin is replying to. Resolves their real profile picture. */
  senderId?: string;
  senderName?: string;
  channelName?: string;
  agentSlug?: string;
  sessionId?: string;
  createdAt: number;
}

type StoredTwinDraft = Omit<TwinReplyDraftView, 'id'> & Record<string, unknown>;

export interface TwinDraftRow {
  id: string;
  conversationId?: string | null;
  createdAt: number;
  metadata?: unknown;
}

function parseStoredTwinDraft(metadata: unknown): StoredTwinDraft | null {
  if (!metadata) return null;
  if (typeof metadata === 'string') {
    try {
      return JSON.parse(metadata) as StoredTwinDraft;
    } catch {
      return null;
    }
  }
  return metadata as StoredTwinDraft;
}

export function rowToTwinReplyDraftView(row: TwinDraftRow): TwinReplyDraftView | null {
  const meta = parseStoredTwinDraft(row.metadata);
  if (!meta) return null;
  return {
    ...meta,
    id: row.id,
    conversationId: row.conversationId ?? meta.conversationId,
    createdAt: typeof meta.createdAt === 'number' ? meta.createdAt : row.createdAt,
  };
}

export interface PostedTarget {
  channelId: string;
  conversationId?: string;
}

export interface TwinEditSession {
  draftId: string;
  message: string;
  senderName?: string;
  onApprove: (editedText: string) => void;
}

export async function approveTwinReplyDraft(
  draftId: string,
  editedMessage?: string,
): Promise<PostedTarget | null> {
  const res = await apiInstance.post<{ success: boolean; posted?: PostedTarget }>(
    `/conversations/reply-drafts/${draftId}/approve`,
    { ...(editedMessage !== undefined ? { editedMessage } : {}) },
  );
  return res.data?.posted ?? null;
}

export async function declineTwinReplyDraft(draftId: string): Promise<void> {
  await apiInstance.post(`/conversations/reply-drafts/${draftId}/decline`, {});
}
