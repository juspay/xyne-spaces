/**
 * Google Gmail Service
 * Gmail API interactions: message fetching/parsing, watch setup, Pub/Sub config,
 * ExternalSource provisioning, and email sending with auto token refresh.
 */

import { google, gmail_v1 } from 'googleapis';
import { OAuth2Client } from 'google-auth-library';
import { PubSub } from '@google-cloud/pubsub';
import { decrypt, encrypt } from './encryptionService';
import { logger } from '@/utils/logger';
import {
  GmailMessageData,
  GmailAttachment,
  ParsedEmailData,
  GoogleCredentials,
} from '../integrations/adapters/google/types';
import { ExternalSourceRepository } from '@/database/repositories/externalSourceRepository';
import { ChannelRepository } from '@/database/repositories/channelRepository';
import { EmailChannelPreferenceRepository } from '@/database/repositories/emailChannelPreferenceRepository';
import { ExternalSourcePlatform } from '@/integrations/core/types';

// ─── Constants ──────────────────────────────────────────────────────────────

const TAG = '[GoogleService]';
const SOURCE_NAME_PREFIX = 'google-';
const DEFAULT_PUBSUB_TOPIC = 'gmail-notifications';
const PUBSUB_ACK_DEADLINE_SECONDS = 600;
const DEFAULT_BACKEND_URL = 'http://localhost:3000';

// ─── Types ──────────────────────────────────────────────────────────────────

interface ServiceAccountCredentials {
  client_email: string;
  private_key: string;
}

interface WatchResult {
  historyId: string;
  expiration: string;
}

interface SetupExternalSourceParams {
  channelId: string;
  emailAddress: string;
  accessToken: string;
  refreshToken: string;
  boardId?: string;
}

interface SetupExternalSourceResult {
  sourceName: string;
  webhookUrl: string;
  historyId: string;
  expiration: string;
  subscriptionName: string;
}

interface ReplyParams {
  content: string;
  subject: string;
  to: string[];
  cc?: string[];
  bcc?: string[];
  threadId: string;
  latestExternalMessageId: string;
  /** Optional file attachments (e.g. ICS calendar invite or user-uploaded files). */
  attachments?: Array<{ name: string; contentType: string; content: Buffer | string }>;
}

interface ReplyResult {
  threadId: string;
  messageId: string;
}

interface MimeOptions {
  from: string;
  to: string[];
  cc?: string[];
  bcc?: string[];
  subject: string;
  body: string;
  inReplyTo?: string;
  references?: string;
  attachments?: Array<{ name: string; contentType: string; content: Buffer | string }>;
}

// ─── Service ────────────────────────────────────────────────────────────────

export class GoogleService {
  private readonly oauth2Client: OAuth2Client;
  private readonly gmail: gmail_v1.Gmail;
  private readonly credentials: GoogleCredentials;

  constructor(credentials: GoogleCredentials) {
    this.credentials = credentials;
    this.oauth2Client = GoogleService.createOAuth2Client(credentials);
    this.gmail = google.gmail({ version: 'v1', auth: this.oauth2Client as any });
  }

  static fromEncryptedCredentials(encryptedCredentials: string, _sourceId: string): GoogleService {
    const credentials = JSON.parse(decrypt(encryptedCredentials)) as GoogleCredentials;
    return new GoogleService(credentials);
  }

  getUserEmail(): string {
    return this.credentials.email;
  }

  // ─── Gmail API — Messages ────────────────────────────────────────────────

  async getMessageById(messageId: string): Promise<GmailMessageData | null> {
    try {
      const response = await this.gmail.users.messages.get({
        userId: 'me',
        id: messageId,
        format: 'full',
      });
      return response.data as GmailMessageData;
    } catch (error) {
      logger.error(`${TAG} Failed to fetch message ${messageId}`, error);
      throw new Error(`Failed to fetch Gmail message: ${getErrorMessage(error)}`);
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
    } catch (error) {
      logger.error(`${TAG} Failed to fetch attachment ${attachmentId}`, error);
      return null;
    }
  }

  async listMessagesFromHistory(startHistoryId: string): Promise<string[]> {
    const { messageIds } = await this.listMessagesFromHistoryWithCursor(startHistoryId);
    return messageIds;
  }

