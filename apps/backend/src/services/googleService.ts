/**
 * Google Gmail Service
 * Gmail API interactions: message fetching/parsing, watch setup, Pub/Sub config,
 * ExternalSource provisioning, and email sending with auto token refresh.
 */

import { google, gmail_v1 } from 'googleapis';
import { DeskType } from '@xyne/shared';
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
// One shared Pub/Sub subscription per env handles every Google source — body's
// emailAddress routes to the right ExternalSource at request time. Env suffix
// keeps dev/staging/prod from overwriting each other's pushConfig.
const SHARED_SUBSCRIPTION_BASE = 'gmail-google-shared';
export const SHARED_GOOGLE_WEBHOOK_PATH = '/api/external-source-sync/google/ingest';

// ─── Types ──────────────────────────────────────────────────────────────────

interface ServiceAccountCredentials {
  client_email: string;
  private_key: string;
}

interface WatchResult {
  historyId: string;
  expiration: string;
}

export interface GmailMessageRef {
  id: string;
  threadId: string;
  labelIds?: string[];
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
  fromEmailAddress?: string;
  /** Optional file attachments (e.g. ICS calendar invite or user-uploaded files). */
  attachments?: Array<{
    name: string;
    contentType: string;
    content: Buffer | string;
    cid?: string;
    isInline?: boolean;
  }>;
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
  attachments?: Array<{
    name: string;
    contentType: string;
    content: Buffer | string;
    cid?: string;
    isInline?: boolean;
  }>;
}

// ─── Service ────────────────────────────────────────────────────────────────

export class GoogleService {
  private readonly oauth2Client: OAuth2Client;
  private readonly gmail: gmail_v1.Gmail;
  private readonly credentials: GoogleCredentials;

  constructor(credentials: GoogleCredentials, sourceId?: string) {
    this.credentials = credentials;
    this.oauth2Client = GoogleService.createOAuth2Client(credentials);

    if (sourceId) {
      const externalSourceRepo = new ExternalSourceRepository();
      this.oauth2Client.on('tokens', async tokens => {
        try {
          if (tokens.access_token) this.credentials.accessToken = tokens.access_token;
          if (tokens.refresh_token) this.credentials.refreshToken = tokens.refresh_token;
          await externalSourceRepo.update(sourceId, {
            credentials: encrypt(JSON.stringify(this.credentials)),
          });
          logger.info(`${TAG} Google tokens refreshed and persisted (instance)`, { sourceId });
        } catch (error) {
          logger.warn(`${TAG} Failed to persist refreshed Google tokens (instance)`, error);
        }
      });
    }

    this.gmail = google.gmail({ version: 'v1', auth: this.oauth2Client as any });
  }

  static fromEncryptedCredentials(encryptedCredentials: string, sourceId: string): GoogleService {
    const credentials = JSON.parse(decrypt(encryptedCredentials)) as GoogleCredentials;
    return new GoogleService(credentials, sourceId);
  }

  getUserEmail(): string {
    return this.credentials.email;
  }

  // ─── Gmail API — Messages ────────────────────────────────────────────────

  async getMessageById(messageId: string): Promise<GmailMessageData | null> {
    try {
      const response = await withGmailRetry(`messages.get ${messageId}`, () =>
        this.gmail.users.messages.get({
          userId: 'me',
          id: messageId,
          format: 'full',
        }),
      );
      return response.data as GmailMessageData;
    } catch (error) {
      // 404 = message was deleted/expired between Gmail publishing the event
      // and us fetching it. Surface as null so caller can skip-ack instead of
      // throwing (which would make Pub/Sub retry the dead message for 7 days).
      if (getHttpStatus(error) === 404) {
        logger.warn(`${TAG} Message ${messageId} not found (likely deleted) — skipping`);
        return null;
      }
      logger.error(`${TAG} Failed to fetch message ${messageId}`, error);
      throw new Error(`Failed to fetch Gmail message: ${getErrorMessage(error)}`);
    }
  }

