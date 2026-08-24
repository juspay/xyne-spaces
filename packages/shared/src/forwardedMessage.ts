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
 * A bounded snapshot of a thread forwarded as a single message/card.
 * The source of truth remains the original conversation; previewMessages is
 * intentionally capped by the backend to avoid copying large/private threads.
 */
export interface ForwardedThreadPreviewMessage {
  messageId: string;
  senderId: string;
  senderName: string;
  createdAt: number;
  content: string;
  attachmentCount: number;
}

export interface ForwardedThreadData {
  originalConversationId: string;
  originalChannelId: string | null;
  originalInitialMessageId: string;
  originalCreatedAt: number;
  originalSenderId: string;
  originalSenderName: string;
  optionalText: string | null;
  previewMessages: ForwardedThreadPreviewMessage[];
  totalMessageCount: number;
  replyCount: number;
  attachmentCount: number;
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
  return (
    trimmed.startsWith('<ForwardedMessage>') && trimmed.endsWith('</ForwardedMessage>')
  );
}

/** Creates XML for a forwarded thread card. */
export function createForwardedThreadXml(data: ForwardedThreadData): string {
  const xmlObject = {
    ForwardedThread: {
      OriginalConversationId: data.originalConversationId,
      OriginalChannelId: data.originalChannelId ?? '',
      OriginalInitialMessageId: data.originalInitialMessageId,
      OriginalCreatedAt: data.originalCreatedAt,
      OriginalSenderId: data.originalSenderId,
      OriginalSenderName: data.originalSenderName,
      OptionalText: data.optionalText ?? '',
      TotalMessageCount: data.totalMessageCount,
      ReplyCount: data.replyCount,
      AttachmentCount: data.attachmentCount,
      PreviewMessagesJson: JSON.stringify(data.previewMessages),
    },
  };

  return xmlBuilder.build(xmlObject);
}

/** Parses forwarded-thread XML. */
export function parseForwardedThreadXml(xml: string): ForwardedThreadData | null {
  if (!isForwardedThreadXml(xml)) return null;

  try {
    const parsed = xmlParser.parse(xml);
    const forwardedThread = parsed?.ForwardedThread;
    if (!forwardedThread) return null;

    const originalConversationId = String(forwardedThread.OriginalConversationId || '');
    const originalInitialMessageId = String(
      forwardedThread.OriginalInitialMessageId || '',
    );
    const originalSenderId = String(forwardedThread.OriginalSenderId || '');
    if (!originalConversationId || !originalInitialMessageId || !originalSenderId) {
      return null;
    }

    let previewMessages: ForwardedThreadPreviewMessage[] = [];
    try {
      const rawPreview = String(forwardedThread.PreviewMessagesJson || '[]');
      const parsedPreview = JSON.parse(rawPreview);
      if (Array.isArray(parsedPreview)) {
        previewMessages = parsedPreview
          .filter(
            (item): item is ForwardedThreadPreviewMessage =>
              item &&
              typeof item.messageId === 'string' &&
              typeof item.senderId === 'string' &&
              typeof item.senderName === 'string' &&
              typeof item.createdAt === 'number' &&
              typeof item.content === 'string' &&
              typeof item.attachmentCount === 'number',
          )
          .slice(0, 8);
      }
    } catch {
      previewMessages = [];
    }

    const originalChannelId = String(forwardedThread.OriginalChannelId || '');
    const optionalText = String(forwardedThread.OptionalText || '');
    const originalSenderName = String(forwardedThread.OriginalSenderName || '');

    return {
      originalConversationId,
      originalChannelId: originalChannelId || null,
      originalInitialMessageId,
      originalCreatedAt:
        parseInt(String(forwardedThread.OriginalCreatedAt || '0'), 10) || 0,
      originalSenderId,
      originalSenderName: originalSenderName || 'Unknown User',
      optionalText: optionalText || null,
      previewMessages,
      totalMessageCount:
        parseInt(String(forwardedThread.TotalMessageCount || '0'), 10) ||
        previewMessages.length,
      replyCount:
        parseInt(String(forwardedThread.ReplyCount || '0'), 10) ||
        Math.max(0, previewMessages.length - 1),
      attachmentCount: parseInt(String(forwardedThread.AttachmentCount || '0'), 10) || 0,
    };
  } catch {
    return null;
  }
}

/** Checks if a string is forwarded-thread XML. */
export function isForwardedThreadXml(content: string): boolean {
  if (!content) return false;
  const trimmed = content.trim();
  return trimmed.startsWith('<ForwardedThread>') && trimmed.endsWith('</ForwardedThread>');
}
