/**
 * Microsoft Desk Service
 * Handles OAuth, external source creation, Graph webhook subscription,
 * and email send/reply via Microsoft Graph API.
 */

import crypto from 'crypto';
import { AuthorizationCode } from 'simple-oauth2';
import { logger } from '../utils/logger';
import { decrypt, encrypt } from './encryptionService';
import { redisService } from './redisService';
import { db } from '../database/client';
import { config } from '../config/env';
import { ExternalSourceRepository } from '../database/repositories/externalSourceRepository';
import { AttachmentUploadError } from '../integrations/core/baseMailReplySender';

export interface PendingChannelData {
  name: string;
  description?: string;
  visibility: string;
  projectId: string;
  userId: string;
  workspaceId: string;
  assigneeUserGroupId?: string;
}

interface MicrosoftCredentials {
  accessToken: string;
  refreshToken?: string;
  email: string;
  expiresAt?: string;
}

interface GraphSubscriptionResponse {
  id: string;
  expirationDateTime: string;
}

const PENDING_CHANNEL_TTL = 600; // 10 minutes
const PENDING_CHANNEL_PREFIX = 'email_channel:';
const GRAPH_SUBSCRIPTION_MAX_MINUTES = 4230; // ~3 days

function extractGraphErrorMessage(rawBody: string): string {
  try {
    const parsed = JSON.parse(rawBody) as { error?: { message?: string } };
    if (parsed?.error?.message) return parsed.error.message;
  } catch {
    /* not JSON — fall through */
  }
  return rawBody;
}

export class MicrosoftDeskService {
  private oauthClient: AuthorizationCode | undefined;

  constructor() {
    const clientId = process.env.MICROSOFT_CLIENT_ID;
    const clientSecret = process.env.MICROSOFT_CLIENT_SECRET;
    const tenantId = process.env.MICROSOFT_TENANT_ID || 'common';

    if (clientId && clientSecret) {
      this.oauthClient = new AuthorizationCode({
        client: { id: clientId, secret: clientSecret },
        auth: {
          authorizeHost: 'https://login.microsoftonline.com',
          authorizePath: `/${tenantId}/oauth2/v2.0/authorize`,
          tokenHost: 'https://login.microsoftonline.com',
          tokenPath: `/${tenantId}/oauth2/v2.0/token`,
        },
        options: { authorizationMethod: 'body' },
      });
    } else {
      logger.info('Microsoft OAuth not configured for desk service');
    }
  }

  // ─── OAuth ───

  getOAuthClient() {
    return this.oauthClient;
  }

  generateState(): string {
    return crypto.randomBytes(32).toString('base64url');
  }

  async storePendingChannel(state: string, data: PendingChannelData): Promise<void> {
    await redisService.set(
      `${PENDING_CHANNEL_PREFIX}${state}`,
      JSON.stringify(data),
      PENDING_CHANNEL_TTL
    );
  }

  async getPendingChannel(state: string): Promise<PendingChannelData | null> {
    const key = `${PENDING_CHANNEL_PREFIX}${state}`;
    const data = await redisService.get(key);
    if (!data) return null;
    await redisService.del(key);
    return JSON.parse(data) as PendingChannelData;
  }

