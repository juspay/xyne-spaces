/**
 * Microsoft Graph transformer
 * Converts enriched Graph notification (with fetched emails) to NormalizedData
 */

import { BaseTransformer } from '../../core/baseTransformer';
import { NormalizedData, ParseResult } from '../../core/types';
import { GraphMailMessage } from './types';
import { logger } from '@/utils/logger';
import { cleanEmailBodyHtml, cleanEmailBodyText } from '@/utils/contentUtils';
import { normalizeRfcMessageId, normalizeRfcMessageIds } from '@/utils/emailRfcMessageId';

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

      const rfcMessageId = normalizeRfcMessageId(email.internetMessageId);

      const normalized: NormalizedData = {
        externalId: email.internetMessageId || email.id,
        externalThreadId: email.conversationId,
        ...(rfcMessageId && { rfcMessageId }),

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

      const getHeader = (name: string) =>
        email.internetMessageHeaders?.find(
          h => h.name.toLowerCase() === name.toLowerCase(),
        )?.value;
      const rawRefs = getHeader('References')?.split(/\s+/).filter(Boolean) ?? [];
      const inReplyTo = getHeader('In-Reply-To')?.trim();
      if (inReplyTo) rawRefs.push(inReplyTo);
      const cleaned = normalizeRfcMessageIds(rawRefs);
      if (cleaned.length > 0) normalized.referencedMessageIds = cleaned;

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
   */
  private cleanEmailBody(content: string, contentType: string): string {
    if (!content?.trim()) return content;
    if (contentType === 'html') return cleanEmailBodyHtml(content);
    return cleanEmailBodyText(content);
  }
}
