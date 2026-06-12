/**
 * Microsoft Graph flow
 * Handles preprocessing: fetches actual email content using stored tokens.
 * Graph webhooks only send notification IDs, not email content.
 *
 * Deduplication is handled by the reservation pattern in core.ts —
 * externalMessage is created with a unique constraint before the conversation,
 * so duplicate notifications are blocked at the DB level.
 */

import { ExternalSource } from '@prisma/client';
import { BaseFlow } from '../../core/baseFlow';
import { TestPayloadResult } from '../../core/types';
import { ExternalMessageRepository } from '@/database/repositories/externalMessageRepository';
import { MicrosoftDeskService } from '@/services/microsoftDeskService';
import { preDownloadGraphAttachments } from './attachments';
import { graphFetchWithRetry } from './graphFetch';
import { config } from '@/config/env';
import { logger } from '@/utils/logger';
import { GraphChangeNotification, GraphMailMessage } from './types';

const GRAPH_MESSAGE_FIELDS = [
  'id', 'subject', 'body', 'bodyPreview', 'from',
  'toRecipients', 'ccRecipients', 'bccRecipients', 'replyTo',
  'conversationId', 'internetMessageId', 'receivedDateTime',
  'hasAttachments', 'parentFolderId',
].join(',');

const externalMessageRepo = new ExternalMessageRepository();

export class MicrosoftFlow extends BaseFlow {
  /**
   * Handle webhook verification via ?validationToken query param.
   * Microsoft sends this during subscription setup to verify URL ownership.
   */
  isTestQueryParam(query: Record<string, string | undefined>): TestPayloadResult {
    if (query.validationToken) {
      return {
        isTest: true,
        response: {
          status: 200,
          body: query.validationToken,
        },
      };
    }
    return { isTest: false };
  }

  /**
   * Detect validation and lifecycle notifications that should be skipped.
   */
  isTestPayload(payload: any): TestPayloadResult {
    if (payload?.validationTokens && Array.isArray(payload.validationTokens)) {
      return {
        isTest: true,
        response: {
          status: 200,
          body: { success: true, skipped: true, reason: 'validation_request' },
        },
      };
    }

    if (!payload?.value || (Array.isArray(payload.value) && payload.value.length === 0)) {
      return {
        isTest: true,
        response: {
          status: 200,
          body: { success: true, skipped: true, reason: 'empty_notification' },
        },
      };
    }

    return { isTest: false };
  }

  /**
   * Fetch actual email content from Microsoft Graph API.
   * The webhook only provides a message ID — we need to call Graph API to get the full email.
   */
  async preprocess(rawPayload: any, source?: ExternalSource): Promise<any> {
    if (!source) {
      throw new Error('Microsoft flow: source not provided');
    }

    const notification = rawPayload as GraphChangeNotification;
    if (!notification.value || notification.value.length === 0) {
      throw new Error('No notification items');
    }

    // Get a valid (auto-refreshed) access token
    const accessToken = await MicrosoftDeskService.getValidAccessToken(source.credentials, source.id);
    if (!accessToken) {
      throw new Error('No access token in stored credentials');
    }

    // Process only the first created item
    const item = notification.value.find(v => v.changeType === 'created');
    if (!item) {
      throw new Error('No created items in notification');
    }

    const messageId = item.resourceData?.id;
    if (!messageId) {
      throw new Error('Notification missing resourceData.id');
    }

    logger.info(`Microsoft flow: fetching email ${messageId}`);

    const response = await graphFetchWithRetry(
      `${config.microsoftGraph.baseUrl}/me/messages/${messageId}?$select=${GRAPH_MESSAGE_FIELDS}`,
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );

    if (!response.ok) {
      throw new Error(`Failed to fetch message ${messageId}: ${response.status}`);
    }

    const email = (await response.json()) as GraphMailMessage;
    const lookupId = email.internetMessageId ?? email.id;
    
    const existing = await externalMessageRepo.findByExternalIds(source.id, [lookupId]);
    if (existing.length > 0) {
      // Only skip if this message was already ingested as INCOMING.
      // An OUTGOING record means WE sent this reply — other desks sharing
      // the same source may still need to receive it via resolveDlChannels.
      if (existing.some(e => e.direction === 'INCOMING')) {
        logger.info(`Microsoft flow: skipping already-ingested message ${lookupId}`);
        return { __skipIngestion: true, __skipReason: `duplicate-webhook:${lookupId}` };
      }
    }

    const credentials = source.credentials as { email?: string };
    const mailboxEmail = typeof credentials.email === 'string' ? credentials.email.toLowerCase() : undefined;
    const fromAddress = email.from?.emailAddress?.address?.toLowerCase();
    const isOutbound = !!mailboxEmail && !!fromAddress && fromAddress === mailboxEmail;

    if (isOutbound && email.conversationId) {
      const existingThread = await externalMessageRepo.findByThreadId(source.id, email.conversationId);
      if (!existingThread) {
        logger.info(
          `Microsoft flow: skipping outbound email with no existing thread (conversationId: ${email.conversationId})`
        );
        return { __skipIngestion: true, __skipReason: 'outbound-no-thread' };
      }
    }

    const preDownloadedAttachments = email.hasAttachments
      ? await preDownloadGraphAttachments({
          accessToken,
          graphMessageId: messageId,
          sourceName: source.name,
        })
      : [];

    return { notification, emails: [email], preDownloadedAttachments };
  }
}
