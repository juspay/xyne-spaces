/**
 * Google Gmail Service
 * Handles Gmail API interactions: message fetching, parsing, watch setup, and Pub/Sub config.
 */

import { google, gmail_v1 } from 'googleapis';
import { OAuth2Client } from 'google-auth-library';
import { PubSub } from '@google-cloud/pubsub';
import { decrypt, encrypt } from './encryptionService';
import { logger } from '@/utils/logger';
import { GmailMessageData, GmailAttachment, ParsedEmailData, GoogleCredentials } from '../integrations/adapters/google/types';
import { ExternalSourceRepository } from '@/database/repositories/externalSourceRepository';
import { ExternalSourcePlatform } from '@/integrations/core/types';

const TAG = '[GoogleService]';

export class GoogleService {
  private oauth2Client: OAuth2Client;
  private gmail: gmail_v1.Gmail;
  private credentials: GoogleCredentials;

  constructor(credentials: GoogleCredentials, _sourceId: string) {
    this.credentials = credentials;

    this.oauth2Client = new google.auth.OAuth2(
      process.env.GOOGLE_CLIENT_ID,
      process.env.GOOGLE_CLIENT_SECRET,
      process.env.GOOGLE_REDIRECT_URI
    ) as unknown as OAuth2Client;

    this.oauth2Client.setCredentials({
      access_token: credentials.accessToken,
      refresh_token: credentials.refreshToken,
    });

    this.gmail = google.gmail({ version: 'v1', auth: this.oauth2Client as any });
  }

  static fromEncryptedCredentials(encryptedCredentials: string, sourceId: string): GoogleService {
    const credentials = JSON.parse(decrypt(encryptedCredentials)) as GoogleCredentials;
    return new GoogleService(credentials, sourceId);
  }

  getUserEmail(): string {
    return this.credentials.email;
  }

  // ---------------------------------------------------------------------------
  // Gmail API — Messages
  // ---------------------------------------------------------------------------

  async getMessageById(messageId: string): Promise<GmailMessageData | null> {
    try {
      const response = await this.gmail.users.messages.get({
        userId: 'me',
        id: messageId,
        format: 'full',
      });
      return response.data as GmailMessageData;
    } catch (error: any) {
      logger.error(`${TAG} Failed to fetch message ${messageId}:`, error);
      throw new Error(`Failed to fetch Gmail message: ${error.message}`);
    }
  }

  async getAttachment(messageId: string, attachmentId: string): Promise<string | null> {
    try {
      const response = await this.gmail.users.messages.attachments.get({
        userId: 'me',
        messageId,
        id: attachmentId,
      });
      return response.data.data || null;
    } catch (error: any) {
      logger.error(`${TAG} Failed to fetch attachment ${attachmentId}:`, error);
      return null;
    }
  }

  async listMessagesFromHistory(startHistoryId: string): Promise<string[]> {
    try {
      const response = await this.gmail.users.history.list({
        userId: 'me',
        startHistoryId,
        historyTypes: ['messageAdded'],
      });

      const ids: string[] = [];
      for (const record of response.data.history || []) {
        for (const msg of record.messagesAdded || []) {
          if (msg.message?.id) ids.push(msg.message.id);
        }
      }
      return ids;
    } catch (error: any) {
      logger.error(`${TAG} Failed to fetch history:`, error);
      throw new Error(`Failed to fetch Gmail history: ${error.message}`);
    }
  }

  async listRecentMessages(maxResults = 10): Promise<string[]> {
    try {
      const response = await this.gmail.users.messages.list({
        userId: 'me',
        maxResults,
        labelIds: ['INBOX'],
      });

      return (response.data.messages || [])
        .map(msg => msg.id)
        .filter((id): id is string => !!id);
    } catch (error: any) {
      logger.error(`${TAG} Failed to fetch recent messages:`, error);
      throw new Error(`Failed to fetch recent messages: ${error.message}`);
    }
  }

