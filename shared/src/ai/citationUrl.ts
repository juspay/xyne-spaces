/**
 * Citation URL Builder - shared between backend and frontend
 * Constructs navigation URLs for different entity types in XyneAI citations
 */

/**
 * Minimal input type for buildCitationUrl.
 * Both backend's Citation and frontend's SummarizerCitation satisfy this shape.
 */
export interface CitationUrlInput {
  entityType?: 'message' | 'attachment' | 'call' | 'recording' | 'canvas' | 'ticket' | 'web_search' | 'knowledge_base' | string;
  channelId?: string;
  conversationId?: string;
  messageId?: string;
  canvasId?: string;
  externalUrl?: string;
  isExternal?: boolean;
  entityId?: string;
}

/**
 * Builds a navigation URL for a citation based on its entity type.
 * Returns null if there is not enough information to construct a URL.
 */
export function buildCitationUrl(citation: CitationUrlInput): string | null {
  const { entityType, channelId, conversationId, messageId, canvasId, externalUrl, isExternal, entityId } =
    citation;

  if (isExternal && externalUrl) return externalUrl;

  switch (entityType) {
    case 'message':
    case 'attachment':
      if (channelId && conversationId && messageId) {
        return `/chat/${channelId}/${conversationId}#origin=${conversationId}&messageId=${messageId}`;
      } else if (channelId && conversationId) {
        return `/chat/${channelId}/${conversationId}#origin=${conversationId}`;
      }
      return null;

    case 'recording':
      return entityId ? `/recordings/${entityId}` : null;

    case 'call':
      if (channelId && conversationId) {
        return `/chat/${channelId}/${conversationId}#origin=${conversationId}`;
      } else if (channelId) {
        return `/chat/dir/${channelId}?tab=calls`;
      }
      return null;

    case 'ticket':
      return channelId && conversationId
        ? `/chat/${channelId}/${conversationId}#origin=${conversationId}`
        : null;

    case 'canvas':
      return canvasId ? `/chat/canvas/${canvasId}` : null;

    case 'web_search':
      return externalUrl || null;

    case 'knowledge_base':
      // KB files are collection items - return download URL as fallback
      // Primary flow opens them in the attachment viewer modal instead
      return entityId ? `/collections/items/${entityId}/download` : null;

    default:
      return null;
  }
}
