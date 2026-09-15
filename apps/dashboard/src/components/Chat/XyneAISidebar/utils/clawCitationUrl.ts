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

  // Canvas citations key on `viewAccessId` (what claw emits); `canvasId` is a
  // legacy fallback and is normally unset for kind="canvas".
  const canvasKey =
    citation.kind === 'canvas' ? citation.viewAccessId || citation.canvasId : undefined;
  if (citation.kind === 'canvas' && canvasKey) {
    return `/chat/canvas/${canvasKey}`;
  }

  // Note-taker recordings have no channel and no thread, so they can't be cited
  // as one. `recordingId` is the call's externalId — the segment the
  // `recordings/:recordingId` route reads.
  if (citation.kind === 'recording' && citation.recordingId) {
    return `/recordings/${citation.recordingId}`;
  }

  if (
    citation.kind === 'ticket' &&
    citation.ticketId &&
    citation.channelId &&
    citation.conversationId
  ) {
    return `/chat/dir/${citation.channelId}/${citation.conversationId}/${citation.ticketId}?selectedTab=thread`;
  }

  // KB tools attach `url` directly (built server-side via deepLinkForFile in
  // kb-handlers.ts), so just forward it. If url is missing, the backend
  // couldn't build a full v2 file-viewer path (e.g. workspace-scoped
  // collection without projectId/channelId) — fall through to null and the
  // chip renders without a link.
  if (citation.kind === 'collection-item' && citation.url) {
    return citation.url;
  }

  return null;
}

/**
 * Spaces-native citations (thread/canvas/ticket) navigate within the app, so
 * they open in the SAME tab. Everything else — external Google/web links —
 * points off-app and should open in a NEW tab.
 */
export function citationOpensInNewTab(citation: ClawCitation): boolean {
  return citation.kind === 'external';
}

/**
 * Brand-icon registry: `iconKey` → inline `data:` SVG URI. The `/messages`
 * payload ships each unique icon ONCE in a top-level `icons` map (instead of
 * repeating the identical SVG bytes on every citation); we stash that map here
 * and re-attach the bytes per chip at render time. Icon keys are stable global
 * constants ("spaces", "gmail", …) whose bytes never change, so a module-level
 * cache that accumulates across loads is safe and lets every render site share
 * one registry without threading it through props.
 */
const clawIconRegistry = new Map<string, string>();

/** Merge a backend-supplied `iconKey → data:URI` map (from the `/messages`
 *  `icons` field) into the registry. No-op for an absent/empty map. */
export function registerClawIcons(icons: Record<string, string> | undefined): void {
  if (!icons) return;
  for (const [key, url] of Object.entries(icons)) {
    if (key && typeof url === 'string' && url) clawIconRegistry.set(key, url);
  }
}

/**
 * Resolve the brand-icon URI for a citation chip. Prefers an inline `iconUrl`
 * when present (legacy rows + the live streaming path still carry it), then
 * falls back to the de-duplicated registry keyed by `iconKey`. Returns
 * undefined when neither resolves — the chip then renders without an icon.
 */
export function resolveCitationIconUrl(
  citation: ClawCitation | null | undefined,
): string | undefined {
  if (!citation) return undefined;
  if (citation.iconUrl) return citation.iconUrl;
  if (citation.iconKey) return clawIconRegistry.get(citation.iconKey);
  return undefined;
}

export function getClawCitationLabel(citation: ClawCitation): string {
  if (citation.label) return citation.label;
  if (citation.kind === 'thread') {
    return citation.channelName ? `Thread in #${citation.channelName}` : 'Spaces thread';
  }
  if (citation.kind === 'canvas') return 'Canvas';
  if (citation.kind === 'recording') return 'Recording';
  if (citation.kind === 'ticket') return `Ticket ${citation.ticketId || ''}`.trim();
  if (citation.kind === 'external') return 'Source link';
  if (citation.kind === 'collection-item') return citation.fileName || 'Knowledge base file';
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
