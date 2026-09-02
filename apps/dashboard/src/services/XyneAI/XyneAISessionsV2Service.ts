/**
 * Service layer for Ask AI v2 session API calls (xyne-claw backed).
 * Proxies through the Spaces backend to xyne-claw-auth conversation APIs.
 */

import { apiInstance } from '../clients/apiClient';
import type {
  ConversationHistory as ConversationHistoryType,
  Message,
  PendingAction,
  ToolInvocation,
  DebugArtifactBundle,
  ReactArtifactManifest,
} from '../../components/Chat/XyneAISidebar/utils/XyneAITypes';
import { registerClawIcons } from '../../components/Chat/XyneAISidebar/utils/clawCitationUrl';
import { getPendingActionId, getStoredPendingActionResolution } from './XyneAIPendingActionStore';

// ============================================================================
// Claw API response types
// ============================================================================

interface ClawConversationSummary {
  conversationId: string;
  title: string;
  messageCount: number;
  lastMessageAt: string;
}

interface ClawConversationListResponse {
  success: boolean;
  data: ClawConversationSummary[];
}

interface ClawChatMessage {
  id: string;
  conversationId: string;
  agentSlug: string;
  userId: string;
  role: 'user' | 'assistant';
  content: string;
  status: string;
  createdAt: string;
  /** Tree parent — set by claw-auth's branching path. Null/undefined on
   *  legacy rows written before branching landed; we fall back to
   *  chronological order in that case. */
  parentId?: string | null;
  reasoning?: string;
  pendingActions?: PendingAction[];
  followUpSuggestions?: string[];
  attachments?: Array<{
    id: string;
    mimeType: string;
    originalFilename: string;
    width: number | null;
    height: number | null;
    /** Allowlisted by claw-auth's serializer — currently only `reactArtifact`. */
    metadata?: { reactArtifact?: ReactArtifactManifest };
  }>;
}

interface ClawMessagesResponse {
  success: boolean;
  data: ClawChatMessage[];
  toolInvocations?: unknown[];
  invocationsByMsgId?: Record<string, unknown[]>;
  /** De-duplicated brand-icon registry: `iconKey` → inline `data:` SVG URI.
   *  Each unique icon ships once here instead of being repeated on every
   *  citation; chips resolve it via `resolveCitationIconUrl`. */
  icons?: Record<string, string>;
  /** assistantMsgId → AgentRun.sessionId, for branching-safe debugger pairing. */
  runByMsgId?: Record<string, string>;
  /** assistantMsgId → { rating, comment } for the run that produced it. Seeds
   *  the 👍/👎 thumb state on reload (ratings persist to agent_runs.rating). */
  ratingByMsgId?: Record<string, { rating: 'up' | 'down' | null; comment: string | null }>;
}

// ============================================================================
// API functions
// ============================================================================

/**
 * Fetch all conversations for the current user from claw.
 * Maps claw format to the existing ConversationHistoryType.
 * @param agentSlug - Optional agent slug to filter conversations per-agent.
 */
export async function fetchV2Conversations(
  agentSlug?: string | null,
  options: { allRuns?: boolean } = {},
): Promise<ConversationHistoryType[]> {
  const effectiveAgentSlug = agentSlug ?? 'ask-ai';
  const params = new URLSearchParams({ agentSlug: effectiveAgentSlug });
  if (options.allRuns) params.set('allRuns', '1');
  const url = `/xyne-ai/v2/conversations?${params.toString()}`;
  const response = await apiInstance.get<ClawConversationListResponse>(url);

  if (!response.data.success || !response.data.data) {
    return [];
  }

  return response.data.data.map(conv => ({
    id: conv.conversationId,
    sessionId: conv.conversationId,
    title: conv.title || 'New Chat',
    channelId: '',
    isStarred: false,
    lastUpdated: new Date(conv.lastMessageAt),
    createdAt: new Date(conv.lastMessageAt),
    messages: [],
  }));
}

/**
 * Fetch messages for a specific conversation from claw.
 * Maps claw message format to the frontend Message type.
 * @param agentSlug - Optional agent slug to fetch messages for a specific agent.
 */
