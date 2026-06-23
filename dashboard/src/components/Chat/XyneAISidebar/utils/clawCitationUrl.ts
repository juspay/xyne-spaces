/**
 * URL + label builders for `ClawCitation` objects emitted by xyne-claw tools.
 * Lives outside ToolInvocationList so MessageItem can reuse it for inline
 * `[clf-<toolCallId>#<chunkIndex>]` token rendering — the chip and the
 * bottom-of-card citation list must produce identical links.
 */
import { isDeskChannelType } from '@xyne/shared';
import type { ClawCitation, ToolInvocation } from './XyneAITypes';

/**
 * Build the Support view URL for a desk-typed ticket citation. Mirrors the
 * pattern in `navigateToTicket` + `navigateToMail` (utils/searchNavigation.ts)
 * so a citation chip and a search result land on the same screen for the
 * same ticket.
 */
function buildSupportUrl(
  channelId: string,
  xyneId: string,
  conversationId?: string,
  ticketId?: string,
  mailId?: string,
): string {
  const params = new URLSearchParams();
  if (conversationId) params.set('conversationId', conversationId);
  if (ticketId) params.set('ticketId', ticketId);
  if (mailId) params.set('mail', mailId);
  const qs = params.toString();
  const base = `/support/${channelId}/${xyneId}`;
  return qs ? `${base}?${qs}` : base;
}

export function buildClawCitationUrl(citation: ClawCitation): string | null {
  if (citation.kind === 'external' && citation.url) {
    return citation.url;
  }

  // Desk-typed thread/ticket citations (EMAIL/SLACK channel) route to the
  // Support view rather than the chat thread panel. `xyneId` is required —
  // it's the path segment SupportScreen reads. Falls through to the regular
  // chat-view URLs when xyneId is missing.
  const isDesk = isDeskChannelType(citation.channelKind);
  if (
    (citation.kind === 'thread' || citation.kind === 'ticket') &&
    isDesk &&
    citation.channelId &&
    citation.xyneId
  ) {
    return buildSupportUrl(
      citation.channelId,
      citation.xyneId,
      citation.conversationId,
      citation.ticketId,
      citation.mailId,
    );
  }

  if (citation.kind === 'thread' && citation.channelId) {
    if (citation.conversationId) {
      // Hash fragment opens the thread side panel in Spaces — matches the v1 format.
      // When the backend pinpoints a specific message (spaces-messages,
      // spaces-message-detail, spaces-activity), append `&messageId=<id>` so
      // the thread scrolls to that reply and highlights it instead of the
      // top of the conversation. Mirrors `navigateToMessage`.
      const base = `/chat/dir/${citation.channelId}/${citation.conversationId}#origin=${citation.conversationId}`;
      return citation.messageId ? `${base}&messageId=${citation.messageId}` : base;
    }
    // Channel-level citation (e.g. spaces-channels result) — link to the
    // channel without pinning a specific thread.
    return `/chat/dir/${citation.channelId}`;
  }

  if (citation.kind === 'canvas' && citation.viewAccessId) {
    return `/chat/canvas/${citation.viewAccessId}`;
  }

  if (
    citation.kind === 'ticket' &&
    citation.ticketId &&
    citation.channelId &&
    citation.conversationId
  ) {
    return `/chat/dir/${citation.channelId}/${citation.conversationId}/${citation.ticketId}?selectedTab=thread`;
  }

  return null;
}

export function getClawCitationLabel(citation: ClawCitation): string {
  if (citation.label) return citation.label;
  if (citation.kind === 'thread') {
    return citation.channelName ? `Thread in #${citation.channelName}` : 'Spaces thread';
  }
  if (citation.kind === 'canvas') return 'Canvas';
  if (citation.kind === 'ticket') return `Ticket ${citation.ticketId || ''}`.trim();
  if (citation.kind === 'external') return 'Source link';
  return 'Reference';
}

/**
 * Resolve a `[clf-<toolCallId>#<chunkIndex>]` token to the structured citation
 * carried on the matching `ToolInvocation.citations` array. Returns null if
 * the invocation isn't found or no citation matches the chunkIndex.
 */
export function findCitationForChunk(
  toolInvocations: ToolInvocation[] | undefined,
  toolCallId: string,
  chunkIndex: number,
): ClawCitation | null {
  if (!toolInvocations || toolInvocations.length === 0) return null;
  const invocation = toolInvocations.find(t => t.toolCallId === toolCallId);
  if (!invocation || !invocation.citations) return null;
  const exact = invocation.citations.find(c => c.chunkIndex === chunkIndex);
  if (exact) return exact;
  // Fallback: when the backend pushed only one citation for the whole tool
  // call (older tools, or single-resource tools like spaces-message-detail),
  // re-use it for every chunk so the chip is still clickable.
  return invocation.citations[0] ?? null;
}
