/**
 * Google Gmail Transformer
 * Converts parsed Gmail data to platform-agnostic NormalizedData.
 */

import { BaseTransformer } from '../../core/baseTransformer';
import { NormalizedData, ParseResult } from '../../core/types';
import { ParsedEmailData } from './types';
import { cleanEmailBodyHtml, cleanEmailBodyText } from '@/utils/contentUtils';
import { normalizeRfcMessageId, normalizeRfcMessageIds } from '@/utils/emailRfcMessageId';

export class GoogleTransformer extends BaseTransformer<any, NormalizedData> {
  async transform(rawPayload: any): Promise<ParseResult<NormalizedData>> {
    try {
      const email = rawPayload?.parsedEmail as ParsedEmailData | undefined;
      if (!email?.messageId || !email?.threadId) {
        return { success: false, error: 'Invalid payload: missing parsedEmail data' };
      }

      // Webhook path carries mailbox historyId in pubsubData; refetch path omits it.
      // Postprocessor reads this to advance ExternalSource.lastSyncCursor.
      const historyId = rawPayload?.pubsubData?.historyId;
      const syncCursor = typeof historyId === 'string' && /^\d+$/.test(historyId)
        ? historyId
        : undefined;

      const preDownloadedAttachments = rawPayload?.preDownloadedAttachments as
        NormalizedData['preDownloadedAttachments']
        | undefined;

      const refs = normalizeRfcMessageIds([
        ...(email.references ?? []),
        ...(email.inReplyTo ? [email.inReplyTo] : []),
      ]);
      const rfcMessageId = normalizeRfcMessageId(email.rfcMessageId);

      const normalized: NormalizedData = {
        externalId: email.messageId,
        externalThreadId: email.threadId,
        externalParentId: this.extractAngleBracket(email.inReplyTo),
        ...(rfcMessageId && { rfcMessageId }),
        ...(refs.length > 0 && { referencedMessageIds: [...new Set(refs)] }),
        author: this.extractAuthor(email.from),
        content: this.formatContent(email),
        attachments: email.attachments?.map(att => ({
          fileName: att.filename,
          fileUrl: '',
          mimeType: att.mimeType,
          size: att.size,
          ...(att.contentId && { contentId: att.contentId }),
          metadata: {
            gmailAttachmentId: att.attachmentId,
            ...(att.contentId && { contentId: att.contentId }),
          },
        })),
        ...(preDownloadedAttachments && preDownloadedAttachments.length > 0 && {
          preDownloadedAttachments,
        }),
        emailData: {
          subject: email.subject,
          to: email.to || [],
          from: email.from || '',
          cc: email.cc || [],
          bcc: email.bcc || [],
          replyTo: email.replyTo || [],
        },
        metadata: {
          eventType: 'email.received',
          timestamp: email.date ? new Date(email.date) : new Date(),
          fromEmailAddress: email.from,
          hasAttachments: (email.attachments?.length ?? 0) > 0,
          ...(syncCursor && { syncCursor }),
        },
      };

      return { success: true, data: normalized };
    } catch (error) {
      return {
        success: false,
        error: `Parse error: ${error instanceof Error ? error.message : 'Unknown error'}`,
      };
    }
  }

  /** Extract name and email from "Name <email@domain.com>" format */
  private extractAuthor(from?: string): { name: string; email?: string } {
    if (!from) return { name: 'Unknown' };

    const email = this.extractAngleBracket(from) ?? (from.includes('@') ? from.trim() : undefined);
    const nameMatch = from.match(/^(.*?)\s*</);
    const name = nameMatch?.[1]?.trim() || undefined;

    return { name: name || email || 'Unknown', email };
  }

  /** Prefer HTML body, fall back to text, convert plain text newlines to <br> */
  private formatContent(email: ParsedEmailData): string {
    if (email.htmlBody) return cleanEmailBodyHtml(email.htmlBody);
    if (email.textBody) return cleanEmailBodyText(email.textBody);
    return email.body?.trim() || '';
  }

  /** Extract content from angle brackets: "<value>" → "value" */
  private extractAngleBracket(value?: string): string | undefined {
    if (!value) return undefined;
    return value.match(/<(.+?)>/)?.[1] ?? value;
  }
}
