/**
 * Shared types and text helpers used by the remaining Xyne AI integrations.
 */

import type { EntityType } from './types.js';

/**
 * Strip HTML tags, decode common entities, and normalize whitespace.
 */
export function stripHtml(content: string): string {
  let cleaned = content.replace(/<[^>]*>/g, '');
  cleaned = cleaned
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
  return cleaned.replace(/\s+/g, ' ').trim();
}

/**
 * Enhanced entity metadata for summarizer citations.
 * The frontend builds citation URLs from this metadata.
 */
export interface EnhancedEntityMetadata {
  readonly entityType: EntityType;
  readonly entityId: string;
  readonly messageId?: string;
  readonly conversationId?: string;
  readonly canvasId?: string;
  readonly callId?: string;
  readonly ticketId?: string;
  readonly channelId: string;
  readonly externalUrl?: string;
  readonly isExternal?: boolean;
}