  async resolveEmail(accessToken: string, idToken?: string): Promise<string | null> {
    const graphResponse = await fetch(`${config.microsoftGraph.baseUrl}/me`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    if (graphResponse.ok) {
      const profile = (await graphResponse.json()) as { mail?: string; userPrincipalName?: string };
      const email = profile.mail || profile.userPrincipalName;
      if (email?.includes('@')) return email;
    }

    if (idToken) {
      try {
        const payload = JSON.parse(Buffer.from(idToken.split('.')[1], 'base64').toString());
        const email = payload.email || payload.preferred_username;
        if (email?.includes('@')) return email;
      } catch {
        // ignore decode errors
      }
    }

    return null;
  }

  // ─── Webhook ───

  private async createMailSubscription(
    accessToken: string,
    webhookUrl: string,
    resource: string,
  ): Promise<GraphSubscriptionResponse> {
    const expirationDateTime = new Date();
    expirationDateTime.setMinutes(expirationDateTime.getMinutes() + GRAPH_SUBSCRIPTION_MAX_MINUTES);

    const clientState = crypto.randomBytes(16).toString('hex');

    const response = await fetch(`${config.microsoftGraph.baseUrl}/subscriptions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        changeType: 'created',
        notificationUrl: webhookUrl,
        resource,
        expirationDateTime: expirationDateTime.toISOString(),
        clientState,
      }),
    });

    if (!response.ok) {
      const errorBody = await response.text();
      logger.error(`Failed to create Graph subscription (${resource}): ${response.status} ${errorBody}`);
      throw new Error(`Graph subscription failed for ${resource}: ${response.status}`);
    }

    const result = (await response.json()) as GraphSubscriptionResponse;
    logger.info(`Graph subscription created for ${resource}: ${result.id}, expires: ${result.expirationDateTime}`);
    return result;
  }

  async registerGraphWebhook(accessToken: string, webhookUrl: string): Promise<void> {
    await this.createMailSubscription(accessToken, webhookUrl, 'me/mailFolders/inbox/messages');
    await this.createMailSubscription(accessToken, webhookUrl, 'me/mailFolders/sentitems/messages');
  }

  // ─── Channel Setup ───

  async createChannelAndSource(
    channelData: PendingChannelData,
    credentials: { accessToken: string; refreshToken?: string; email: string; expiresAt?: string },
    publicUrl: string,
  ): Promise<{ channelId: string }> {
    const safeEmail = credentials.email.replace('@', '--');
    const sourceName = `microsoft-${safeEmail}`;
    const encryptedCredentials = encrypt(JSON.stringify(credentials));
    const webhookUrl = `${publicUrl}/api/external-source-sync/${sourceName}/ingest`;

    // If this Microsoft account is already connected, update credentials and reuse the channel
    const existing = await db.externalSource.findUnique({ where: { name: sourceName } });
    if (existing) {
      const existingChannel = existing.channelId
        ? await db.channel.findUnique({ where: { id: existing.channelId }, select: { name: true } })
        : null;
      const channelName = existingChannel?.name || 'unknown';
      const err = new Error(
        `Microsoft account ${credentials.email} is already connected to channel "${channelName}"`,
      ) as Error & { existingChannelId?: string };
      if (existing.channelId) err.existingChannelId = existing.channelId;
      throw err;
    }

    // New connection — create everything in a transaction
    const channelId = await db.$transaction(async (tx) => {
      const channel = await tx.channel.create({
        data: {
          scopeType: 'DEFAULT',
          name: channelData.name,
          description: channelData.description,
          visibility: channelData.visibility === 'private' ? 'PRIVATE' : 'PUBLIC',
          createdBy: channelData.userId,
          workspaceId: channelData.workspaceId,
          projectId: channelData.projectId,
          type: 'EMAIL',
        },
      });

      const now = new Date();

      await tx.channelParticipant.create({
        data: {
          channelId: channel.id,
          userId: channelData.userId,
          role: 'ADMIN',
        },
      });

      await tx.channelUserStatus.create({
        data: {
          channelId: channel.id,
          userId: channelData.userId,
          lastViewedAt: now,
          updatedAt: now,
        },
      });

      await tx.channelStats.create({
        data: {
          channelId: channel.id,
          lastActivityAt: now,
          participantCount: 1,
        },
      });

      // Reuse the project's default board (same pattern as Google) — no per-connection
      // board/stages creation. If the project has no boards yet, boardId stays null.
      const board = await tx.board.findFirst({
        where: { projectId: channelData.projectId },
        orderBy: { createdAt: 'asc' },
      });

      await tx.externalSource.create({
        data: {
          name: sourceName,
          sourceType: 'microsoft',
          displayName: `Microsoft (${credentials.email})`,
          channelId: channel.id,
          boardId: board?.id, // @deprecated - kept for backward compatibility
          credentials: encryptedCredentials,
          isActive: true,
          // Cursor intentionally left null — the caller triggers an initial refetch
          // which takes the no-cursor fallback path and writes the cursor via nextCursor,
          // so the latest messages are auto-imported on first connect.
        },
      });

      // Create EmailChannelPreference for owner tracking and boardId
      // Author for auto-created tickets & postprocess actions — same user who's
      // creating the channel (matches the other `createdBy` rows above).
      // Note: We create it directly in the transaction, bypassing repository validation
      // since we already know this is an EMAIL channel
      await tx.emailChannelPreference.create({
        data: {
          channelId: channel.id,
          ownerUserId: channelData.userId,
          ...(channelData.assigneeUserGroupId && { assigneeUserGroupId: channelData.assigneeUserGroupId }),
          ...(board?.id && { boardId: board.id }), // Save boardId to EmailChannelPreference (new location)
        },
      });

      await this.registerGraphWebhook(credentials.accessToken, webhookUrl);

      return channel.id;
    }, {
      maxWait: 10_000,
      timeout: 30_000,
    });

    return { channelId };
  }

  // ─── Email Send/Reply ───

  /**
   * Get a valid access token, refreshing if expired (5-min buffer).
   * Used by webhook preprocessing, email sending, and manual reload.
   */
  static async getValidAccessToken(encryptedCredentials: string, sourceId: string): Promise<string> {
    const credentials = JSON.parse(decrypt(encryptedCredentials)) as MicrosoftCredentials;
    const externalSourceRepo = new ExternalSourceRepository();

    // Check if token is still valid (with 5 min buffer)
    if (credentials.expiresAt) {
      const expiresAt = new Date(credentials.expiresAt);
      const now = new Date();
      now.setMinutes(now.getMinutes() + 5);
      if (expiresAt > now) return credentials.accessToken;
    }

    if (!credentials.refreshToken) {
      logger.warn('Microsoft token expired and no refresh token available');
      return credentials.accessToken;
    }

    logger.info('Microsoft access token expired, refreshing...');

    const clientId = process.env.MICROSOFT_CLIENT_ID;
    const clientSecret = process.env.MICROSOFT_CLIENT_SECRET;
    const tenantId = process.env.MICROSOFT_TENANT_ID || 'common';

    if (!clientId || !clientSecret) {
      throw new Error('MICROSOFT_CLIENT_ID and MICROSOFT_CLIENT_SECRET required for token refresh');
    }

    const response = await fetch(
      `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          client_id: clientId,
          client_secret: clientSecret,
          refresh_token: credentials.refreshToken,
          grant_type: 'refresh_token',
          scope: 'openid email offline_access Mail.Read Mail.Send Mail.ReadWrite',
        }),
      }
    );

    if (!response.ok) {
      const errorBody = await response.text();
      logger.error(`Token refresh failed: ${response.status} ${errorBody}`);
      throw new Error(`Token refresh failed: ${response.status}`);
    }

    const tokenData = (await response.json()) as {
      access_token: string;
      refresh_token?: string;
      expires_in: number;
    };

    credentials.accessToken = tokenData.access_token;
    if (tokenData.refresh_token) credentials.refreshToken = tokenData.refresh_token;
    credentials.expiresAt = new Date(Date.now() + tokenData.expires_in * 1000).toISOString();

    // Persist updated tokens to DB
    try {
      await externalSourceRepo.update(sourceId, {
        credentials: encrypt(JSON.stringify(credentials)),
      });
      logger.info('Microsoft tokens refreshed and persisted');
    } catch (error) {
      logger.warn('Failed to persist refreshed tokens:', error);
    }

    return credentials.accessToken;
  }


  private static async deleteDraft(accessToken: string, draftId: string): Promise<void> {
    try {
      const res = await fetch(`${config.microsoftGraph.baseUrl}/me/messages/${draftId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      if (!res.ok && res.status !== 404) {
        logger.warn(`Microsoft draft cleanup non-OK (${res.status}) for draft ${draftId}`);
      }
    } catch (err) {
      logger.warn(`Microsoft draft cleanup threw for draft ${draftId}: ${err instanceof Error ? err.message : err}`);
    }
  }

  private static async attachFileToDraft(
    accessToken: string,
    draftId: string,
    att: { name: string; contentType: string; content: Buffer | string },
  ): Promise<void> {
    const contentBytes = (
      Buffer.isBuffer(att.content) ? att.content : Buffer.from(att.content, 'utf8')
    ).toString('base64');

    const res = await fetch(
      `${config.microsoftGraph.baseUrl}/me/messages/${draftId}/attachments`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          '@odata.type': '#microsoft.graph.fileAttachment',
          name: att.name,
          contentType: att.contentType,
          contentBytes,
        }),
      },
    );
    if (!res.ok) {
      const errBody = await res.text();
      logger.error(`Microsoft attachment add failed (${res.status}) for ${att.name}: ${errBody}`);
      throw new Error(`${res.status}: ${extractGraphErrorMessage(errBody)}`);
    }
  }

  static createEmailSender(encryptedCredentials: string, sourceId: string) {
    const formatRecipients = (emails: string[]) =>
      emails.map(email => ({ emailAddress: { address: email } }));

    const getAccessToken = async (): Promise<string> => {
      return MicrosoftDeskService.getValidAccessToken(encryptedCredentials, sourceId);
    };

    return {
      /**
       * Reply to a conversation — handles Graph message ID lookup internally.
       */
      async replyToConversation(params: {
        content: string;
        subject: string;
        to: string[];
        cc?: string[];
        bcc?: string[];
        latestExternalMessageId: string;
        threadId: string;
        /** Optional inline attachments (e.g. an ICS calendar invite or user-uploaded files). */
        attachments?: Array<{ name: string; contentType: string; content: Buffer | string }>;
      }): Promise<{ threadId: string; messageId: string }> {
        const { content, subject, to, cc, bcc, latestExternalMessageId, threadId, attachments } = params;
        const accessToken = await getAccessToken();

        let graphMessageId: string | null = null;

        // 1. Primary: lookup by internetMessageId.
        const searchResponse = await fetch(
          `${config.microsoftGraph.baseUrl}/me/messages?$filter=internetMessageId eq '${encodeURIComponent(latestExternalMessageId)}'&$select=id`,
          { headers: { Authorization: `Bearer ${accessToken}` } }
        );
        if (searchResponse.ok) {
          const result = (await searchResponse.json()) as { value: Array<{ id: string }> };
          graphMessageId = result.value?.[0]?.id || null;
        }

        // 2. Fallback: look up any message in the conversation.
        if (!graphMessageId && threadId) {
          const conversationResponse = await fetch(
            `${config.microsoftGraph.baseUrl}/me/messages?$filter=conversationId eq '${encodeURIComponent(threadId)}'&$orderby=receivedDateTime desc&$top=1&$select=id`,
            { headers: { Authorization: `Bearer ${accessToken}` } }
          );
          if (conversationResponse.ok) {
            const result = (await conversationResponse.json()) as { value: Array<{ id: string }> };
            graphMessageId = result.value?.[0]?.id || null;
            if (graphMessageId) {
              logger.info(
                `Microsoft reply: resolved parent via conversationId fallback (latest internetMessageId not findable — likely the +-bug)`,
              );
            }
          }
        }

        if (!graphMessageId) {
          logger.warn(
            `Microsoft reply: could not resolve parent Graph message by internetMessageId or conversationId; sending as new email. latestExternalMessageId=${latestExternalMessageId} threadId=${threadId}`,
          );
        }

        if (graphMessageId) {
          // 1. Create a reply draft — draft.internetMessageId is stable
          //    from this point through send and into Sent Items.
          const createReplyResponse = await fetch(
            `${config.microsoftGraph.baseUrl}/me/messages/${graphMessageId}/createReply`,
            {
              method: 'POST',
              headers: {
                Authorization: `Bearer ${accessToken}`,
                'Content-Type': 'application/json',
              },
              body: JSON.stringify({
                message: {
                  toRecipients: formatRecipients(to),
                  ...(cc && cc.length > 0 && { ccRecipients: formatRecipients(cc) }),
                  ...(bcc && bcc.length > 0 && { bccRecipients: formatRecipients(bcc) }),
                },
                comment: content,
              }),
            }
          );

          if (!createReplyResponse.ok) {
            const errorBody = await createReplyResponse.text();
            logger.error(`Microsoft createReply failed: ${createReplyResponse.status} ${errorBody}`);
            throw new Error(`Failed to create reply draft: ${createReplyResponse.status}`);
          }

          const draft = (await createReplyResponse.json()) as {
            id: string;
            internetMessageId: string;
            conversationId: string;
          };

          if (attachments?.length) {
            const settled = await Promise.allSettled(
              attachments.map(att =>
                MicrosoftDeskService.attachFileToDraft(accessToken, draft.id, att),
              ),
            );
            const failedAttachments: Array<{ name: string; reason: string }> = [];
            settled.forEach((r, i) => {
              if (r.status === 'rejected') {
                const att = attachments[i];
                failedAttachments.push({
                  name: att?.name ?? `attachment-${i}`,
                  reason: r.reason instanceof Error ? r.reason.message : String(r.reason),
                });
              }
            });
            if (failedAttachments.length > 0) {
              await MicrosoftDeskService.deleteDraft(accessToken, draft.id);
              throw new AttachmentUploadError(failedAttachments);
            }
          }

          // 2. Send the draft.
          const sendResponse = await fetch(
            `${config.microsoftGraph.baseUrl}/me/messages/${draft.id}/send`,
            {
              method: 'POST',
              headers: { Authorization: `Bearer ${accessToken}` },
            }
          );

          if (!sendResponse.ok) {
            const errorBody = await sendResponse.text();
            logger.error(`Microsoft send draft failed: ${sendResponse.status} ${errorBody}`);
            throw new Error(`Failed to send reply: ${sendResponse.status}`);
          }

          logger.info(`Microsoft reply sent: ${draft.internetMessageId}`);
          return { threadId: draft.conversationId, messageId: draft.internetMessageId };
        }

        // Fallback: send as a new message. sendMail doesn't return the sent
        // message, so we look it up from Sent Items after sending to get the
        // real internetMessageId/conversationId for dedup.
        const sendMailPayload = {
          message: {
            subject: `Re: ${subject}`,
            body: { contentType: 'html', content },
            toRecipients: formatRecipients(to),
            ...(cc && cc.length > 0 && { ccRecipients: formatRecipients(cc) }),
            ...(bcc && bcc.length > 0 && { bccRecipients: formatRecipients(bcc) }),
          },
          saveToSentItems: true,
        };

        const sendMailResponse = await fetch(`${config.microsoftGraph.baseUrl}/me/sendMail`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(sendMailPayload),
        });

        if (!sendMailResponse.ok) {
          const errorBody = await sendMailResponse.text();
          logger.error(`Microsoft sendMail failed: ${sendMailResponse.status} ${errorBody}`);
          throw new Error(`Failed to send email: ${sendMailResponse.status}`);
        }

        const sentItemsResponse = await fetch(
          `${config.microsoftGraph.baseUrl}/me/mailFolders/sentitems/messages?$top=1&$orderby=sentDateTime desc&$select=internetMessageId,conversationId`,
          { headers: { Authorization: `Bearer ${accessToken}` } }
        );

        if (sentItemsResponse.ok) {
          const result = (await sentItemsResponse.json()) as {
            value: Array<{ internetMessageId: string; conversationId: string }>;
          };
          const sent = result.value?.[0];
          if (sent?.internetMessageId && sent?.conversationId) {
            logger.info(`Microsoft email sent successfully: ${sent.internetMessageId}`);
            return { threadId: sent.conversationId, messageId: sent.internetMessageId };
          }
        }

        logger.warn('Microsoft email sent but unable to resolve internetMessageId from sent items');
        throw new Error('Sent email but could not resolve message ID');
      },
    };
  }
}

export const microsoftDeskService = new MicrosoftDeskService();