export async function fetchV2ConversationMessages(
  conversationId: string,
  agentSlug?: string | null,
  urlOverride?: string,
  options: { allRuns?: boolean } = {},
): Promise<Message[]> {
  const effectiveAgentSlug = agentSlug ?? 'ask-ai';
  const params = new URLSearchParams({ agentSlug: effectiveAgentSlug });
  if (options.allRuns) params.set('allRuns', '1');
  const url =
    urlOverride ?? `/xyne-ai/v2/conversations/${conversationId}/messages?${params.toString()}`;
  const response = await apiInstance.get<ClawMessagesResponse>(url);

  if (!response.data.success || !response.data.data) {
    return [];
  }

  const allToolInvocations = (response.data.toolInvocations || []) as Array<{
    toolName: string;
    args: Record<string, unknown>;
    result?: string;
    status: 'running' | 'completed' | 'error';
    durationMs: number;
    toolCallId?: string;
    startedAt?: string;
    isError?: boolean;
    citations?: ToolInvocation['citations'];
    parentToolCallId?: string;
    subagentName?: string;
  }>;

  // Map tool invocations from the response onto assistant messages.
  // The claw-auth messages endpoint returns invocationsByMsgId — a
  // Record<assistantMessageId, ToolInvocation[]> that pairs tool calls
  // with the assistant response they produced (by chronological order).
  // When that mapping is absent we fall back to the old time-window heuristic.

  // Pair tool invocations with the assistant message they produced.
  // The claw-auth /messages endpoint returns invocationsByMsgId — a
  // Record<assistantMessageId, ToolInvocation[]> — when available.
  // Otherwise we fall back to time-window heuristics.
  const invocationsByMsgId =
    (response.data.invocationsByMsgId as Record<string, ToolInvocation[]> | undefined) || undefined;

  // Stash the payload's de-duplicated icon bytes before mapping messages, so
  // citation chips (which carry only `iconKey`) can resolve their brand icon.
  registerClawIcons(response.data.icons);

  const runByMsgId = response.data.runByMsgId || undefined;
  const ratingByMsgId = response.data.ratingByMsgId || undefined;

  // Backend now writes parentId on every chat_messages row (branching tree).
  // Check whether ANY row in this conversation has a non-null parentId — if
  // so, we trust the backend's tree fully. Otherwise the conversation is
  // legacy (pre-branching) and we fall back to chronological pairing so the
  // existing UI's branch-disabled gate (every message has parentId=null)
  // continues to work and old threads still render.
  const hasBackendParentId = response.data.data.some(
    m => typeof m.parentId === 'string' && m.parentId.length > 0,
  );

  const mappedMessages = response.data.data.map((msg, index, arr) => {
    const isUser = msg.role === 'user';

    // Branching: prefer the backend's parentId — chronological order does
    // NOT match tree order once a user has multiple assistant siblings.
    // Legacy fallback keeps unmigrated conversations rendering as a list.
    const parentId = hasBackendParentId
      ? (msg.parentId ?? null)
      : index > 0
        ? arr[index - 1]!.id
        : null;

    // For assistant messages, find tool invocations that were started just before this message was created
    // Tool invocations should be associated with the assistant response they helped generate
    let msgToolInvocations: ToolInvocation[] = [];
    if (!isUser) {
      if (invocationsByMsgId && msg.id in invocationsByMsgId) {
        // claw-auth already paired them for us
        msgToolInvocations = (invocationsByMsgId[msg.id] ?? []).map(inv => ({
          toolName: inv.toolName,
          args: inv.args,
          status: inv.status,
          durationMs: inv.durationMs,
          toolCallId: inv.toolCallId ?? `call-${Math.random().toString(36).slice(2)}`,
          ...(inv.result !== undefined && { result: inv.result }),
          ...(inv.isError !== undefined && { isError: inv.isError }),
          ...(inv.citations !== undefined && { citations: inv.citations }),
          ...(inv.parentToolCallId !== undefined && { parentToolCallId: inv.parentToolCallId }),
          ...(inv.subagentName !== undefined && { subagentName: inv.subagentName }),
        }));
      } else if (allToolInvocations.length > 0) {
        const msgCreatedAt = new Date(msg.createdAt).getTime();

        // Find tool invocations that were started before this message was created
        // and after the previous user message (if any)
        const prevUserMsg = arr
          .slice(0, index)
          .reverse()
          .find(m => m.role === 'user');
        const prevUserTime = prevUserMsg ? new Date(prevUserMsg.createdAt).getTime() : 0;

        msgToolInvocations = allToolInvocations
          .filter(inv => {
            const toolStartedAt = inv.startedAt ? new Date(inv.startedAt).getTime() : 0;
            // Tool was started after the previous user message and before this assistant message
            return toolStartedAt > prevUserTime && toolStartedAt <= msgCreatedAt;
          })
          .map(inv => {
            const baseInvocation: ToolInvocation = {
              toolName: inv.toolName,
              args: inv.args,
              status: inv.status,
              durationMs: inv.durationMs,
              toolCallId: inv.toolCallId ?? `call-${Math.random().toString(36).slice(2)}`,
            };

            // Only add optional properties if they exist
            if (inv.result !== undefined) baseInvocation.result = inv.result;
            if (inv.isError !== undefined) baseInvocation.isError = inv.isError;
            if (inv.citations !== undefined) baseInvocation.citations = inv.citations;
            if (inv.parentToolCallId !== undefined)
              baseInvocation.parentToolCallId = inv.parentToolCallId;
            if (inv.subagentName !== undefined) baseInvocation.subagentName = inv.subagentName;

            return baseInvocation;
          });
      }
    }

    const pendingActions = (msg.pendingActions ?? []).map((action, actionIndex) => {
      const actionId = getPendingActionId(conversationId, msg.id, action, actionIndex);
      const resolution = action.resolution ?? getStoredPendingActionResolution(actionId);
      return { ...action, id: actionId, ...(resolution && { resolution }) };
    });

    const mappedMessage: Message = {
      id: msg.id,
      type: isUser ? ('user' as const) : ('bot' as const),
      content: msg.content,
      timestamp: new Date(msg.createdAt),
      isStreaming: false,
      streamingContent: '',
      sessionId: conversationId,
      parentId,
      toolOutputs: [],
      toolInvocations: msgToolInvocations,
      pendingActions,
      ...(!isUser && msg.followUpSuggestions?.length
        ? { followUpSuggestions: msg.followUpSuggestions }
        : {}),
      ...(!isUser && runByMsgId?.[msg.id] ? { debugSessionId: runByMsgId[msg.id] } : {}),
      // Seed 👍/👎 thumb state from the run's persisted rating (up→1, down→2).
      ...(!isUser && ratingByMsgId?.[msg.id]?.rating
        ? {
            feedback: (ratingByMsgId[msg.id]!.rating === 'up' ? 1 : 2) as 0 | 1 | 2,
            ratingComment: ratingByMsgId[msg.id]!.comment,
          }
        : {}),
    };

    // Map attachments from claw format to frontend format
    if (msg.attachments && msg.attachments.length > 0) {
      mappedMessage.attachments = msg.attachments.map(att => ({
        id: att.id,
        originalFilename: att.originalFilename,
        mimeType: att.mimeType,
        width: att.width,
        height: att.height,
        // Carries the React-artifact manifest so a reloaded thread can render
        // the artifact card without re-fetching per attachment.
        ...(att.metadata?.reactArtifact
          ? { metadata: { reactArtifact: att.metadata.reactArtifact } }
          : {}),
      }));
    }

    // Map reasoning content from claw format
    if (msg.reasoning && msg.reasoning.length > 0) {
      mappedMessage.reasoning = msg.reasoning;
    }

    return mappedMessage;
  });

  return mappedMessages;
}

