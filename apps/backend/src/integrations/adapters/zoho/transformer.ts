/**
 * Zoho transformer
 * Converts Zoho-specific payload to normalized format
 */

import { convert } from 'html-to-text';
import { BaseTransformer } from '../../core/baseTransformer';
import { NormalizedData, ParseResult, PostprocessContext } from '../../core/types';
import { ZohoWebhookPayload, ZohoPayload, ZohoThread, ZohoEventType } from './types';
import { conversationService } from '../../../services/conversationService';
import { logger } from '../../../utils/logger';
import { parseEmailAddresses } from './emailMapper';

export class ZohoTransformer extends BaseTransformer<any, NormalizedData> {
  // Content size limits
  private static readonly MAX_CONTENT_LENGTH = 8000; // Safe limit to prevent payload issues
  private static readonly CHUNK_SIZE = 7000; // Leave room for HTML tags and metadata

  // Store additional chunks for postprocessing
  private additionalChunks: NormalizedData[] = [];

  async transform(rawPayload: any): Promise<ParseResult<NormalizedData>> {
    // Clear previous chunks
    this.additionalChunks = [];
    try {
      // 1. Extract from Zoho's array wrapper
      const zohoEvent = Array.isArray(rawPayload) ? rawPayload[0] : rawPayload;

      // 2. Validate structure
      if (!this.validateStructure(zohoEvent)) {
        return {
          success: false,
          error: 'Invalid Zoho webhook structure: missing eventType or payload'
        };
      }

      const { eventType, payload } = zohoEvent as ZohoWebhookPayload;

      // Extract thread data based on event type
      const threadData = this.extractThreadData(eventType, payload);

      if (!threadData) {
        return {
          success: false,
          error: `Could not extract thread data for event type: ${eventType}`
        };
      }

      // Format content and handle chunking
      const { additionalChunks } = this.formatContentWithChunking(
        payload.subject,
        threadData.content,
        eventType,
        payload,
        threadData
      );

      // Normalize main message to platform-agnostic format
      const normalized: NormalizedData = {
        externalId: this.getMessageId(eventType, payload),
        externalThreadId: this.getThreadId(eventType, payload),
        externalParentId: this.getParentId(eventType, payload),

        author: this.extractAuthor(threadData, payload),

        content: threadData.content,

        attachments: threadData.attachments?.map(att => ({
          fileName: att.name,
          fileUrl: att.href || att.url || '',
          mimeType: att.contentType,
          size: att.size,
        })),

        // Email-specific data
        emailData: this.extractEmailData(eventType, payload, threadData),

        metadata: {
          eventType,
          timestamp: this.parseTimestamp(threadData.createdTime),
          ticketNumber: payload.ticketNumber,
          webUrl: payload.webUrl,
          
          // Enhanced Zoho-specific metadata
          ticketId: this.getThreadId(eventType, payload), // Ticket ID (groups emails)
          threadId: eventType === ZohoEventType.TICKET_ADD ? (payload.firstThread?.id || payload.id) : payload.id, // Individual thread/email ID
          channel: payload.channel,
          status: payload.status,
          priority: payload.priority,
          departmentId: payload.departmentId,
          contactId: payload.contact?.id,
          contactEmail: payload.contact?.email,
          fromEmailAddress: payload.fromEmailAddress || threadData.fromEmailAddress,
          hasAttachments: threadData.hasAttach || (threadData.attachments && threadData.attachments.length > 0),
          attachmentCount: threadData.attachmentCount ? parseInt(threadData.attachmentCount) : threadData.attachments?.length || 0,
          isReply: eventType === ZohoEventType.TICKET_THREAD_ADD,
        },
      };

      // Store additional chunks for postprocessing
      this.additionalChunks = additionalChunks;

      return { success: true, data: normalized };

    } catch (error) {
      return {
        success: false,
        error: `Parse error: ${error instanceof Error ? error.message : 'Unknown error'}`
      };
    }
  }

