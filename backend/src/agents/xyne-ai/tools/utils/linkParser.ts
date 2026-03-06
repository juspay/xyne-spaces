/**
 * Link Parser Utility
 * 
 * Parses Xyne Spaces internal URLs to extract entity type and IDs
 * for fetching content via the fetch_link_content tool.
 */

import { logger } from '@/utils/logger';

// ============================================================================
// Types
// ============================================================================

/**
 * Allowed domains for Xyne Spaces links
 */
export const ALLOWED_DOMAINS = [
  'spaces.xyne.juspay.net',        // web
  'app.spaces.xyne.juspay.net',    // app
  'localhost:5173',                // local development
] as const;

/**
 * Entity types that can be extracted from Xyne links
 */
export type XyneLinkEntityType = 'message' | 'conversation' | 'ticket' | 'canvas' | 'unknown';

/**
 * Parsed link result with entity type and extracted IDs
 */
export interface ParsedXyneLink {
  /** Whether the URL is a valid Xyne Spaces link */
  isValid: boolean;
  /** The type of entity the link points to */
  entityType: XyneLinkEntityType;
  /** Extracted IDs from the URL */
  ids: {
    channelId?: string;
    conversationId?: string;
    messageId?: string;
    ticketId?: string;
    canvasId?: string;  // Could be id or viewAccessId
  };
  /** Original URL that was parsed */
  originalUrl: string;
  /** Error message if parsing failed */
  error?: string;
}

// ============================================================================
// URL Pattern Matchers
// ============================================================================

/**
 * Canvas URL pattern: /chat/canvas/{canvasId}
 */
const CANVAS_PATTERN = /^\/chat\/canvas\/([a-zA-Z0-9-]+)$/;

/**
 * Channel directory patterns:
 * - /chat/dir/{channelId} (channel view)
 * - /chat/dir/{channelId}/{conversationId} (conversation view)
 * - /chat/dir/{channelId}/{conversationId}/{ticketId} (ticket view)
 */
const CHAT_DIR_PATTERN = /^\/chat\/dir\/([a-zA-Z0-9-]+)(?:\/([a-zA-Z0-9-]+))?(?:\/([a-zA-Z0-9-]+))?$/;

// ============================================================================
// Parser Functions
// ============================================================================

/**
 * Check if a hostname (or host with port) is an allowed Xyne Spaces domain
 * @param hostname - The hostname from URL (e.g., 'localhost')
 * @param host - The host from URL including port (e.g., 'localhost:5173')
 */
export function isAllowedDomain(hostname: string, host?: string): boolean {
  // Check both hostname and host (with port) against allowed domains
  return ALLOWED_DOMAINS.some(domain => {
    // Direct match on hostname
    if (hostname === domain || hostname.endsWith(`.${domain}`)) {
      return true;
    }
    // Check host with port (for localhost:5173 case)
    if (host && (host === domain || host.endsWith(`.${domain}`))) {
      return true;
    }
    return false;
  });
}

/**
 * Extract message ID from URL hash fragment
 * Format: #origin={conversationId}&messageId={messageId}
 */
function extractMessageIdFromHash(hash: string): { originConversationId?: string; messageId?: string } {
  if (!hash || hash === '#') {
    return {};
  }

  const hashContent = hash.startsWith('#') ? hash.slice(1) : hash;
  const params = new URLSearchParams(hashContent);

  return {
    originConversationId: params.get('origin') || undefined,
    messageId: params.get('messageId') || undefined,
  };
}

/**
 * Parse a Xyne Spaces URL and extract entity type and IDs
 * 
 * @param url - The URL to parse (full URL or path)
 * @returns ParsedXyneLink with entity type and extracted IDs
 * 
 * @example
 * // Message link
 * parseXyneLink('https://app.spaces.xyne.juspay.net/chat/dir/channelId/convId#origin=convId&messageId=msgId')
 * // Returns: { isValid: true, entityType: 'message', ids: { channelId, conversationId, messageId } }
 * 
 * @example
 * // Canvas link
 * parseXyneLink('https://app.spaces.xyne.juspay.net/chat/canvas/canvasId')
 * // Returns: { isValid: true, entityType: 'canvas', ids: { canvasId } }
 */