/**
 * Delete a v2 conversation from claw. The backend proxies the call through to
 * claw-auth; both the v2 sessions cache and the per-conversation messages
 * cache should be invalidated by the caller afterwards.
 */
export async function deleteV2Conversation(
  conversationId: string,
  agentSlug?: string | null,
): Promise<void> {
  const query = `?agentSlug=${encodeURIComponent(agentSlug ?? 'ask-ai')}`;
  await apiInstance.delete(
    `/xyne-ai/v2/conversations/${encodeURIComponent(conversationId)}${query}`,
  );
}

/**
 * Persist a 👍/👎 (+ optional comment) for the AgentRun that produced an
 * assistant message. `messageId` is the assistant ChatMessage id — known the
 * instant a turn completes, so the control never has to wait on a /messages
 * refetch. The backend proxies to claw-auth's
 * POST /runs/by-message/:chatMessageId/rate → agent_runs.rating, so the signal
 * shows in the claw metrics SentimentPanel and survives reload.
 */
export async function rateV2Message(
  messageId: string,
  rating: 'up' | 'down',
  comment?: string | null,
): Promise<void> {
  await apiInstance.post(`/xyne-ai/v2/messages/${encodeURIComponent(messageId)}/rate`, {
    rating,
    ...(typeof comment === 'string' ? { comment } : {}),
  });
}

export async function fetchV2DebugArtifacts(
  conversationId: string,
  agentSlug?: string | null,
): Promise<DebugArtifactBundle> {
  const query = agentSlug ? `?agentSlug=${encodeURIComponent(agentSlug)}` : '';
  const response = await apiInstance.get<{ success: boolean; data: DebugArtifactBundle }>(
    `/xyne-ai/v2/conversations/${encodeURIComponent(conversationId)}/debug${query}`,
  );
  if (!response.data.success) throw new Error('Failed to fetch debug artifacts');
  return response.data.data;
}

/** URL for a desk auto-draft's transcript, proxied by Spaces as the desk
 *  persona after checking channel membership. Same body shape as the v2
 *  messages endpoint. */
export function deskAutoDraftMessagesUrl(conversationId: string, channelId: string): string {
  return `/email/${encodeURIComponent(conversationId)}/autodraft-transcript?channelId=${encodeURIComponent(channelId)}`;
}

/** Fork a desk auto-draft into a conversation owned by the current user, so
 *  their first message continues the run privately instead of writing into the
 *  persona's chat. Returns the new conversation id. */
export async function forkDeskAutoDraft(
  conversationId: string,
  channelId: string,
): Promise<{ conversationId: string; agentSlug: string }> {
  const response = await apiInstance.post<{ conversationId: string; agentSlug: string }>(
    `/email/${encodeURIComponent(conversationId)}/autodraft-continue`,
    { channelId },
  );
  return response.data;
}