  // ---------------------------------------------------------------------------
  // Gmail API — Watch
  // ---------------------------------------------------------------------------

  async setupGmailWatch(): Promise<{ historyId: string; expiration: string }> {
    try {
      const topicName = process.env.GOOGLE_PUBSUB_TOPIC;
      if (!topicName) throw new Error('GOOGLE_PUBSUB_TOPIC env variable is not set');

      const response = await this.gmail.users.watch({
        userId: 'me',
        requestBody: { topicName, labelIds: ['INBOX'] },
      });

      const { historyId, expiration } = response.data;
      if (!historyId || !expiration) {
        throw new Error('Missing historyId or expiration in watch response');
      }

      logger.info(`${TAG} Gmail watch setup`, {
        historyId,
        expiration: new Date(parseInt(expiration)).toISOString(),
      });

      return {
        historyId,
        expiration: new Date(parseInt(expiration)).toISOString(),
      };
    } catch (error: any) {
      logger.error(`${TAG} Failed to setup Gmail watch:`, error);
      throw new Error(`Failed to setup Gmail watch: ${error.message}`);
    }
  }

  async renewGmailWatch(): Promise<{ historyId: string; expiration: string }> {
    return this.setupGmailWatch();
  }

  // ---------------------------------------------------------------------------
  // Email Parsing
  // ---------------------------------------------------------------------------

  parseEmailData(messageData: GmailMessageData): ParsedEmailData {
    const headers = messageData.payload?.headers || [];

    const getHeader = (name: string): string | undefined =>
      headers.find(h => h.name.toLowerCase() === name.toLowerCase())?.value;

    const parseEmailList = (value: string | undefined): string[] => {
      if (!value) return [];
      return value
        .split(',')
        .map(entry => {
          const match = entry.match(/<(.+?)>/) || entry.match(/([^\s<>]+@[^\s<>]+)/);
          return match ? match[1].trim() : entry.trim();
        })
        .filter(e => e.includes('@'));
    };

    const { textBody, htmlBody } = this.extractBody(messageData.payload);

    return {
      messageId: messageData.id,
      threadId: messageData.threadId,
      subject: getHeader('Subject'),
      from: getHeader('From'),
      to: parseEmailList(getHeader('To')),
      cc: parseEmailList(getHeader('Cc')),
      bcc: parseEmailList(getHeader('Bcc')),
      replyTo: parseEmailList(getHeader('Reply-To')),
      date: getHeader('Date'),
      textBody,
      htmlBody,
      body: htmlBody || textBody,
      attachments: this.extractAttachments(messageData.payload),
      inReplyTo: getHeader('In-Reply-To'),
      references: getHeader('References')?.split(/\s+/) || [],
    };
  }

  private extractBody(payload: any): { textBody?: string; htmlBody?: string } {
    let textBody: string | undefined;
    let htmlBody: string | undefined;

    const walk = (part: any): void => {
      if (part.mimeType === 'text/plain' && part.body?.data) {
        textBody = this.decodeBase64Url(part.body.data);
      } else if (part.mimeType === 'text/html' && part.body?.data) {
        htmlBody = this.decodeBase64Url(part.body.data);
      }
      part.parts?.forEach(walk);
    };

    // Body may live directly on the payload or nested in parts
    if (payload?.body?.data) {
      walk(payload);
    }
    payload?.parts?.forEach(walk);

    return { textBody, htmlBody };
  }

  private extractAttachments(payload: any): GmailAttachment[] {
    const attachments: GmailAttachment[] = [];

    const walk = (part: any): void => {
      if (part.filename && part.body?.attachmentId) {
        attachments.push({
          attachmentId: part.body.attachmentId,
          filename: part.filename,
          mimeType: part.mimeType || 'application/octet-stream',
          size: part.body.size || 0,
        });
      }
      part.parts?.forEach(walk);
    };

    payload?.parts?.forEach(walk);
    return attachments;
  }

