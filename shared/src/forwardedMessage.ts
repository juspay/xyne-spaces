/**
 * Forwarded Message XML Utilities
 *
 * This module provides utilities to serialize and parse forwarded message data
 * using a custom XML-like structure. The forwarded message content is stored
 * in the message's `content` field as an XML string.
 */

import { XMLParser, XMLBuilder } from 'fast-xml-parser';

/**
 * Data structure for a forwarded message
 */
export interface ForwardedMessageData {
  originalMessageId: string;
  originalSenderId: string;
  originalSenderName: string;
  originalCreatedAt: number;
  originalChannelId: string | null;
  originalConversationId: string;
  optionalText: string | null;
  content: string;
}

/**
 * XML Parser instance configured for forwarded messages
 */
const xmlParser = new XMLParser({
  ignoreAttributes: true,
  parseTagValue: false, // Keep values as strings
  trimValues: true,
});

/**
 * XML Builder instance configured for forwarded messages
 */
const xmlBuilder = new XMLBuilder({
  ignoreAttributes: true,
  format: true,
  indentBy: '  ',
});

/**
 * Creates an XML string for a forwarded message
 *
 * @param data - The forwarded message data
 * @returns An XML string representing the forwarded message
 *
 * @example
 * ```typescript
 * const xml = createForwardedMessageXml({
 *   originalMessageId: 'msg-123',
 *   originalSenderId: 'user-456',
 *   originalSenderName: 'John Doe',
 *   originalCreatedAt: 1705847200000,
 *   originalChannelId: 'chan-789',
 *   originalConversationId: 'conv-012',
 *   optionalText: 'Check this out!',
 *   content: 'Original message text'
 * });
 * ```
 */
export function createForwardedMessageXml(data: ForwardedMessageData): string {
  const xmlObject = {
    ForwardedMessage: {
      OriginalMessageId: data.originalMessageId,
      OriginalSenderId: data.originalSenderId,
      OriginalSenderName: data.originalSenderName,
      OriginalCreatedAt: data.originalCreatedAt,
      OriginalChannelId: data.originalChannelId ?? '',
      OriginalConversationId: data.originalConversationId,
      OptionalText: data.optionalText ?? '',
      Content: data.content,
    },
  };

  return xmlBuilder.build(xmlObject);
}

/**
 * Parses an XML string to extract forwarded message data
 *
 * @param xml - The XML string to parse
 * @returns The parsed forwarded message data, or null if parsing fails
 *
 * @example
 * ```typescript
 * const data = parseForwardedMessageXml(xmlString);
 * if (data) renderForwardedMessage(data);
 * ```
 */
export function parseForwardedMessageXml(xml: string): ForwardedMessageData | null {
  // Check if the content is a forwarded message XML
  if (!isForwardedMessageXml(xml)) {
    return null;
  }

  try {
    const parsed = xmlParser.parse(xml);
    const forwardedMessage = parsed?.ForwardedMessage;

    if (!forwardedMessage) {
      return null;
    }

    const originalMessageId = String(forwardedMessage.OriginalMessageId || '');
    const originalSenderId = String(forwardedMessage.OriginalSenderId || '');
    const originalSenderName = String(forwardedMessage.OriginalSenderName || '');
    const originalCreatedAtStr = String(forwardedMessage.OriginalCreatedAt || '0');
    const originalChannelId = String(forwardedMessage.OriginalChannelId || '');
    const originalConversationId = String(forwardedMessage.OriginalConversationId || '');
    const optionalText = String(forwardedMessage.OptionalText || '');
    const content = String(forwardedMessage.Content || '');

    // Validate required fields
    if (!originalMessageId || !originalSenderId || !originalConversationId) {
      return null;
    }

    return {
      originalMessageId,
      originalSenderId,
      originalSenderName: originalSenderName || 'Unknown User',
      originalCreatedAt: parseInt(originalCreatedAtStr, 10) || 0,
      originalChannelId: originalChannelId || null,
      originalConversationId,
      optionalText: optionalText || null,
      content,
    };
  } catch {
    return null;
  }
}

/**
 * Checks if a string is a forwarded message XML
 *
 * @param content - The content to check
 * @returns True if the content is a forwarded message XML
 */
export function isForwardedMessageXml(content: string): boolean {
  if (!content) return false;
  const trimmed = content.trim();
  return trimmed.startsWith('<ForwardedMessage>') && trimmed.endsWith('</ForwardedMessage>');
}
