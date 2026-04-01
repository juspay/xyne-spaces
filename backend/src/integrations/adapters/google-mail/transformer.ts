import { convert } from 'html-to-text';
import { BaseTransformer } from '../../core/baseTransformer';
import type { NormalizedData, ParseResult } from '../../core/types';
import { parseEmailBody } from './quote-parser';
import type { GoogleMailPreprocessedPayload } from './types';
import { extractEntityTags, isExtractedEntityTagsEmpty } from '@/services/entityTagExtractor';
import { logger } from '@/utils/logger';

const gmailTransformerLogger = logger.child({ module: 'google-mail-transformer' });

const extractEmailAddresses = (headerValue: string): string[] => {
  if (!headerValue) {
    return [];
  }

  return headerValue
    .split(',')
    .map(value => value.trim())
    .filter(Boolean)
    .map(value => {
      const match = value.match(/<([^>]+)>/);
      return (match?.[1] || value).trim().toLowerCase();
    });
};

export class GoogleMailTransformer extends BaseTransformer<
  GoogleMailPreprocessedPayload,
  NormalizedData
> {
  async transform(
    rawPayload: GoogleMailPreprocessedPayload
  ): Promise<ParseResult<NormalizedData>> {
    try {
      const { message, bodyHtml, downloadedAttachments } = rawPayload;
      const payload = message.payload;
      const headers = payload?.headers || [];

      const getHeader = (name: string): string => {
        const header = headers.find(item => item.name?.toLowerCase() === name.toLowerCase());
        return header?.value || '';
      };

      const fromAddresses = extractEmailAddresses(getHeader('From'));
      const fromAddress = fromAddresses[0];
      if (!fromAddress) {
        return {
          success: false,
          error: `Gmail message ${message.id || 'unknown'} is missing a From address`,
        };
      }

      const to = extractEmailAddresses(getHeader('To') || getHeader('Delivered-To'));
      const cc = extractEmailAddresses(getHeader('Cc'));
      const bcc = extractEmailAddresses(getHeader('Bcc'));
      const replyTo = extractEmailAddresses(getHeader('Reply-To'));
      const subject = getHeader('Subject') || '(no subject)';
      const references = getHeader('References');
      const inReplyTo = getHeader('In-Reply-To');
      const dateHeader = getHeader('Date');
      const messageIdHeader = getHeader('Message-Id').replace(/^<|>$/g, '');
      const externalId = message.id || messageIdHeader;
      const externalThreadId = message.threadId || messageIdHeader;

      if (!externalId || !externalThreadId) {
        return {
          success: false,
          error: 'Gmail message is missing stable message/thread identifiers',
        };
      }

      const timestamp = dateHeader
        ? new Date(dateHeader)
        : new Date(parseInt(message.internalDate || '0', 10) || Date.now());

      const entityTagSourceText = [
        subject,
        parseEmailBody(
          convert(bodyHtml || '', {
            wordwrap: false,
          })
        ),
      ]
        .map(value => value.trim())
        .filter(Boolean)
        .join('\n\n')
        .slice(0, 8000);

      let entityTags = undefined;
      if (entityTagSourceText) {
        try {
          const extractedEntityTags = await extractEntityTags(entityTagSourceText);
          if (!isExtractedEntityTagsEmpty(extractedEntityTags)) {
            entityTags = extractedEntityTags;
          }
        } catch (error) {
          gmailTransformerLogger.warn('[GOOGLE_MAIL] Failed to extract entity tags', {
            messageId: externalId,
            threadId: externalThreadId,
            error: error instanceof Error ? error.message : 'Unknown error',
          });
        }
      }

      const normalized: NormalizedData = {
        externalId,
        externalThreadId,
        externalParentId: inReplyTo ? inReplyTo.replace(/^<|>$/g, '') : undefined,
        author: {
          name: fromAddress,
          email: fromAddress,
          externalId: messageIdHeader || message.id || undefined,
        },
        content: bodyHtml,
        downloadedAttachments,
        emailData: {
          subject,
          to,
          from: fromAddress,
          cc,
          bcc,
          replyTo,
        },
        metadata: {
          eventType: 'gmail.message',
          timestamp,
          messageIdHeader: messageIdHeader || undefined,
          threadId: message.threadId || undefined,
          labels: message.labelIds || [],
          isReply: Boolean(inReplyTo || references),
          allowOrphanThreadBootstrap: true,
          entityTags,
        },
      };

      return {
        success: true,
        data: normalized,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown Gmail transform error',
      };
    }
  }
}
