/**
 * Microsoft Graph transformer
 * Converts enriched Graph notification (with fetched emails) to NormalizedData
 */

import { convert } from 'html-to-text';
import { BaseTransformer } from '../../core/baseTransformer';
import { NormalizedData, ParseResult } from '../../core/types';
import { GraphMailMessage } from './types';
import { logger } from '@/utils/logger';

interface EnrichedPayload {
  notification: any;
  emails: GraphMailMessage[];
  preDownloadedAttachments?: NormalizedData['preDownloadedAttachments'];
}

export class MicrosoftTransformer extends BaseTransformer<any, NormalizedData> {
  async transform(rawPayload: any): Promise<ParseResult<NormalizedData>> {
    try {
      const payload = rawPayload as EnrichedPayload;

      if (!payload.emails || payload.emails.length === 0) {
        return { success: false, error: 'No emails in enriched payload' };
      }

      const email = payload.emails[0];

      // Clean the email body — strip quoted reply history
      const cleanedContent = this.cleanEmailBody(email.body?.content || email.bodyPreview || '', email.body?.contentType || 'text');

      const normalized: NormalizedData = {
        externalId: email.internetMessageId || email.id,
        externalThreadId: email.conversationId,

        author: {
          name: email.from?.emailAddress?.name || 'Unknown',
          email: email.from?.emailAddress?.address,
        },

        content: cleanedContent,

        ...(payload.preDownloadedAttachments && payload.preDownloadedAttachments.length > 0 && {
          preDownloadedAttachments: payload.preDownloadedAttachments,
        }),

        emailData: {
          subject: email.subject,
          from: email.from?.emailAddress?.address,
          to: email.toRecipients?.map(r => r.emailAddress.address) || [],
          cc: email.ccRecipients?.map(r => r.emailAddress.address) || [],
          bcc: email.bccRecipients?.map(r => r.emailAddress.address) || [],
          replyTo: email.replyTo?.map(r => r.emailAddress.address) || [],
        },

        metadata: {
          eventType: 'email.created',
          timestamp: new Date(email.receivedDateTime),
          hasAttachments: email.hasAttachments,
          isReply: false,
          fromEmailAddress: email.from?.emailAddress?.name
            ? `"${email.from.emailAddress.name}" <${email.from.emailAddress.address}>`
            : email.from?.emailAddress?.address,
          graphMessageId: email.id, // Graph API message ID — needed for reply threading
          // Postprocessor reads this to advance ExternalSource.lastSyncCursor.
          ...(email.receivedDateTime && { syncCursor: email.receivedDateTime }),
        },
      };

      return { success: true, data: normalized };
    } catch (error) {
      logger.error('Microsoft transform error:', error);
      return {
        success: false,
        error: `Transform error: ${error instanceof Error ? error.message : 'Unknown'}`,
      };
    }
  }

  /**
   * Clean email body by stripping quoted reply history
   * Outlook replies include the full previous conversation with headers like:
   * "From: ...", "Sent: ...", "To: ...", "Subject: ..."
   */
  private cleanEmailBody(content: string, contentType: string): string {
    if (!content?.trim()) return content;

    let text = content;

    // Convert HTML to plain text if needed, then back to simple HTML
    if (contentType === 'html') {
      text = convert(content, {
        wordwrap: false,
        preserveNewlines: true,
        selectors: [
          { selector: 'a', options: { ignoreHref: true } },
          { selector: 'img', format: 'skip' },
        ],
      });
    }

    // Split into lines and find where the quoted reply starts
    const lines = text.split('\n');
    const cleanLines: string[] = [];

    for (let i = 0; i < lines.length; i++) {
      const trimmed = lines[i].trim();

      // Stop at common reply separators
      // "From: Name" line followed by "Sent: ..." pattern (Outlook style)
      if (trimmed.startsWith('From:') && i + 1 < lines.length && lines[i + 1].trim().startsWith('Sent:')) {
        break;
      }

      // "On <date>, <name> wrote:" pattern (Gmail style)
      if (/^On .+ wrote:$/.test(trimmed)) {
        break;
      }

      // Line of dashes separator (common in many clients)
      if (/^-{5,}/.test(trimmed) || /^_{5,}/.test(trimmed)) {
        break;
      }

      // Quoted lines starting with >
      if (trimmed.startsWith('>')) {
        break;
      }

      cleanLines.push(lines[i]);
    }

    const cleaned = cleanLines.join('\n').trimEnd();

    // Convert back to simple HTML with line breaks
    return cleaned.replace(/\n+/g, '<br>');
  }
}