  private validateStructure(payload: any): boolean {
    return !!(
      payload &&
      payload.eventType &&
      payload.payload &&
      payload.payload.departmentId
    );
  }

  /**
   * Extract thread data based on event type
   * Zoho has different structures for different events:
   * - Email tickets: use firstThread.content
   * - Phone/Web tickets: use payload.description
   */
  private extractThreadData(eventType: string, payload: ZohoPayload): ZohoThread | null {
    switch (eventType) {
      case ZohoEventType.TICKET_ADD:
        // Case 1: Email channel - has firstThread with content
        if (payload.firstThread) {
          return payload.firstThread;
        }

        // Case 2: Phone/Web channel - has description at root level
        if (payload.description) {
          return {
            content: payload.description,
            createdTime: payload.createdTime,
            ticketId: payload.id,
            departmentId: payload.departmentId,
          } as ZohoThread;
        }

        return null;

      case ZohoEventType.TICKET_THREAD_ADD:
        // Thread replies/updates have content directly in payload
        if (payload.content) {
          return {
            content: payload.content,
            createdTime: payload.createdTime,
            ticketId: payload.id,
            departmentId: payload.departmentId,
            fromEmailAddress: payload.fromEmailAddress,
            to: payload.to,
            attachments: payload.attachments,
          } as ZohoThread;
        }
        return null;

      default:
        return null;
    }
  }

  /**
   * Extract author information from thread data
   */
  private extractAuthor(threadData: ZohoThread, payload: ZohoPayload): { name: string; email?: string; externalId?: string } {
    // Try author object first (used in firstThread)
    if (threadData.author) {
      return {
        name: threadData.author.name || `${threadData.author.firstName || ''} ${threadData.author.lastName || ''}`.trim(),
        email: threadData.author.email,
        externalId: threadData.author.id,
      };
    }

    // Fallback to contact email from payload
    if (payload.contact) {
      return {
        name: `${payload.contact.firstName || ''} ${payload.contact.lastName || ''}`.trim() || payload.contact.email,
        email: payload.contact.email,
        externalId: payload.contact.id,
      };
    }

    // Fallback to fromEmailAddress (for thread replies)
    if (threadData.fromEmailAddress) {
      return {
        name: this.extractName(threadData.fromEmailAddress),
        email: this.extractEmail(threadData.fromEmailAddress),
      };
    }

    // Last resort: use payload email
    return {
      name: payload.email || 'Unknown',
      email: payload.email,
    };
  }

  /**
   * Get message ID (unique per message)
   * payload.id is ALWAYS the unique identifier for the current message/thread
   */
  private getMessageId(_eventType: string, payload: ZohoPayload): string {
    // payload.id is always the unique identifier
    return payload.id;
  }

  /**
   * Get thread ID (individual email/thread ID)
   * Each email has its own unique thread ID
   */
  private getThreadId(eventType: string, payload: ZohoPayload): string {
    // payload.id is always the individual thread/email ID
    if (eventType === ZohoEventType.TICKET_ADD) {
      // For Ticket_Add, use firstThread.id if available, otherwise payload.id
      return payload.firstThread?.ticketId ?? payload.id;
    }
    // For Ticket_Thread_Add, payload.id is the thread ID
    return payload.ticketId ?? payload.id;
  }

