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

export interface PendingChannelData {
  name: string;
  description?: string;
  visibility: string;
  projectId: string;
  userId: string;
  workspaceId: string;
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

  async registerGraphWebhook(accessToken: string, webhookUrl: string): Promise<void> {
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
        resource: 'me/mailFolders/inbox/messages',
        expirationDateTime: expirationDateTime.toISOString(),
        clientState,
      }),
    });

    if (!response.ok) {
      const errorBody = await response.text();
      logger.error(`Failed to create Graph subscription: ${response.status} ${errorBody}`);
      throw new Error(`Graph subscription failed: ${response.status}`);
    }

    const result = (await response.json()) as GraphSubscriptionResponse;
    logger.info(`Graph webhook subscription created: ${result.id}, expires: ${result.expirationDateTime}`);
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
      throw new Error(`Microsoft account ${credentials.email} is already connected to channel "${channelName}"`);
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

      await tx.channelParticipant.create({
        data: {
          channelId: channel.id,
          userId: channelData.userId,
          role: 'ADMIN',
        },
      });

      const board = await tx.board.create({
        data: {
          name: channelData.name,
          projectId: channelData.projectId,
          workspaceId: channelData.workspaceId,
          createdBy: channelData.userId,
        },
      });

      await tx.stage.createMany({
        data: [
          { name: 'Open', sequenceNumber: 1, defaultTicketStatusV2: 'TODO' as const, boardId: board.id, createdBy: channelData.userId },
          { name: 'In Progress', sequenceNumber: 2, defaultTicketStatusV2: 'STARTED' as const, boardId: board.id, createdBy: channelData.userId },
          { name: 'Completed', sequenceNumber: 3, defaultTicketStatusV2: 'COMPLETED' as const, boardId: board.id, createdBy: channelData.userId },
        ],
      });

      await tx.externalSource.create({
        data: {
          name: sourceName,
          sourceType: 'microsoft',
          displayName: `Microsoft (${credentials.email})`,
          channelId: channel.id,
          boardId: board.id,
          credentials: encryptedCredentials,
          isActive: true,
        },
      });

      await this.registerGraphWebhook(credentials.accessToken, webhookUrl);

      return channel.id;
    });

    return { channelId };
  }

  // ─── Email Send/Reply ───

  /**
   * Create an email sender from encrypted credentials stored in ExternalSource.
   * Returns an object with send/reply methods and auto token refresh.
   */
  static createEmailSender(encryptedCredentials: string, sourceId: string) {
    const credentials = JSON.parse(decrypt(encryptedCredentials)) as MicrosoftCredentials;
    const externalSourceRepo = new ExternalSourceRepository();

    const formatRecipients = (emails: string[]) =>
      emails.map(email => ({ emailAddress: { address: email } }));

    const getAccessToken = async (): Promise<string> => {
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
      }): Promise<{ threadId: string }> {
        const { content, subject, to, cc, bcc, latestExternalMessageId } = params;
        const accessToken = await getAccessToken();

        // Find Graph message ID by internetMessageId
        const searchResponse = await fetch(
          `${config.microsoftGraph.baseUrl}/me/messages?$filter=internetMessageId eq '${encodeURIComponent(latestExternalMessageId)}'&$select=id`,
          { headers: { Authorization: `Bearer ${accessToken}` } }
        );

        let graphMessageId: string | null = null;
        if (searchResponse.ok) {
          const result = (await searchResponse.json()) as { value: Array<{ id: string }> };
          graphMessageId = result.value?.[0]?.id || null;
        }

        if (graphMessageId) {
          // Reply to existing thread
          const payload = {
            message: {
              toRecipients: formatRecipients(to),
              ...(cc && cc.length > 0 && { ccRecipients: formatRecipients(cc) }),
              ...(bcc && bcc.length > 0 && { bccRecipients: formatRecipients(bcc) }),
            },
            comment: content,
          };

          const response = await fetch(
            `${config.microsoftGraph.baseUrl}/me/messages/${graphMessageId}/reply`,
            {
              method: 'POST',
              headers: {
                Authorization: `Bearer ${accessToken}`,
                'Content-Type': 'application/json',
              },
              body: JSON.stringify(payload),
            }
          );

          if (!response.ok) {
            const errorBody = await response.text();
            logger.error(`Microsoft reply failed: ${response.status} ${errorBody}`);
            throw new Error(`Failed to send reply: ${response.status}`);
          }

          logger.info(`Microsoft reply sent to message ${graphMessageId}`);
          return { threadId: `reply-${Date.now()}` };
        }

        // Fallback: send as new email
        const payload = {
          message: {
            subject: `Re: ${subject}`,
            body: { contentType: 'html', content },
            toRecipients: formatRecipients(to),
            ...(cc && cc.length > 0 && { ccRecipients: formatRecipients(cc) }),
            ...(bcc && bcc.length > 0 && { bccRecipients: formatRecipients(bcc) }),
          },
          saveToSentItems: true,
        };

        const response = await fetch(`${config.microsoftGraph.baseUrl}/me/sendMail`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(payload),
        });

        if (!response.ok) {
          const errorBody = await response.text();
          logger.error(`Microsoft sendMail failed: ${response.status} ${errorBody}`);
          throw new Error(`Failed to send email: ${response.status}`);
        }

        logger.info('Microsoft email sent successfully');
        return { threadId: `sent-${Date.now()}` };
      },
    };
  }
}

export const microsoftDeskService = new MicrosoftDeskService();