  private decodeBase64Url(data: string): string {
    try {
      const base64 = data.replace(/-/g, '+').replace(/_/g, '/');
      const padded = base64.padEnd(base64.length + ((4 - (base64.length % 4)) % 4), '=');
      return Buffer.from(padded, 'base64').toString('utf-8');
    } catch {
      logger.error(`${TAG} Failed to decode base64url data`);
      return '';
    }
  }

  // ---------------------------------------------------------------------------
  // Static — ExternalSource & Pub/Sub Setup
  // ---------------------------------------------------------------------------

  static async setupExternalSource(params: {
    channelId: string;
    emailAddress: string;
    accessToken: string;
    refreshToken: string;
    boardId?: string;
  }): Promise<{
    sourceName: string;
    webhookUrl: string;
    historyId: string;
    expiration: string;
    subscriptionName: string;
  }> {
    const { channelId, emailAddress, accessToken, refreshToken, boardId } = params;

    const username = emailAddress.split('@')[0].replace(/[^a-zA-Z0-9-_]/g, '-');
    const sourceName = `google-${username}`;

    const credentials: GoogleCredentials = { accessToken, refreshToken, email: emailAddress };
    const encryptedCredentials = encrypt(JSON.stringify(credentials));

    // Setup Gmail watch
    const tempService = new GoogleService(credentials, 'temp');
    const watchResult = await tempService.setupGmailWatch();

    // Setup Pub/Sub subscription
    const repo = new ExternalSourceRepository();
    const existing = await repo.findByName(sourceName);
    const webhookUrl = GoogleService.generateWebhookUrl(sourceName);
    const subscriptionName = await GoogleService.setupPubSubSubscription(sourceName, webhookUrl);

    // Upsert ExternalSource
    if (existing) {
      await repo.update(existing.id, {
        credentials: encryptedCredentials,
        channelId,
        boardId: boardId || (existing.boardId ?? undefined),
        displayName: emailAddress,
      });
    } else {
      await repo.create({
        name: sourceName,
        sourceType: ExternalSourcePlatform.GOOGLE,
        credentials: encryptedCredentials,
        channelId,
        boardId: boardId ?? undefined,
        displayName: emailAddress,
      });
    }

    logger.info(`${TAG} ExternalSource setup complete`, { sourceName, webhookUrl });

    return {
      sourceName,
      webhookUrl,
      historyId: watchResult.historyId,
      expiration: watchResult.expiration,
      subscriptionName,
    };
  }

  static async setupPubSubSubscription(sourceName: string, webhookUrl: string): Promise<string> {
    const pubsub = new PubSub({
      projectId: process.env.GOOGLE_CLOUD_PROJECT_ID,
      keyFilename: process.env.GOOGLE_APPLICATION_CREDENTIALS,
    });

    const topicName = process.env.GOOGLE_PUBSUB_TOPIC || 'gmail-notifications';
    const subscriptionName = `gmail-${sourceName}-push`;

    const topic = pubsub.topic(topicName);
    const subscription = topic.subscription(subscriptionName);
    const [exists] = await subscription.exists();

    const pushConfig = {
      pushEndpoint: webhookUrl,
      oidcToken: {
        serviceAccountEmail: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL || '',
        audience: webhookUrl,
      },
    };

    if (exists) {
      await subscription.modifyPushConfig(pushConfig);
      logger.info(`${TAG} Pub/Sub subscription updated`, { subscriptionName });
    } else {
      await topic.createSubscription(subscriptionName, { pushConfig, ackDeadlineSeconds: 600 });
      logger.info(`${TAG} Pub/Sub subscription created`, { subscriptionName });
    }

    return subscriptionName;
  }

  static generateWebhookUrl(sourceName: string): string {
    const baseUrl = process.env.BACKEND_URL || 'http://localhost:3000';
    return `${baseUrl}/api/external-source-sync/${sourceName}/ingest`;
  }
}