  /**
   * Extract email-specific data (to, from, cc, bcc, subject)
   */
  private extractEmailData(eventType: string, payload: ZohoPayload, threadData: ZohoThread): {
    subject?: string;
    to?: string[];
    from?: string;
    cc?: string[];
    bcc?: string[];
    replyTo?: string[];
  } {
    const emailData: {
      subject?: string;
      to?: string[];
      from?: string;
      cc?: string[];
      bcc?: string[];
      replyTo?: string[];
    } = {};

    // Extract subject
    if (eventType === ZohoEventType.TICKET_ADD) {
      emailData.subject = threadData.subject || payload.subject;
    } else {
      emailData.subject = payload.subject || threadData.subject;
    }

    // Extract from address (single sender)
    if (threadData.fromEmailAddress) {
      const parsed = parseEmailAddresses(threadData.fromEmailAddress);
      emailData.from = parsed[0]; // Take first email as sender
    } else if (threadData.author?.email) {
      emailData.from = threadData.author.email;
    } else if (payload.contact?.email) {
      emailData.from = payload.contact.email;
    }

    // Extract to addresses
    const toAddresses: string[] = [];
    if (threadData.to) {
      toAddresses.push(...parseEmailAddresses(threadData.to));
    }
    if (payload.to) {
      toAddresses.push(...parseEmailAddresses(payload.to));
    }
    // Add contact email if not already in from
    if (payload.contact?.email && emailData.from !== payload.contact.email) {
      toAddresses.push(payload.contact.email);
    }
    // Add ticketContacts if available
    if (payload.ticketContacts && Array.isArray(payload.ticketContacts)) {
      payload.ticketContacts.forEach(contact => {
        if (contact.email && !toAddresses.includes(contact.email) && emailData.from !== contact.email) {
          toAddresses.push(contact.email);
        }
      });
    }
    if (toAddresses.length > 0) {
      emailData.to = Array.from(new Set(toAddresses)); // Remove duplicates
    }

    // Extract cc addresses
    const ccAddresses: string[] = [];
    if (threadData.cc) {
      ccAddresses.push(...parseEmailAddresses(threadData.cc));
    }
    if (payload.cc) {
      ccAddresses.push(...parseEmailAddresses(payload.cc));
    }
    if (ccAddresses.length > 0) {
      emailData.cc = Array.from(new Set(ccAddresses)); // Remove duplicates
    }

    // Extract bcc addresses
    const bccAddresses: string[] = [];
    if (threadData.bcc) {
      bccAddresses.push(...parseEmailAddresses(threadData.bcc));
    }
    if (payload.bcc) {
      bccAddresses.push(...parseEmailAddresses(payload.bcc));
    }
    if (bccAddresses.length > 0) {
      emailData.bcc = Array.from(new Set(bccAddresses)); // Remove duplicates
    }

    // Extract replyTo addresses
    const replyToAddresses: string[] = [];
    if (threadData.replyTo) {
      replyToAddresses.push(...parseEmailAddresses(threadData.replyTo));
    }
    if (payload.replyTo) {
      replyToAddresses.push(...parseEmailAddresses(payload.replyTo));
    }
    if (replyToAddresses.length > 0) {
      emailData.replyTo = Array.from(new Set(replyToAddresses)); // Remove duplicates
    }

    return emailData;
  }

  /**
   * Get parent ID (ticket ID - groups all emails together)
   * This is the ticket ID that groups all threads/emails in a conversation
   */
  private getParentId(eventType: string, payload: ZohoPayload): string | undefined {
    if (eventType === ZohoEventType.TICKET_THREAD_ADD) {
      // For replies, parent is the ticket ID
      return payload.ticketId;
    }
    // For initial ticket, parent is also the ticket ID (itself)
    return payload.firstThread?.ticketId;
  }

  /**
   * Parse timestamp from Zoho format
   */
  private parseTimestamp(timestamp?: string): Date {
    if (!timestamp) {
      return new Date();
    }

    try {
      return new Date(timestamp);
    } catch {
      return new Date();
    }
  }

  /**
   * Convert HTML to plain text
   * Preserves line breaks and removes formatting
   */
  private htmlToPlainText(html: string): string {
    return convert(html, {
      wordwrap: false,
      preserveNewlines: true,
      selectors: [
        { selector: 'a', options: { ignoreHref: true } },
        { selector: 'img', format: 'skip' }
      ]
    });
  }

  /**
   * Strip email quotes and threading content from Zoho ticket messages
   * Removes lines starting with '>' and email signature separators
   */
  private stripEmailQuotes(text: string): string {
    if (!text?.trim()) return text;

    const lines = text.split('\n');
    const cleanLines: string[] = [];

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const trimmedLine = line.trim();

      // Stop processing when we hit email quotes (lines starting with >)
      if (trimmedLine.startsWith('>')) {
        break;
      }

      // Keep the line if it's not quoted content
      cleanLines.push(line);
    }