  /**
   * Same as listMessagesFromHistory but also returns the latest historyId
   * reported by Gmail. Callers that persist a sync cursor (manual reload)
   * need this value to advance the watermark.
   */
  async listMessagesFromHistoryWithCursor(
    startHistoryId: string,
  ): Promise<{ messageIds: string[]; historyId: string | null }> {
    try {
      const response = await this.gmail.users.history.list({
        userId: 'me',
        startHistoryId,
        historyTypes: ['messageAdded'],
      });

      const messageIds: string[] = [];
      for (const record of response.data.history || []) {
        for (const msg of record.messagesAdded || []) {
          if (msg.message?.id) messageIds.push(msg.message.id);
        }
      }

      return {
        messageIds,
        historyId: response.data.historyId ?? null,
      };
    } catch (error) {
      logger.error(`${TAG} Failed to fetch history`, error);
      throw new Error(`Failed to fetch Gmail history: ${getErrorMessage(error)}`);
    }
  }

  /** Current mailbox historyId — used to seed the cursor when history is unavailable. */
  async getCurrentHistoryId(): Promise<string | null> {
    try {
      const response = await this.gmail.users.getProfile({ userId: 'me' });
      return response.data.historyId ?? null;
    } catch (error) {
      logger.warn(`${TAG} Failed to fetch current historyId`, error);
      return null;
    }
  }

  async listRecentMessages(
    count = 10,
    opts: { mode?: 'messages' | 'threads' } = {},
  ): Promise<string[]> {
    const mode = opts.mode ?? 'messages';
    try {
      if (mode === 'threads') {
        const threadList = await this.gmail.users.threads.list({
          userId: 'me',
          maxResults: count,
          labelIds: ['INBOX'],
        });
        const threadIds = (threadList.data.threads || [])
          .map(t => t.id)
          .filter((id): id is string => !!id);

        const messageIds: string[] = [];
        for (const threadId of threadIds) {
          const thread = await this.gmail.users.threads.get({
            userId: 'me',
            id: threadId,
            format: 'minimal',
          });
          for (const msg of thread.data.messages || []) {
            if (msg.id) messageIds.push(msg.id);
          }
        }
        return messageIds;
      }

      const response = await this.gmail.users.messages.list({
        userId: 'me',
        maxResults: count,
        labelIds: ['INBOX'],
      });
      return (response.data.messages || [])
        .map(msg => msg.id)
        .filter((id): id is string => !!id);
    } catch (error) {
      logger.error(`${TAG} Failed to fetch recent messages (mode=${mode})`, error);
      throw new Error(`Failed to fetch recent messages: ${getErrorMessage(error)}`);
    }
  }

  // ─── Gmail API — Watch ───────────────────────────────────────────────────

  async setupGmailWatch(): Promise<WatchResult> {
    const topicName = process.env.GOOGLE_PUBSUB_TOPIC;
    if (!topicName) throw new Error('GOOGLE_PUBSUB_TOPIC env variable is not set');

    try {
      const response = await this.gmail.users.watch({
        userId: 'me',
        requestBody: { topicName, labelIds: ['INBOX'] },
      });

      const { historyId, expiration } = response.data;
      if (!historyId || !expiration) {
        throw new Error('Missing historyId or expiration in watch response');
      }

      const expirationIso = new Date(parseInt(expiration)).toISOString();
      logger.info(`${TAG} Gmail watch setup`, { historyId, expiration: expirationIso });

      return { historyId, expiration: expirationIso };
    } catch (error) {
      logger.error(`${TAG} Failed to setup Gmail watch`, error);
      throw new Error(`Failed to setup Gmail watch: ${getErrorMessage(error)}`);
    }
  }

  async renewGmailWatch(): Promise<WatchResult> {
    return this.setupGmailWatch();
  }

  // ─── Email Parsing ───────────────────────────────────────────────────────

