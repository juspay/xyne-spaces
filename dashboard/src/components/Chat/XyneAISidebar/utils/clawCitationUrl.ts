/**
 * URL + label builders for `ClawCitation` objects emitted by xyne-claw tools.
 * Lives outside ToolInvocationList so MessageItem can reuse it for inline
 * `[clf-<toolCallId>#<chunkIndex>]` token rendering — the chip and the
 * bottom-of-card citation list must produce identical links.
 */
import type { ClawCitation, ToolInvocation } from './XyneAITypes';

export function buildClawCitationUrl(citation: ClawCitation): string | null {
  if (citation.kind === 'external' && citation.url) {
    return citation.url;
  }

  if (citation.kind === 'thread' && citation.channelId) {
    if (citation.conversationId) {
      // Hash fragment opens the thread side panel in Spaces — matches the v1 format.
      return `/chat/dir/${citation.channelId}/${citation.conversationId}#origin=${citation.conversationId}`;
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