  async getAttachment(messageId: string, attachmentId: string): Promise<string | null> {
    try {
      const response = await withGmailRetry(`attachments.get ${attachmentId}`, () =>
        this.gmail.users.messages.attachments.get({
          userId: 'me',
          messageId,
          id: attachmentId,
        }),
      );
      return response.data.data || null;
    } catch (error) {
      logger.error(`${TAG} Failed to fetch attachment ${attachmentId}`, error);
      throw Object.assign(
        new Error(`Failed to fetch Gmail attachment: ${getErrorMessage(error)}`),
        { status: getHttpStatus(error), cause: error },
      );
    }
  }

  /**
   * Drain `history.list` from `startHistoryId`, returning the message ids added
   * since, plus the latest historyId
   * reported by Gmail. Callers that persist a sync cursor (manual reload)
   * need this value to advance the watermark.
   */
  async listMessagesFromHistoryWithCursor(
    startHistoryId: string,
  ): Promise<{ messageIds: string[]; historyId: string | null }> {
    const { messages, historyId } = await this.listMessageRefsFromHistory(startHistoryId);
    const ingestable = messages.filter(m => !m.labelIds?.includes('DRAFT'));
    return { messageIds: ingestable.map(m => m.id), historyId };
  }

  async listMessageRefsFromHistory(
    startHistoryId: string,
  ): Promise<{ messages: GmailMessageRef[]; historyId: string | null }> {
    try {
      const messages: GmailMessageRef[] = [];
      let historyId: string | null = null;
      let pageToken: string | undefined;

      do {
        const response = await withGmailRetry(`history.list ${startHistoryId}`, () =>
          this.gmail.users.history.list({
            userId: 'me',
            startHistoryId,
            historyTypes: ['messageAdded'],
            ...(pageToken && { pageToken }),
          }),
        );

        for (const record of response.data.history || []) {
          for (const msg of record.messagesAdded || []) {
            const id = msg.message?.id;
            if (id)
              messages.push({
                id,
                threadId: msg.message?.threadId ?? id,
                ...(msg.message?.labelIds && { labelIds: msg.message.labelIds }),
              });
          }
        }

        historyId = response.data.historyId ?? historyId;
        pageToken = response.data.nextPageToken ?? undefined;
      } while (pageToken);

      return { messages, historyId };
    } catch (error) {
      const status = getHttpStatus(error);
      logger.error(`${TAG} Failed to fetch Gmail history`, { status, startHistoryId, error });
      throw Object.assign(
        new Error(`Failed to fetch Gmail history: ${getErrorMessage(error)}`),
        { status },
      );
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

  async listMessagesByDateRange(params: {
    startDate: string;
    endDate: string;
    maxMessages?: number | null;
    extraQuery?: string;
  }): Promise<Array<{ id: string; threadId: string }>> {
    const { startDate, endDate, maxMessages = 2000, extraQuery } = params;
    const afterUnix = Math.floor(Date.parse(startDate) / 1000);
    const beforeUnix = Math.floor(Date.parse(endDate) / 1000);
    if (Number.isNaN(afterUnix) || Number.isNaN(beforeUnix)) {
      throw new Error('Invalid startDate or endDate');
    }

    const baseQuery = `after:${afterUnix} before:${beforeUnix} -in:drafts`;
    const q = extraQuery ? `${baseQuery} ${extraQuery}` : baseQuery;

    const messages: Array<{ id: string; threadId: string }> = [];
    let pageToken: string | undefined;

    try {
      do {
        const response = await withGmailRetry('messages.list', () =>
          this.gmail.users.messages.list({
            userId: 'me',
            q,
            maxResults: maxMessages === null ? 100 : Math.min(100, maxMessages - messages.length),
            ...(pageToken && { pageToken }),
          }),
        );

        for (const msg of response.data.messages || []) {
          if (msg.id) {
            messages.push({ id: msg.id, threadId: msg.threadId ?? msg.id });
          }
          if (maxMessages !== null && messages.length >= maxMessages) break;
        }

        pageToken = response.data.nextPageToken ?? undefined;
      } while (pageToken && (maxMessages === null || messages.length < maxMessages));

      return messages;
    } catch (error) {
      logger.error(`${TAG} Failed to list messages by date range`, error);
      throw new Error(`Failed to list messages by date range: ${getErrorMessage(error)}`);
    }
  }

  async listRecentMessages(
    count = 10,
    opts: { mode?: 'messages' | 'threads' } = {},
  ): Promise<string[]> {
    const mode = opts.mode ?? 'messages';
    const labelQuery = '(in:inbox OR in:sent) -in:drafts';
    try {
      if (mode === 'threads') {
        const threadList = await this.gmail.users.threads.list({
          userId: 'me',
          maxResults: count,
          q: labelQuery,
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
        q: labelQuery,
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
        requestBody: { topicName, labelIds: ['INBOX', 'SENT'] },
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

  /**
   * Stop Gmail publishing this mailbox's events to the Pub/Sub topic.
   * Used during desk disconnect so push notifications halt immediately
   * instead of waiting up to 7 days for the watch to naturally expire.
   * Idempotent: a 404 from Gmail (no active watch) is treated as success.
   */
  async stopGmailWatch(): Promise<void> {
    try {
      await this.gmail.users.stop({ userId: 'me' });
      logger.info(`${TAG} Gmail watch stopped`);
    } catch (error) {
      const status = (error as { status?: number; code?: number })?.status
        ?? (error as { status?: number; code?: number })?.code;
      // 404 = no active watch (already stopped, expired, or never set up).
      // Desired end state is "no watch publishing", which is already true.
      if (status === 404) {
        logger.info(`${TAG} No active Gmail watch to stop (already inactive)`);
        return;
      }
      logger.error(`${TAG} Failed to stop Gmail watch`, error);
      throw new Error(`Failed to stop Gmail watch: ${getErrorMessage(error)}`);
    }
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
      rfcMessageId: getHeader('Message-ID') ?? getHeader('Message-Id'),
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
    sourceName?: string;
  }): Promise<{
    sourceName: string;
    webhookUrl: string;
    subscriptionName: string;
    watchResult: WatchResult;
    encryptedCredentials: string;
  }> {
    const { emailAddress, accessToken, refreshToken } = params;
    const sourceName = params.sourceName || GoogleService.getSourceName(emailAddress);
    const credentials: GoogleCredentials = { accessToken, refreshToken, email: emailAddress };
    const encryptedCredentials = encrypt(JSON.stringify(credentials));

    const watchResult = await new GoogleService(credentials).setupGmailWatch();
    const webhookUrl = GoogleService.generateWebhookUrl();
    const subscriptionName = await GoogleService.setupPubSubSubscription();

    return { sourceName, webhookUrl, subscriptionName, watchResult, encryptedCredentials };
  }

  static async setupExternalSource(params: SetupExternalSourceParams): Promise<SetupExternalSourceResult> {
    const { channelId, emailAddress, accessToken, refreshToken, boardId } = params;

    const sourceName = GoogleService.getSourceName(emailAddress);
    const channel = await new ChannelRepository().findById(channelId);
    const credentials: GoogleCredentials = { accessToken, refreshToken, email: emailAddress };
    const encryptedCredentials = encrypt(JSON.stringify(credentials));

    const watchResult = await new GoogleService(credentials).setupGmailWatch();

    const webhookUrl = GoogleService.generateWebhookUrl();
    const subscriptionName = await GoogleService.setupPubSubSubscription();

    const repo = new ExternalSourceRepository();
    const legacySourceName = `${SOURCE_NAME_PREFIX}${emailAddress.split('@')[0].replace(/[^a-zA-Z0-9_-]/g, '-')}`;
    const [newMatch, legacyMatch] = await Promise.all([
      repo.findByName(sourceName),
      repo.findByName(legacySourceName),
    ]);
    const emailLower = emailAddress.toLowerCase();
    if (newMatch && newMatch.displayName?.toLowerCase() !== emailLower) {
      throw new Error(
        `Source name ${sourceName} is already taken by a different account (${newMatch.displayName})`,
      );
    }
    const existing =
      (newMatch?.displayName?.toLowerCase() === emailLower ? newMatch : null) ??
      (legacyMatch?.displayName?.toLowerCase() === emailLower ? legacyMatch : null);

    if (existing) {
      await repo.update(existing.id, {
        credentials: encryptedCredentials,
        channelId,
        boardId: boardId || (existing.boardId ?? undefined), // @deprecated - kept for backward compatibility
        displayName: emailAddress,
        ...(existing.lastSyncCursor == null && { lastSyncCursor: watchResult.historyId }),
      });
    } else {
      await repo.create({
        name: sourceName,
        sourceType: ExternalSourcePlatform.GOOGLE,
        credentials: encryptedCredentials,
        channelId,
        boardId: boardId ?? undefined, // @deprecated - kept for backward compatibility
        displayName: emailAddress,
        lastSyncCursor: watchResult.historyId,
      });
    }

    // Create/update EmailChannelPreference for owner tracking and boardId
    const preferenceRepo = new EmailChannelPreferenceRepository();
    await preferenceRepo.upsert({
      channelId,
      deskType: DeskType.EMAIL,
      ownerUserId: channel?.createdBy,
      boardId: boardId ?? undefined, // Save boardId to EmailChannelPreference (new location)
    });

    logger.info(`${TAG} ExternalSource setup complete`, { sourceName, webhookUrl });

    return {
      sourceName,
      webhookUrl,
      historyId: watchResult.historyId,
      expiration: watchResult.expiration,
      subscriptionName,
    };
  }

  /**
   * Ensure the single shared Pub/Sub subscription exists for this env.
   * Idempotent: creates on first call, refreshes pushConfig only when the
   * webhookUrl/audience has drifted (e.g. BACKEND_URL changed across deploys),
   * no-ops otherwise. Source-level routing happens at request time via the
   * payload's emailAddress in GoogleFlow.getSourceNameFromDB.
   */
  static async setupPubSubSubscription(): Promise<string> {
    const credentials = GoogleService.loadPubSubServiceAccount();
    const pubsub = new PubSub({
      projectId: process.env.GOOGLE_CLOUD_PROJECT_ID,
      credentials,
    });

    const topicName = process.env.GOOGLE_PUBSUB_TOPIC || DEFAULT_PUBSUB_TOPIC;
    const subscriptionName = GoogleService.getSharedSubscriptionName();
    const webhookUrl = GoogleService.generateWebhookUrl();

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
      const [meta] = await subscription.getMetadata();
      const currentEndpoint = meta.pushConfig?.pushEndpoint;
      if (currentEndpoint === webhookUrl) {
        logger.info(`${TAG} Shared Pub/Sub subscription already current`, { subscriptionName });
      } else {
        await subscription.modifyPushConfig(pushConfig);
        logger.warn(`${TAG} Shared Pub/Sub subscription pushConfig drifted — refreshed`, {
          subscriptionName,
          previousEndpoint: currentEndpoint,
          newEndpoint: webhookUrl,
        });
      }
    } else {
      await topic.createSubscription(subscriptionName, {
        pushConfig,
        ackDeadlineSeconds: PUBSUB_ACK_DEADLINE_SECONDS,
      });
      logger.info(`${TAG} Shared Pub/Sub subscription created`, { subscriptionName, webhookUrl });
    }

    return subscriptionName;
  }

  static generateWebhookUrl(): string {
    const baseUrl = process.env.BACKEND_URL || DEFAULT_BACKEND_URL;
    return `${baseUrl}${SHARED_GOOGLE_WEBHOOK_PATH}`;
  }

  static getSharedSubscriptionName(): string {
    // Env classification from BACKEND_URL — keeps detection in sync with how
    // urlUtils.ts already distinguishes deployments, and avoids needing a new
    // dedicated env var:
    //   spaces.sandbox.xyne.juspay.net → sandbox
    //   localhost / ngrok / trycloudflare / 127.0.0.1 → dev
    //   anything else (prod domain) → prod
    const backendUrl = (process.env.BACKEND_URL || '').toLowerCase();
    let suffix: string;
    if (backendUrl.includes('sandbox')) {
      suffix = 'sandbox';
    } else if (
      backendUrl.includes('localhost')
      || backendUrl.includes('127.0.0.1')
      || backendUrl.includes('ngrok')
      || backendUrl.includes('trycloudflare')
    ) {
      suffix = 'dev';
    } else {
      suffix = 'prod';
    }
    return `${SHARED_SUBSCRIPTION_BASE}-${suffix}-push`;
  }

  /**
   * One-shot: plant a starting `lastSyncCursor` on every active Gmail source.
   *
   * Run before the cursor-resuming ingestion path ships. Without a cursor a source
   * falls back to the push's own historyId, and `history.list` returns records *after*
   * that — so the first push resolves to nothing and skips the mail that triggered it.
   *
   * `overwrite` is safe only while nothing reads the column; afterwards it would move a
   * desk past un-ingested mail. Hence false by default.
   */
  static async seedSyncCursors(opts: { dryRun?: boolean; overwrite?: boolean } = {}): Promise<{
    dryRun: boolean;
    overwrite: boolean;
    seeded: Array<{ name: string; from: string | null; to: string }>;
    skipped: Array<{ name: string; reason: string }>;
  }> {
    const dryRun = !!opts.dryRun;
    const overwrite = !!opts.overwrite;
    const repo = new ExternalSourceRepository();

    const sources = await repo.findAll({
      sourceType: ExternalSourcePlatform.GOOGLE,
      isActive: true,
    });

    const seeded: Array<{ name: string; from: string | null; to: string }> = [];
    const skipped: Array<{ name: string; reason: string }> = [];

    for (const source of sources) {
      if (source.lastSyncCursor && !overwrite) {
        skipped.push({ name: source.name, reason: 'already has a cursor' });
        continue;
      }
      if (!source.credentials) {
        skipped.push({ name: source.name, reason: 'no credentials' });
        continue;
      }

      try {
        const historyId = await GoogleService.fromEncryptedCredentials(
          source.credentials,
          source.id,
        ).getCurrentHistoryId();

        if (!historyId) {
          skipped.push({ name: source.name, reason: 'Gmail returned no historyId' });
          continue;
        }

        if (!dryRun) await repo.update(source.id, { lastSyncCursor: historyId });
        seeded.push({ name: source.name, from: source.lastSyncCursor, to: historyId });
      } catch (error) {
        // Collected, not thrown — one dead mailbox shouldn't stop the rest.
        skipped.push({ name: source.name, reason: getErrorMessage(error) });
      }
    }

    logger.info(`${TAG} seedSyncCursors finished`, {
      dryRun,
      overwrite,
      seededCount: seeded.length,
      skippedCount: skipped.length,
    });

    return { dryRun, overwrite, seeded, skipped };
  }

  /**
   * One-shot migration: ensure the env's shared subscription exists, then
   * delete every legacy per-source `gmail-google-<src>-push` subscription on
   * the Gmail topic. Safe to run repeatedly — idempotent on both halves.
   * `dryRun=true` lists what would change without touching anything.
   */
  static async migrateToSharedSubscription(opts: { dryRun?: boolean } = {}): Promise<{
    dryRun: boolean;
    sharedSubscriptionName: string;
    sharedSubscriptionCreated: boolean;
    oldSubscriptionsDeleted: string[];
    oldSubscriptionsSkipped: Array<{ name: string; reason: string }>;
  }> {
    const dryRun = !!opts.dryRun;
    const sharedName = GoogleService.getSharedSubscriptionName();

    const credentials = GoogleService.loadPubSubServiceAccount();
    const pubsub = new PubSub({
      projectId: process.env.GOOGLE_CLOUD_PROJECT_ID,
      credentials,
    });
    const topicName = process.env.GOOGLE_PUBSUB_TOPIC || DEFAULT_PUBSUB_TOPIC;
    const topic = pubsub.topic(topicName);

    // 1. Make sure the shared sub exists FIRST so events have a destination
    // throughout the cleanup window (no event-loss gap).
    let sharedSubscriptionCreated = false;
    const sharedSub = topic.subscription(sharedName);
    const [sharedExists] = await sharedSub.exists();
    if (!sharedExists) {
      if (!dryRun) {
        await GoogleService.setupPubSubSubscription();
        sharedSubscriptionCreated = true;
      } else {
        sharedSubscriptionCreated = true; // would-create
      }
    }

    // 2. Find every legacy per-source subscription attached to this topic.
    // `topic.getSubscriptions()` returns Subscription objects scoped to this
    // topic only — won't accidentally touch unrelated subs in the project.
    const [allOnTopic] = await topic.getSubscriptions();
    const legacy = allOnTopic.filter(s => {
      const shortName = s.name.split('/').pop() || '';
      // Match gmail-google-<anything>-push but exclude shared subs of any env.
      return /^gmail-google-.+-push$/.test(shortName)
        && !shortName.startsWith(`${SHARED_SUBSCRIPTION_BASE}-`);
    });

    logger.info(`${TAG} migration: ${legacy.length} legacy subscriptions found on topic ${topicName}`, {
      sharedName,
      sharedSubscriptionCreated,
      dryRun,
    });

    // 3. Delete each (or simulate deletion in dryRun).
    const deleted: string[] = [];
    const skipped: Array<{ name: string; reason: string }> = [];
    for (const sub of legacy) {
      const shortName = sub.name.split('/').pop() || sub.name;
      if (dryRun) {
        deleted.push(shortName);
        continue;
      }
      try {
        await sub.delete();
        deleted.push(shortName);
        logger.info(`${TAG} migration: deleted legacy subscription ${shortName}`);
      } catch (err) {
        const reason = err instanceof Error ? err.message : String(err);
        skipped.push({ name: shortName, reason });
        logger.warn(`${TAG} migration: skipped ${shortName}: ${reason}`);
      }
    }

    return {
      dryRun,
      sharedSubscriptionName: sharedName,
      sharedSubscriptionCreated,
      oldSubscriptionsDeleted: deleted,
      oldSubscriptionsSkipped: skipped,
    };
  }

  static getSourceName(emailAddress: string): string {
    const username = emailAddress.replace('@', '--').replace(/[^a-zA-Z0-9_-]/g, '-');
    return `${SOURCE_NAME_PREFIX}${username}`;
  }

  static validatePushInfrastructure(): void {
    if (!process.env.GOOGLE_CLOUD_PROJECT_ID) {
      throw new Error('Google channel email mailbox requires GOOGLE_CLOUD_PROJECT_ID to be configured');
    }

    if (!process.env.GOOGLE_PUBSUB_TOPIC) {
      throw new Error('Google channel email mailbox requires GOOGLE_PUBSUB_TOPIC to be configured');
    }

    GoogleService.loadPubSubServiceAccount();
  }

  // ─── Email sender (reply) ────────────────────────────────────────────────

  static async listContacts(
    encryptedCredentials: string,
    sourceId: string,
  ): Promise<Array<{ name: string | null; email: string }>> {
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
      } catch (error) {
        logger.warn(`${TAG} Failed to persist refreshed Google tokens`, error);
      }
    });

    const people = google.people({ version: 'v1', auth: oauth2Client as any });
    const seen = new Map<string, { name: string | null; email: string }>();

    const harvest = (
      sources: Array<{
        names?: Array<{ displayName?: string | null }> | null;
        emailAddresses?: Array<{ value?: string | null }> | null;
      } | null | undefined>,
    ): void => {
      for (const person of sources) {
        if (!person) continue;
        const name = person.names?.[0]?.displayName ?? null;
        for (const ea of person.emailAddresses ?? []) {
          const email = (ea.value || '').trim().toLowerCase();
          if (!email || !email.includes('@')) continue;
          if (!seen.has(email)) seen.set(email, { name, email });
        }
      }
    };

    const PAGE_SIZE = 1000;
    const MAX_CONTACTS = 10_000;

    let connectionsCount = 0;
    let otherCount = 0;

    try {
      let pageToken: string | undefined = undefined;
      while (true) {
        const res: { data: { connections?: any[] | null; nextPageToken?: string | null } } =
          await people.people.connections.list({
            resourceName: 'people/me',
            pageSize: PAGE_SIZE,
            personFields: 'names,emailAddresses',
            ...(pageToken ? { pageToken } : {}),
          });
        const before = seen.size;
        harvest(res.data.connections ?? []);
        connectionsCount += seen.size - before;
        pageToken = res.data.nextPageToken ?? undefined;
        if (!pageToken || seen.size >= MAX_CONTACTS) break;
      }
    } catch (err) {
      logger.warn(`${TAG} Failed to list Google connections`, getErrorMessage(err));
    }

    if (seen.size < MAX_CONTACTS) {
      try {
        let pageToken: string | undefined = undefined;
        while (true) {
          const res: { data: { otherContacts?: any[] | null; nextPageToken?: string | null } } =
            await people.otherContacts.list({
              pageSize: PAGE_SIZE,
              readMask: 'names,emailAddresses',
              ...(pageToken ? { pageToken } : {}),
            });
          const before = seen.size;
          harvest(res.data.otherContacts ?? []);
          otherCount += seen.size - before;
          pageToken = res.data.nextPageToken ?? undefined;
          if (!pageToken || seen.size >= MAX_CONTACTS) break;
        }
      } catch (err) {
        logger.warn(`${TAG} Failed to list Google other contacts`, getErrorMessage(err));
      }
    }
    
    logger.info(`${TAG} listContacts result`, {
      sourceId,
      total: seen.size,
      myContacts: connectionsCount,
      otherContacts: otherCount,
    });

    return Array.from(seen.values());
  }

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
          from: params.fromEmailAddress || credentials.email,
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

      async sendNewEmail(params: {
        subject: string;
        content: string;
        to: string[];
        cc?: string[];
        bcc?: string[];
        fromEmailAddress?: string;
        attachments?: Array<{
          name: string;
          contentType: string;
          content: Buffer | string;
          cid?: string;
          isInline?: boolean;
        }>;
      }): Promise<{ messageId: string; threadId: string; fromEmail: string }> {
        const fromHeader = params.fromEmailAddress || credentials.email;
        const mime = await buildMimeMessage({
          from: fromHeader,
          to: params.to,
          cc: params.cc,
          bcc: params.bcc,
          subject: params.subject,
          body: params.content,
          ...(params.attachments && { attachments: params.attachments }),
        });

        const response = await gmail.users.messages.send({
          userId: 'me',
          requestBody: { raw: base64UrlEncode(mime) },
        });

        const messageId = response.data.id || '';
        const threadId = response.data.threadId || messageId;

        logger.info(`${TAG} Gmail new email sent`, { messageId, threadId, from: fromHeader });
        return { messageId, threadId, fromEmail: fromHeader };
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
        ...(a.cid ? {} : { filename: a.name }),
        content: a.content,
        contentType: a.contentType,
        ...(a.cid && {
          cid: a.cid,
          contentDisposition: 'inline',
          headers: { 'X-Attachment-Id': a.cid },
        }),
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

export function getHttpStatus(error: unknown): number | undefined {
  return (error as { status?: number } | null | undefined)?.status;
}

/**
 * Gmail rejects bursts with "Too many concurrent requests for user." — a
 * transient signal Google asks callers to back off on, not a real failure.
 * Without this a single burst costs a held cursor or a dropped attachment.
 */
const RETRYABLE_STATUSES = new Set([429, 500, 502, 503, 504]);
const GMAIL_MAX_ATTEMPTS = 4;

export function isRetryableGmailError(error: unknown): boolean {
  const status = getHttpStatus(error);
  if (status !== undefined && RETRYABLE_STATUSES.has(status)) return true;
  // Some Gmail paths report the per-user concurrency cap as 403.
  return status === 403 && /rate limit|too many concurrent/i.test(getErrorMessage(error));
}

async function withGmailRetry<T>(label: string, call: () => Promise<T>): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await call();
    } catch (error) {
      if (attempt >= GMAIL_MAX_ATTEMPTS || !isRetryableGmailError(error)) throw error;
      const delayMs = 500 * 2 ** (attempt - 1) + Math.floor(Math.random() * 250);
      logger.warn(
        `${TAG} ${label} throttled — retry ${attempt}/${GMAIL_MAX_ATTEMPTS - 1} in ${delayMs}ms: ${getErrorMessage(error)}`,
      );
      await new Promise(resolve => setTimeout(resolve, delayMs));
    }
  }
}