  parseEmailData(messageData: GmailMessageData): ParsedEmailData {
    const headers = messageData.payload?.headers || [];

    const getHeader = (name: string): string | undefined =>
      headers.find(h => h.name.toLowerCase() === name.toLowerCase())?.value;

    const { textBody, htmlBody } = GoogleService.extractBody(messageData.payload);

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
      attachments: GoogleService.extractAttachments(messageData.payload),
      inReplyTo: getHeader('In-Reply-To'),
      references: getHeader('References')?.split(/\s+/) || [],
    };
  }

  private static extractBody(payload: any): { textBody?: string; htmlBody?: string } {
    let textBody: string | undefined;
    let htmlBody: string | undefined;

    const walk = (part: any): void => {
      if (part.mimeType === 'text/plain' && part.body?.data) {
        textBody = decodeBase64Url(part.body.data);
      } else if (part.mimeType === 'text/html' && part.body?.data) {
        htmlBody = decodeBase64Url(part.body.data);
      }
      part.parts?.forEach(walk);
    };

    // Body may live directly on the payload or nested in parts
    if (payload?.body?.data) walk(payload);
    payload?.parts?.forEach(walk);

    return { textBody, htmlBody };
  }

  private static getHeader(part: any, name: string): string | undefined {
    const h = (part.headers as Array<{ name: string; value: string }> | undefined)?.find(
      x => x.name?.toLowerCase() === name.toLowerCase(),
    );
    return h?.value;
  }

  /**
   * Walk the Gmail payload tree once and collect every attachment-like part.
   * Yields a unified shape — `attachmentId` is set when bytes need a follow-up
   * Gmail API fetch; `data` is set when bytes are already inline on the part
   * (small `cid:`-referenced images). Exactly one of the two is set.
   */
  private static extractAttachments(payload: any): GmailAttachment[] {
    const attachments: GmailAttachment[] = [];

    const walk = (part: any): void => {
      const body = part?.body;
      if (body) {
        const rawCid = GoogleService.getHeader(part, 'Content-ID');
        // Strip optional surrounding angle brackets per RFC 2392. Tolerates
        // missing brackets, repeated brackets, and stray whitespace.
        const contentId = rawCid ? rawCid.trim().replace(/^<+|>+$/g, '').trim() : undefined;
        const filename =
          part.filename && part.filename.length > 0
            ? part.filename
            : contentId
              ? `inline-${contentId}`
              : `attachment-${part.partId ?? Math.random().toString(36).slice(2, 8)}`;
        const mimeType = part.mimeType || 'application/octet-stream';

        if (body.attachmentId) {
          attachments.push({
            attachmentId: body.attachmentId,
            filename,
            mimeType,
            size: body.size || 0,
            ...(contentId && { contentId }),
          });
        } else if (body.data && contentId && mimeType.toLowerCase().startsWith('image/')) {
          // Inline `cid:` image — decode base64url right here so the caller
          // gets bytes uniformly (no extra Gmail API call needed for these).
          try {
            const base64 = String(body.data).replace(/-/g, '+').replace(/_/g, '/');
            const padded = base64.padEnd(base64.length + ((4 - (base64.length % 4)) % 4), '=');
            attachments.push({
              data: Buffer.from(padded, 'base64'),
              filename,
              mimeType,
              size: body.size || 0,
              contentId,
            });
          } catch {
            /* skip malformed part */
          }
        }
      }
      part?.parts?.forEach(walk);
    };

    payload?.parts?.forEach(walk);
    return attachments;
  }

  // ─── ExternalSource + Pub/Sub provisioning ───────────────────────────────

  static async prepareExternalSourceNetwork(params: {
    emailAddress: string;
    accessToken: string;
    refreshToken: string;
  }): Promise<{
    sourceName: string;
    webhookUrl: string;
    subscriptionName: string;
    watchResult: WatchResult;
    encryptedCredentials: string;
  }> {
    const { emailAddress, accessToken, refreshToken } = params;
    const sourceName = GoogleService.getSourceName(emailAddress);
    const credentials: GoogleCredentials = { accessToken, refreshToken, email: emailAddress };
    const encryptedCredentials = encrypt(JSON.stringify(credentials));

    const watchResult = await new GoogleService(credentials).setupGmailWatch();
    const webhookUrl = GoogleService.generateWebhookUrl(sourceName);
    const subscriptionName = await GoogleService.setupPubSubSubscription(sourceName, webhookUrl);

    return { sourceName, webhookUrl, subscriptionName, watchResult, encryptedCredentials };
  }

  static async setupExternalSource(params: SetupExternalSourceParams): Promise<SetupExternalSourceResult> {
    const { channelId, emailAddress, accessToken, refreshToken, boardId } = params;

    const sourceName = GoogleService.getSourceName(emailAddress);
    const channel = await new ChannelRepository().findById(channelId);
    const credentials: GoogleCredentials = { accessToken, refreshToken, email: emailAddress };
    const encryptedCredentials = encrypt(JSON.stringify(credentials));

    const watchResult = await new GoogleService(credentials).setupGmailWatch();

    const webhookUrl = GoogleService.generateWebhookUrl(sourceName);
    const subscriptionName = await GoogleService.setupPubSubSubscription(sourceName, webhookUrl);

    const repo = new ExternalSourceRepository();
    const existing = await repo.findByName(sourceName);

    if (existing) {
      await repo.update(existing.id, {
        credentials: encryptedCredentials,
        channelId,
        boardId: boardId || (existing.boardId ?? undefined), // @deprecated - kept for backward compatibility
        displayName: emailAddress,
      });
    } else {
      await repo.create({
        name: sourceName,
        sourceType: ExternalSourcePlatform.GOOGLE,
        credentials: encryptedCredentials,
        channelId,
        boardId: boardId ?? undefined, // @deprecated - kept for backward compatibility
        displayName: emailAddress,
      });
    }

    // Create/update EmailChannelPreference for owner tracking and boardId
    const preferenceRepo = new EmailChannelPreferenceRepository();
    await preferenceRepo.upsert({
      channelId,
      ownerUserId: channel?.createdBy,
      boardId: boardId ?? undefined, // Save boardId to EmailChannelPreference (new location)
    });
    // Cursor intentionally left null — the caller triggers an initial core.reload()
    // which takes the no-cursor fallback (listRecentMessages) and writes the cursor
    // via nextCursor, so the first N messages are auto-imported.

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
    const credentials = GoogleService.loadPubSubServiceAccount();
    const pubsub = new PubSub({
      projectId: process.env.GOOGLE_CLOUD_PROJECT_ID,
      credentials,
    });

    const topicName = process.env.GOOGLE_PUBSUB_TOPIC || DEFAULT_PUBSUB_TOPIC;
    const subscriptionName = `gmail-${sourceName}-push`;

    const topic = pubsub.topic(topicName);
    const subscription = topic.subscription(subscriptionName);
    const [exists] = await subscription.exists();

    const pushConfig = {
      pushEndpoint: webhookUrl,
      oidcToken: {
        serviceAccountEmail: credentials.client_email,
        audience: webhookUrl,
      },
    };

    if (exists) {
      await subscription.modifyPushConfig(pushConfig);
      logger.info(`${TAG} Pub/Sub subscription updated`, { subscriptionName });
    } else {
      await topic.createSubscription(subscriptionName, {
        pushConfig,
        ackDeadlineSeconds: PUBSUB_ACK_DEADLINE_SECONDS,
      });
      logger.info(`${TAG} Pub/Sub subscription created`, { subscriptionName });
    }

    return subscriptionName;
  }

  static generateWebhookUrl(sourceName: string): string {
    const baseUrl = process.env.BACKEND_URL || DEFAULT_BACKEND_URL;
    return `${baseUrl}/api/external-source-sync/${sourceName}/ingest`;
  }

  static getSourceName(emailAddress: string): string {
    const username = emailAddress.split('@')[0].replace(/[^a-zA-Z0-9_-]/g, '-');
    return `${SOURCE_NAME_PREFIX}${username}`;
  }

  // ─── Email sender (reply) ────────────────────────────────────────────────

  /**
   * Create a Gmail email sender from encrypted credentials.
   * The googleapis OAuth2 client auto-refreshes expired access tokens via the
   * refresh token; the 'tokens' listener persists new tokens back to ExternalSource.
   */
  static createEmailSender(encryptedCredentials: string, sourceId: string) {
    const credentials = JSON.parse(decrypt(encryptedCredentials)) as GoogleCredentials;
    const externalSourceRepo = new ExternalSourceRepository();

    const oauth2Client = GoogleService.createOAuth2Client(credentials);
    oauth2Client.on('tokens', async tokens => {
      try {
        if (tokens.access_token) credentials.accessToken = tokens.access_token;
        if (tokens.refresh_token) credentials.refreshToken = tokens.refresh_token;
        await externalSourceRepo.update(sourceId, {
          credentials: encrypt(JSON.stringify(credentials)),
        });
        logger.info(`${TAG} Google tokens refreshed and persisted`, { sourceId });
      } catch (error) {
        logger.warn(`${TAG} Failed to persist refreshed Google tokens`, error);
      }
    });

    const gmail = google.gmail({ version: 'v1', auth: oauth2Client as any });

    return {
      async replyToConversation(params: ReplyParams): Promise<ReplyResult> {
        const { inReplyTo, references } = await fetchThreadingHeaders(gmail, params.latestExternalMessageId);

        const mime = await buildMimeMessage({
          from: credentials.email,
          to: params.to,
          cc: params.cc,
          bcc: params.bcc,
          subject: ensureReplyPrefix(params.subject),
          body: params.content,
          inReplyTo,
          references,
          ...(params.attachments && { attachments: params.attachments }),
        });

        const response = await gmail.users.messages.send({
          userId: 'me',
          requestBody: { raw: base64UrlEncode(mime), threadId: params.threadId },
        });

        const messageId = response.data.id || '';
        const threadId = response.data.threadId || params.threadId;

        logger.info(`${TAG} Gmail reply sent`, { messageId, threadId });
        return { messageId, threadId };
      },
    };
  }

  // ─── Private helpers ─────────────────────────────────────────────────────

  private static createOAuth2Client(credentials: GoogleCredentials): OAuth2Client {
    const client = new google.auth.OAuth2(
      process.env.GOOGLE_CLIENT_ID,
      process.env.GOOGLE_CLIENT_SECRET,
      process.env.GOOGLE_REDIRECT_URI,
    ) as unknown as OAuth2Client;

    client.setCredentials({
      access_token: credentials.accessToken,
      refresh_token: credentials.refreshToken,
    });

    return client;
  }

  private static loadPubSubServiceAccount(): ServiceAccountCredentials {
    const base64Json = process.env.GOOGLE_PUBSUB_SERVICE_ACCOUNT_BASE64;
    if (!base64Json) {
      throw new Error('GOOGLE_PUBSUB_SERVICE_ACCOUNT_BASE64 is not set');
    }

    try {
      const decoded = Buffer.from(base64Json, 'base64').toString('utf8');
      const parsed = JSON.parse(decoded) as Partial<ServiceAccountCredentials>;
      if (!parsed.client_email || !parsed.private_key) {
        throw new Error('missing client_email or private_key');
      }
      return { client_email: parsed.client_email, private_key: parsed.private_key };
    } catch (error) {
      throw new Error(`Invalid GOOGLE_PUBSUB_SERVICE_ACCOUNT_BASE64: ${getErrorMessage(error)}`);
    }
  }
}

