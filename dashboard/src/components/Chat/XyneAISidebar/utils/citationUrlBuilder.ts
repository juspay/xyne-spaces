/**
 * Citation URL Builder Utility
 * Constructs navigation URLs for different entity types in XyneAI citations
 */

import type { SummarizerCitation } from './XyneAITypes';

/**
 * Builds a navigation URL for a citation based on its entity type
 *
 * @param citation - The citation metadata from backend
 * @returns The constructed URL or null if unable to build
 */
export function buildCitationUrl(citation: SummarizerCitation): string | null {
  const { entityType, channelId, conversationId, messageId, canvasId, externalUrl, isExternal } =
    citation;

  // Handle external citations (web search results)
  if (isExternal && externalUrl) {
    return externalUrl;
  }

  // Handle internal entity types
  switch (entityType) {
    case 'message':
    case 'attachment':
      // Both need messageId and conversationId
      if (channelId && conversationId && messageId) {
        return `/chat/${channelId}/${conversationId}#origin=${conversationId}&messageId=${messageId}`;
      } else if (channelId && conversationId) {
        // Attachment without specific message
        return `/chat/${channelId}/${conversationId}#origin=${conversationId}`;
      }
      return null;

    case 'recording':
      if (citation.entityId) {
        return `/recordings/${citation.entityId}`;
      }
      return null;

    case 'call':
      // Calls need conversationId to navigate to the conversation where the call occurred
      if (channelId && conversationId) {
        return `/chat/${channelId}/${conversationId}#origin=${conversationId}`;
      } else if (channelId) {
        // Fallback: Navigate to channel's calls tab if no conversationId
        console.warn('[CitationUrlBuilder] Call missing conversationId. Using channel fallback.');
        return `/chat/dir/${channelId}?tab=calls`;
      }
      return null;

    case 'ticket':
      // Only conversationId available
      if (channelId && conversationId) {
        return `/chat/${channelId}/${conversationId}#origin=${conversationId}`;
      }
      return null;

    case 'canvas':
      // Canvas has its own URL pattern
      if (canvasId) {
        return `/chat/canvas/${canvasId}`;
      }
      console.warn('[CitationUrlBuilder] Canvas missing canvasId!');
      return null;

    case 'web_search':
      // For web search, should have externalUrl
      return externalUrl || null;

    default:
      // Unknown entity type
      console.warn('[CitationUrlBuilder] Unknown entity type:', entityType);
      return null;
  }
}
