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
import { decrypt } from '@/services/encryptionService';
import { config } from '@/config/env';
import { logger } from '@/utils/logger';
import { GraphChangeNotification, GraphMailMessage } from './types';

const GRAPH_MESSAGE_FIELDS = [
  'id', 'subject', 'body', 'bodyPreview', 'from',
  'toRecipients', 'ccRecipients', 'bccRecipients', 'replyTo',
  'conversationId', 'internetMessageId', 'receivedDateTime',
  'hasAttachments', 'parentFolderId',
].join(',');

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

    // Get access token from stored credentials
    const credentials = JSON.parse(decrypt(source.credentials));
    const accessToken = credentials.accessToken;
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

    const response = await fetch(
      `${config.microsoftGraph.baseUrl}/me/messages/${messageId}?$select=${GRAPH_MESSAGE_FIELDS}`,
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );

    if (!response.ok) {
      throw new Error(`Failed to fetch message ${messageId}: ${response.status}`);
    }

    const email = (await response.json()) as GraphMailMessage;
    return { notification, emails: [email] };
  }
}