// ─── Module-private helpers ─────────────────────────────────────────────────

function parseEmailList(value: string | undefined): string[] {
  if (!value) return [];
  return value
    .split(',')
    .map(entry => {
      const match = entry.match(/<(.+?)>/) || entry.match(/([^\s<>]+@[^\s<>]+)/);
      return match ? match[1].trim() : entry.trim();
    })
    .filter(e => e.includes('@'));
}

function base64UrlEncode(value: string | Buffer): string {
  const buf = typeof value === 'string' ? Buffer.from(value, 'utf8') : value;
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function decodeBase64Url(data: string): string {
  try {
    const base64 = data.replace(/-/g, '+').replace(/_/g, '/');
    const padded = base64.padEnd(base64.length + ((4 - (base64.length % 4)) % 4), '=');
    return Buffer.from(padded, 'base64').toString('utf-8');
  } catch {
    logger.error(`${TAG} Failed to decode base64url data`);
    return '';
  }
}

function ensureReplyPrefix(subject: string): string {
  return subject.toLowerCase().startsWith('re:') ? subject : `Re: ${subject}`;
}

async function buildMimeMessage(opts: MimeOptions): Promise<Buffer> {
  const MailComposer = (await import('nodemailer/lib/mail-composer')).default;
  return new MailComposer({
    from: opts.from,
    to: opts.to,
    ...(opts.cc?.length && { cc: opts.cc }),
    ...(opts.bcc?.length && { bcc: opts.bcc }),
    subject: opts.subject,
    html: opts.body,
    ...(opts.inReplyTo && { inReplyTo: opts.inReplyTo }),
    ...(opts.references && { references: opts.references }),
    ...(opts.attachments?.length && {
      attachments: opts.attachments.map(a => ({
        filename: a.name,
        content: a.content,
        contentType: a.contentType,
      })),
    }),
  } as never).compile().build() as unknown as Promise<Buffer>;
}

async function fetchThreadingHeaders(
  gmail: gmail_v1.Gmail,
  latestMessageId: string,
): Promise<{ inReplyTo?: string; references?: string }> {
  try {
    const meta = await gmail.users.messages.get({
      userId: 'me',
      id: latestMessageId,
      format: 'metadata',
      metadataHeaders: ['Message-Id', 'References'],
    });

    const headers = meta.data.payload?.headers || [];
    const getHeader = (name: string) =>
      headers.find(h => h.name?.toLowerCase() === name.toLowerCase())?.value || undefined;

    const inReplyTo = getHeader('Message-Id');
    const prevRefs = getHeader('References');
    const references = prevRefs ? `${prevRefs} ${inReplyTo ?? ''}`.trim() : inReplyTo;

    return { inReplyTo, references };
  } catch (error) {
    logger.warn(`${TAG} Could not fetch threading headers, sending without In-Reply-To`, {
      latestMessageId,
      error: getErrorMessage(error),
    });
    return {};
  }
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  return 'Unknown error';
}