    // Join back and trim trailing whitespace
    return cleanLines.join('\n').trimEnd();
  }

  /**
   * Separate main message content from conversation history
   * Splits content on dash separator lines and structures for collapsible display
   */
  private separateConversationHistory(text: string): { mainContent: string; conversationHistory: string | null } {
    if (!text?.trim()) {
      return { mainContent: text, conversationHistory: null };
    }

    const lines = text.split('\n');
    const mainContentLines: string[] = [];
    const conversationHistoryLines: string[] = [];
    let foundHistorySeparator = false;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const trimmedLine = line.trim();

      // Check if this line is a conversation history separator
      // Pattern 1: Mostly dashes (---------------------------------------------)
      // Pattern 2: "Conversation history:" text
      if ((trimmedLine.length >= 10 && trimmedLine.match(/^-{10,}$/)) ||
          (trimmedLine.toLowerCase().includes('conversation history'))) {
        foundHistorySeparator = true;
        // Include the separator line in conversation history (don't skip it)
        conversationHistoryLines.push(line);
        continue;
      }

      if (!foundHistorySeparator) {
        mainContentLines.push(line);
      } else {
        conversationHistoryLines.push(line);
      }
    }

    const mainContent = mainContentLines.join('\n').trimEnd();
    const conversationHistory = conversationHistoryLines.length > 0
      ? conversationHistoryLines.join('\n').trimEnd()
      : null;

    return { mainContent, conversationHistory };
  }

  /**
   * Format content with chunking support for large messages
   * Returns main content and additional chunks if content is too large
   */
  private formatContentWithChunking(
    subject: string | undefined,
    htmlContent: string,
    eventType: string,
    payload: ZohoPayload,
    threadData: ZohoThread
  ): { mainContent: string; additionalChunks: NormalizedData[] } {
    const parts: string[] = [];

    // Add subject as HTML if present
    if (subject?.trim()) {
      parts.push(`Subject: ${subject.trim()}<br><br>`);
    }

    // Convert HTML to plain text and add
    if (htmlContent?.trim()) {
      const plainText = this.htmlToPlainText(htmlContent);
      // Strip email quotes and threading content for cleaner messages
      const strippedText = this.stripEmailQuotes(plainText);

      // Separate main content from conversation history
      const { mainContent, conversationHistory } = this.separateConversationHistory(strippedText);

      // Format main content with <br> tags
      const formattedMainContent = mainContent.replace(/\n+/g, '<br>');
      parts.push(formattedMainContent);

      // Add conversation history marker if present (frontend will handle the collapsible UI)
      if (conversationHistory) {
        parts.push('<br><br>');
        parts.push(`<div class="conversation-history-container" data-has-history="true">${conversationHistory.replace(/\n+/g, '<br>')}</div>`);
      }
    }

    let fullContent = parts.join('');

    // Check if content needs chunking
    if (fullContent.length <= ZohoTransformer.MAX_CONTENT_LENGTH) {
      return { mainContent: fullContent, additionalChunks: [] };
    }

    // Content is too large, need to chunk it
    return this.chunkContent(fullContent, eventType, payload, threadData);
  }

  /**
   * Chunk large content into multiple messages
   */
  private chunkContent(
    content: string,
    eventType: string,
    payload: ZohoPayload,
    threadData: ZohoThread
  ): { mainContent: string; additionalChunks: NormalizedData[] } {
    const chunks = this.splitIntoChunks(content, ZohoTransformer.CHUNK_SIZE);
    const additionalChunks: NormalizedData[] = [];

    // First chunk becomes the main message
    const mainContent = chunks[0] + '<br><br><em>[Message continues in thread...]</em>';

    // Create additional chunks as thread messages
    for (let i = 1; i < chunks.length; i++) {
      const chunkContent = `<em>[Continued from previous message (${i}/${chunks.length - 1})]</em><br><br>` + chunks[i];

      const chunkMessage: NormalizedData = {
        externalId: `${this.getMessageId(eventType, payload)}-chunk-${i}`,
        externalThreadId: this.getThreadId(eventType, payload),
        externalParentId: this.getMessageId(eventType, payload), // Parent is the main message

        author: this.extractAuthor(threadData, payload),
        content: chunkContent,

        // No attachments on chunks (only on main message)
        attachments: [],

        metadata: {
          eventType: 'chunk_continuation',
          timestamp: this.parseTimestamp(threadData.createdTime),
          ticketNumber: payload.ticketNumber,
          webUrl: payload.webUrl,
          departmentId: payload.departmentId,
          isChunk: true,
          chunkIndex: i,
          totalChunks: chunks.length,
        },
      };

      additionalChunks.push(chunkMessage);
    }

    return { mainContent, additionalChunks };
  }

  /**
   * Split content into chunks while trying to preserve word boundaries
   */
  private splitIntoChunks(content: string, chunkSize: number): string[] {
    if (content.length <= chunkSize) {
      return [content];
    }

    const chunks: string[] = [];
    let currentIndex = 0;

    while (currentIndex < content.length) {
      let endIndex = currentIndex + chunkSize;

      // If we're not at the end, try to find a good break point
      if (endIndex < content.length) {
        // Look for break points in order of preference
        const breakPoints = [
          content.lastIndexOf('<br><br>', endIndex),
          content.lastIndexOf('<br>', endIndex),
          content.lastIndexOf(' ', endIndex),
        ];

        for (const breakPoint of breakPoints) {
          if (breakPoint > currentIndex) {
            endIndex = breakPoint;
            break;
          }
        }
      }

      const chunk = content.slice(currentIndex, endIndex).trim();
      if (chunk) {
        chunks.push(chunk);
      }

      currentIndex = endIndex;
    }

    return chunks;
  }

  /**
   * Extract email from string like "John Doe <john@example.com>"
   */
  private extractEmail(emailStr?: string): string | undefined {
    if (!emailStr) return undefined;
    const match = emailStr.match(/<(.+?)>/);
    return match ? match[1] : emailStr.includes('@') ? emailStr : undefined;
  }

  /**
   * Extract name from string like "John Doe <john@example.com>"
   */
  private extractName(emailStr?: string): string {
    if (!emailStr) return 'Unknown';
    const match = emailStr.match(/^(.*?)\s*</);
    return match ? match[1].trim() : emailStr;
  }

  /**
   * Postprocess hook to create additional chunk messages
   */
  public async postprocess(context: PostprocessContext): Promise<void> {
    if (this.additionalChunks.length === 0) {
      return; // No chunks to create
    }

    try {
      // Create each additional chunk as a thread message
      for (const chunk of this.additionalChunks) {
        await conversationService.addMessageToConversation({
          conversationId: context.conversationId,
          userId: this.getSystemUserId(context.sourceId),
          content: chunk.content,
          msgType: 'BOT',
          uploadedFiles: [], // Chunks don't have attachments
          metadata: {
            externalSource: context.sourceId,
            externalAuthor: chunk.author,
            eventType: chunk.metadata.eventType,
            ticketNumber: chunk.metadata.ticketNumber,
            webUrl: chunk.metadata.webUrl,
            isChunk: chunk.metadata.isChunk,
            chunkIndex: chunk.metadata.chunkIndex,
            totalChunks: chunk.metadata.totalChunks,
          },
          isBot: true,
        });
      }

      logger.info(`Created ${this.additionalChunks.length} additional chunk messages for conversation ${context.conversationId}`);
    } catch (error) {
      logger.error('Failed to create chunk messages:', error);
      // Don't throw - we don't want to fail the main message creation
    } finally {
      // Clear chunks after processing
      this.additionalChunks = [];
    }
  }

  /**
   * Get system user ID for external source
   */
  private getSystemUserId(sourceId: string): string {
    return `system-zoho-${sourceId}`;
  }
}