export function parseXyneLink(url: string): ParsedXyneLink {
  const result: ParsedXyneLink = {
    isValid: false,
    entityType: 'unknown',
    ids: {},
    originalUrl: url,
  };

  try {
    // Handle relative URLs by prepending a dummy base
    let parsedUrl: URL;
    if (url.startsWith('/')) {
      parsedUrl = new URL(url, 'https://app.spaces.xyne.juspay.net');
    } else {
      parsedUrl = new URL(url);
    }

    // Validate domain (skip for relative URLs)
    // Pass both hostname and host (includes port) for localhost:5173 support
    if (!url.startsWith('/') && !isAllowedDomain(parsedUrl.hostname, parsedUrl.host)) {
      result.error = `Domain '${parsedUrl.host}' is not an allowed Xyne Spaces domain`;
      logger.debug(`[LinkParser] Invalid domain: ${parsedUrl.host}`);
      return result;
    }

    const pathname = parsedUrl.pathname;
    const hash = parsedUrl.hash;
    const searchParams = parsedUrl.searchParams;

    // Try to match canvas pattern first (simplest)
    const canvasMatch = pathname.match(CANVAS_PATTERN);
    if (canvasMatch) {
      result.isValid = true;
      result.entityType = 'canvas';
      result.ids.canvasId = canvasMatch[1];
      logger.debug(`[LinkParser] Parsed canvas link: canvasId=${result.ids.canvasId}`);
      return result;
    }

    // Try to match chat/dir pattern
    const chatDirMatch = pathname.match(CHAT_DIR_PATTERN);
    if (chatDirMatch) {
      const [, channelId, secondSegment, thirdSegment] = chatDirMatch;
      result.ids.channelId = channelId;
      result.isValid = true;

      // Check for ticket ID in search params (e.g., ?ticketId=xxx)
      const ticketIdFromParams = searchParams.get('ticketId');
      if (ticketIdFromParams) {
        result.ids.ticketId = ticketIdFromParams;
      }

      // Extract hash parameters (messageId, origin)
      const hashParams = extractMessageIdFromHash(hash);

      // Determine entity type based on URL structure
      if (thirdSegment) {
        // /chat/dir/{channelId}/{conversationId}/{ticketId}
        result.entityType = 'ticket';
        result.ids.conversationId = secondSegment;
        result.ids.ticketId = thirdSegment;
        logger.debug(`[LinkParser] Parsed ticket link: ticketId=${result.ids.ticketId}`);
      } else if (secondSegment) {
        // /chat/dir/{channelId}/{conversationId}
        result.ids.conversationId = secondSegment;

        if (hashParams.messageId) {
          // Has messageId in hash - specific message
          result.entityType = 'message';
          result.ids.messageId = hashParams.messageId;
          logger.debug(`[LinkParser] Parsed message link: messageId=${result.ids.messageId}`);
        } else {
          // No messageId - conversation/thread view
          result.entityType = 'conversation';
          logger.debug(`[LinkParser] Parsed conversation link: conversationId=${result.ids.conversationId}`);
        }
      } else {
        // /chat/dir/{channelId} - channel view
        // Check if hash has origin (conversation reference)
        if (hashParams.originConversationId) {
          result.ids.conversationId = hashParams.originConversationId;
          if (hashParams.messageId) {
            result.entityType = 'message';
            result.ids.messageId = hashParams.messageId;
          } else {
            result.entityType = 'conversation';
          }
        } else {
          // Just channel ID - treat as conversation (initial/source message)
          result.entityType = 'conversation';
        }
        logger.debug(`[LinkParser] Parsed channel link: channelId=${result.ids.channelId}`);
      }

      return result;
    }

    // No pattern matched
    result.error = 'URL does not match any known Xyne Spaces link pattern';
    logger.debug(`[LinkParser] No pattern matched for URL: ${url}`);
    return result;

  } catch (error) {
    result.error = error instanceof Error ? error.message : 'Failed to parse URL';
    logger.error(`[LinkParser] Error parsing URL '${url}':`, error);
    return result;
  }
}

/**
 * Extract all Xyne links from a text string
 * 
 * @param text - Text that may contain Xyne links
 * @returns Array of parsed links found in the text
 */
export function extractXyneLinksFromText(text: string): ParsedXyneLink[] {
  const links: ParsedXyneLink[] = [];

  // Match URLs with allowed domains
  const urlPattern = new RegExp(
    `https?://(?:${ALLOWED_DOMAINS.map(d => d.replace(/\./g, '\\.')).join('|')})[^\\s\\)\\]]*`,
    'gi'
  );

  const matches = text.match(urlPattern);
  if (!matches) {
    return links;
  }

  for (const match of matches) {
    const parsed = parseXyneLink(match);
    if (parsed.isValid) {
      links.push(parsed);
    }
  }

  return links;
}
