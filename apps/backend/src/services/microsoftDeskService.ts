/**
 * Microsoft Desk Service
 * Handles OAuth, external source creation, Graph webhook subscription,
 * and email send/reply via Microsoft Graph API.
 */

import crypto from 'crypto';
import { EmailMergeMode, DeskType, ChannelRole, ChannelScopeType, ChannelType } from '@xyne/shared';
import { WORKSPACE_LEVEL } from '@/integrations/core/sourceScope';
import { AuthorizationCode } from 'simple-oauth2';
import { logger } from '../utils/logger';
import { decrypt, encrypt } from './encryptionService';
import { redisService } from './redisService';
import { db } from '../database/client';
import { config } from '../config/env';
import { ExternalSourceRepository } from '../database/repositories/externalSourceRepository';
import { AttachmentUploadError } from '../integrations/core/baseMailReplySender';
import { CHANNEL_EMAIL_SOURCE_TYPES } from './channelEmailAliasService';

export type PendingChannelData =
  | PendingChannelCreate
  | PendingChannelReconnect
  | PendingChannelWorkspace
  | PendingChannelDlMemberSync
  | PendingChannelEmailWorkspace;

export interface PendingChannelCreate {
  mode?: 'create';
  name: string;
  description?: string;
  visibility: string;
  projectId: string;
  userId: string;
  workspaceId: string;
  assigneeUserGroupId?: string;
  boardId?: string;
  platform?: 'electron' | 'web';
}

export interface PendingChannelReconnect {
  mode: 'reconnect';
  userId: string;
  channelId: string;
  expectedEmail: string;
  workspaceId?: string;
  platform?: 'electron' | 'web';
}

export interface PendingChannelWorkspace {
  mode: 'workspace';
  userId: string;
  workspaceId: string;
  expectedEmail?: string;
  platform?: 'electron' | 'web';
}

export interface PendingChannelDlMemberSync {
  mode: 'dl-member-sync';
  userId: string;
  workspaceId: string;
  channelId: string;
  dlEmail: string;
  startDate: string;
  endDate: string;
  platform?: 'electron' | 'web';
}

export interface PendingChannelEmailWorkspace {
  mode: 'channel-email-workspace';
  userId: string;
  workspaceId: string;
  returnPath?: string;
  platform?: 'electron' | 'web';
}

export function isReconnectChannelData(
  data: PendingChannelData,
): data is PendingChannelReconnect {
  return data.mode === 'reconnect';
}

export function isWorkspaceChannelData(
  data: PendingChannelData,
): data is PendingChannelWorkspace {
  return data.mode === 'workspace';
}

export function isDlMemberSyncChannelData(
  data: PendingChannelData,
): data is PendingChannelDlMemberSync {
  return data.mode === 'dl-member-sync';
}

export function isChannelEmailWorkspaceData(
  data: PendingChannelData,
): data is PendingChannelEmailWorkspace {
  return data.mode === 'channel-email-workspace';
}

interface MicrosoftCredentials {
  accessToken: string;
  refreshToken?: string;
  email: string;
  expiresAt?: string;
  clientState?: string;
}

interface GraphSubscriptionResponse {
  id: string;
  expirationDateTime: string;
}

const PENDING_CHANNEL_TTL = 600; // 10 minutes
const PENDING_CHANNEL_PREFIX = 'email_channel:';
const GRAPH_SUBSCRIPTION_MAX_MINUTES = 4230; // ~3 days

export const MICROSOFT_OAUTH_SCOPES = [
  'openid',
  'email',
  'offline_access',
  'Mail.Read',
  'Mail.Send',
  'Mail.ReadWrite',
  'Contacts.Read',
  'People.Read',
  'Contacts.Read.Shared',
];

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

  private prepareCredentials(
    credentials: { accessToken: string; refreshToken?: string; email: string; expiresAt?: string; clientState?: string },
  ): { encryptedCredentials: string; clientState: string } {
    const clientState = credentials.clientState || crypto.randomBytes(16).toString('hex');
    const signedCredentials = { ...credentials, clientState };
    return {
      encryptedCredentials: encrypt(JSON.stringify(signedCredentials)),
      clientState,
    };
  }

  private async createMailSubscription(
    accessToken: string,
    webhookUrl: string,
    resource: string,
    clientState: string,
  ): Promise<GraphSubscriptionResponse> {
    const expirationDateTime = new Date();
    expirationDateTime.setMinutes(expirationDateTime.getMinutes() + GRAPH_SUBSCRIPTION_MAX_MINUTES);

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

  async registerGraphWebhook(accessToken: string, webhookUrl: string, clientState: string): Promise<void> {
    await this.createMailSubscription(accessToken, webhookUrl, 'me/mailFolders/inbox/messages', clientState);
    await this.createMailSubscription(accessToken, webhookUrl, 'me/mailFolders/sentitems/messages', clientState);
  }

  // ─── Channel Setup ───

  async createChannelAndSource(
    channelData: PendingChannelCreate,
    credentials: { accessToken: string; refreshToken?: string; email: string; expiresAt?: string },
    publicUrl: string,
  ): Promise<{ channelId: string }> {
    const safeEmail = credentials.email.replace('@', '--');
    const sourceName = `microsoft-${safeEmail}`;
    const { encryptedCredentials, clientState } = this.prepareCredentials(credentials);
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
          scopeType: ChannelScopeType.DEFAULT,
          name: channelData.name,
          description: channelData.description,
          visibility: channelData.visibility === 'private' ? 'PRIVATE' : 'PUBLIC',
          createdBy: channelData.userId,
          workspaceId: channelData.workspaceId,
          projectId: channelData.projectId,
          type: ChannelType.EMAIL,
        },
      });

      const now = new Date();
      const seenConversations = await tx.conversation.findMany({
        where: {
          channelId: channel.id,
          createdAt: { lte: now },
        },
        orderBy: { createdAt: 'desc' },
        take: 25,
        select: { createdAt: true },
      });
      const conversationSeenCutoffAt =
        seenConversations[seenConversations.length - 1]?.createdAt ?? now;

      await tx.channelParticipant.create({
        data: {
          channelId: channel.id,
          userId: channelData.userId,
          role: ChannelRole.ADMIN,
          workspaceId: channelData.workspaceId,
        },
      });

      await tx.channelUserStatus.create({
        data: {
          channelId: channel.id,
          userId: channelData.userId,
          lastViewedAt: now,
          conversationSeenCutoffAt,
          updatedAt: now,
          workspaceId: channelData.workspaceId,
        },
      });

      await tx.channelStats.create({
        data: {
          channelId: channel.id,
          lastActivityAt: now,
          participantCount: 1,
          workspaceId: channelData.workspaceId,
        },
      });

      // Reuse the project's boards (same pattern as Google) — no per-connection
      // board/stages creation. If the project has no boards yet, the mapping list is empty.
      const boards = await tx.board.findMany({
        where: { projectId: channelData.projectId },
        orderBy: { createdAt: 'asc' },
        select: { id: true },
      });
      const board = boards[0] ?? null;

      // Populate ChannelBoardMapping so downstream consumers can resolve
      // channel→boards without going through channel.projectId.
      // Default: explicit channelData.boardId if provided, else the first (oldest) board.
      if (boards.length > 0) {
        const defaultBoardId = channelData.boardId ?? boards[0].id;
        await tx.channelBoardMapping.createMany({
          data: boards.map(b => ({
            channelId: channel.id,
            boardId: b.id,
            workspaceId: channelData.workspaceId,
            isDefault: b.id === defaultBoardId,
            createdBy: channelData.userId,
            createdAt: now,
            updatedAt: now,
          })),
          skipDuplicates: true,
        });
      }

      await tx.externalSource.create({
        data: {
          name: sourceName,
          sourceType: 'microsoft',
          displayName: credentials.email,
          channelId: channel.id,
          boardId: channelData.boardId ?? board?.id, // @deprecated - kept for backward compatibility
          workspaceId: channelData.workspaceId,
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
          ...(channelData.boardId ? { boardId: channelData.boardId } : board?.id ? { boardId: board.id } : {}),
          emailMergeMode: config.emailMergeModeDefault as EmailMergeMode,
          deskType: DeskType.EMAIL,
          workspaceId: channelData.workspaceId,
        },
      });

      await this.registerGraphWebhook(credentials.accessToken, webhookUrl, clientState);

      return channel.id;
    }, {
      maxWait: 10_000,
      timeout: 30_000,
    });

    return { channelId };
  }

  /**
   * Workspace-shared mailbox flow. Creates a single ExternalSource scoped to
   * the workspace (channelId: null, workspaceId set) plus Graph webhook. No
   * channel or EmailChannelPreference — DL desks ride on this source.
   */
  async createWorkspaceSource(
    channelData: PendingChannelWorkspace,
    credentials: { accessToken: string; refreshToken?: string; email: string; expiresAt?: string },
    publicUrl: string,
  ): Promise<{ sourceName: string }> {
    const safeEmail = credentials.email.replace('@', '--');
    const sourceName = `microsoft-${safeEmail}`;
    const { encryptedCredentials, clientState } = this.prepareCredentials(credentials);
    const webhookUrl = `${publicUrl}/api/external-source-sync/${sourceName}/ingest`;

    const existingByName = await db.externalSource.findUnique({ where: { name: sourceName } });
    const existingForWorkspace = await db.externalSource.findFirst({
      where: { workspaceId: channelData.workspaceId, ...WORKSPACE_LEVEL, sourceType: 'microsoft' },
    });

    // Only reject if an active source with this name exists on a different workspace.
    if (existingByName?.isActive && existingByName.workspaceId !== channelData.workspaceId) {
      const err = new Error(
        `Microsoft account ${credentials.email} is already connected`,
      ) as Error & { code?: string };
      err.code = 'GMAIL_ALREADY_CONNECTED';
      throw err;
    }

    // Only reject if an active source already exists for this workspace.
    if (existingForWorkspace?.isActive) {
      const err = new Error(
        'Workspace already has a shared desk email configured',
      ) as Error & { code?: string };
      err.code = 'WORKSPACE_MAILBOX_EXISTS';
      throw err;
    }

    if (existingForWorkspace) {
      // Reactivate existing source (was soft-disconnected)
      await db.externalSource.update({
        where: { id: existingForWorkspace.id },
        data: {
          name: sourceName,
          displayName: credentials.email,
          credentials: encryptedCredentials,
          isActive: true,
        },
      });
    } else {
      await db.externalSource.create({
        data: {
          name: sourceName,
          sourceType: 'microsoft',
          displayName: credentials.email,
          channelId: null,
          workspaceId: channelData.workspaceId,
          credentials: encryptedCredentials,
          isActive: true,
        },
      });
    }

    await this.registerGraphWebhook(credentials.accessToken, webhookUrl, clientState);

    return { sourceName };
  }

  async createChannelEmailWorkspaceSource(
    channelData: PendingChannelEmailWorkspace,
    credentials: { accessToken: string; refreshToken?: string; email: string; expiresAt?: string },
    publicUrl: string,
  ): Promise<{ sourceName: string }> {
    const safeEmail = credentials.email.replace('@', '--');
    const sourceName = `microsoft-channel-email-${safeEmail}`;
    const { encryptedCredentials, clientState } = this.prepareCredentials(credentials);
    const webhookUrl = `${publicUrl}/api/external-source-sync/${sourceName}/ingest`;
    const existingByName = await db.externalSource.findUnique({ where: { name: sourceName } });

    if (existingByName?.isActive && existingByName.workspaceId !== channelData.workspaceId) {
      const err = new Error(
        'This mailbox is already connected to another workspace',
      ) as Error & { code?: string };
      err.code = 'CHANNEL_EMAIL_MAILBOX_CONNECTED_ELSEWHERE';
      throw err;
    }

    const existingForWorkspace = await db.externalSource.findFirst({
      where: {
        workspaceId: channelData.workspaceId,
        sourceType: { in: [...CHANNEL_EMAIL_SOURCE_TYPES] },
      },
      orderBy: { createdAt: 'desc' },
    });

    if (existingForWorkspace?.isActive && existingForWorkspace.sourceType !== 'microsoft-channel-email') {
      const err = new Error(
        'Workspace already has a separate channel-email mailbox configured',
      ) as Error & { code?: string };
      err.code = 'CHANNEL_EMAIL_MAILBOX_EXISTS';
      throw err;
    }

    if (existingForWorkspace) {
      await db.externalSource.update({
        where: { id: existingForWorkspace.id },
        data: {
          name: sourceName,
          sourceType: 'microsoft-channel-email',
          displayName: credentials.email,
          credentials: encryptedCredentials,
          isActive: true,
        },
      });
    } else {
      await db.externalSource.create({
        data: {
          name: sourceName,
          sourceType: 'microsoft-channel-email',
          displayName: credentials.email,
          channelId: null,
          workspaceId: channelData.workspaceId,
          credentials: encryptedCredentials,
          isActive: true,
        },
      });
    }

    await this.registerGraphWebhook(credentials.accessToken, webhookUrl, clientState);

    return { sourceName };
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
          scope: MICROSOFT_OAUTH_SCOPES.join(' '),
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

  static async listContacts(
    encryptedCredentials: string,
    sourceId: string,
  ): Promise<Array<{ name: string | null; email: string }>> {
    const accessToken = await MicrosoftDeskService.getValidAccessToken(
      encryptedCredentials,
      sourceId,
    );
    const seen = new Map<string, { name: string | null; email: string }>();

    const upsert = (name: string | null, rawEmail: string | null | undefined): void => {
      const email = (rawEmail || '').trim().toLowerCase();
      if (!email || !email.includes('@')) return;
      if (!seen.has(email)) seen.set(email, { name, email });
    };

    const PAGE_SIZE = 999;
    const MAX_CONTACTS = 10_000;

    let myContactsCount = 0;
    let peopleCount = 0;

    try {
      let url: string | null =
        `${config.microsoftGraph.baseUrl}/me/contacts?$top=${PAGE_SIZE}&$select=displayName,emailAddresses`;
      while (url) {
        const res: Response = await fetch(url, {
          headers: { Authorization: `Bearer ${accessToken}` },
        });
        if (!res.ok) {
          logger.warn(`Microsoft /me/contacts non-OK ${res.status}`);
          break;
        }
        const json = (await res.json()) as {
          value?: Array<{
            displayName?: string | null;
            emailAddresses?: Array<{ name?: string | null; address?: string | null }> | null;
          }>;
          '@odata.nextLink'?: string;
        };
        const before = seen.size;
        for (const c of json.value ?? []) {
          const name = c.displayName ?? null;
          for (const ea of c.emailAddresses ?? []) {
            upsert(name || ea.name || null, ea.address);
          }
        }
        myContactsCount += seen.size - before;
        url = json['@odata.nextLink'] ?? null;
        if (seen.size >= MAX_CONTACTS) break;
      }
    } catch (err) {
      logger.warn('Microsoft /me/contacts fetch threw', err);
    }

    // Relevant People (auto-aggregated frequent contacts) — also paginates.
    if (seen.size < MAX_CONTACTS) {
      try {
        let url: string | null =
          `${config.microsoftGraph.baseUrl}/me/people?$top=${PAGE_SIZE}&$select=displayName,scoredEmailAddresses`;
        while (url) {
          const res: Response = await fetch(url, {
            headers: { Authorization: `Bearer ${accessToken}` },
          });
          if (!res.ok) {
            logger.warn(`Microsoft /me/people non-OK ${res.status}`);
            break;
          }
          const json = (await res.json()) as {
            value?: Array<{
              displayName?: string | null;
              scoredEmailAddresses?: Array<{ address?: string | null }> | null;
            }>;
            '@odata.nextLink'?: string;
          };
          const before = seen.size;
          for (const p of json.value ?? []) {
            const name = p.displayName ?? null;
            for (const ea of p.scoredEmailAddresses ?? []) {
              upsert(name, ea.address);
            }
          }
          peopleCount += seen.size - before;
          url = json['@odata.nextLink'] ?? null;
          if (seen.size >= MAX_CONTACTS) break;
        }
      } catch (err) {
        logger.warn('Microsoft /me/people fetch threw', err);
      }
    }

    logger.info(`[MicrosoftDeskService] listContacts result`, {
      sourceId,
      total: seen.size,
      myContacts: myContactsCount,
      relevantPeople: peopleCount,
    });

    return Array.from(seen.values());
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

  /**
   * Microsoft Graph caps inline `fileAttachment` POSTs (the JSON-with-base64
   * variant) at ~3 MB. Larger attachments must use upload sessions, which
   * stream chunked PUTs to a one-time URL. Outlook accepts up to 150 MB via
   * upload sessions.
   * Docs: https://learn.microsoft.com/graph/api/attachment-createuploadsession
   */
  private static readonly MICROSOFT_GRAPH_INLINE_ATTACHMENT_LIMIT_BYTES = 3 * 1024 * 1024;

  /**
   * Upload session chunk size. Must be a multiple of 320 KiB per Graph spec.
   * 4 MiB is the Microsoft-recommended sweet spot — large enough to amortize
   * round-trip overhead, small enough to keep retries cheap.
   */
  private static readonly UPLOAD_SESSION_CHUNK_BYTES = 4 * 1024 * 1024;

  /**
   * Hard upper bound for outlook message attachments via upload session
   * (per Microsoft docs). Beyond this, Graph rejects createUploadSession
   * outright — we fail fast with a clear message.
   */
  private static readonly MICROSOFT_GRAPH_UPLOAD_SESSION_LIMIT_BYTES = 150 * 1024 * 1024;

  private static async attachFileToDraft(
    accessToken: string,
    draftId: string,
    att: {
      name: string;
      contentType: string;
      content: Buffer | string;
      cid?: string;
      isInline?: boolean;
    },
  ): Promise<void> {
    const buffer = Buffer.isBuffer(att.content)
      ? att.content
      : Buffer.from(att.content, 'utf8');

    if (buffer.length > MicrosoftDeskService.MICROSOFT_GRAPH_UPLOAD_SESSION_LIMIT_BYTES) {
      const sizeMb = (buffer.length / (1024 * 1024)).toFixed(1);
      const limitMb =
        MicrosoftDeskService.MICROSOFT_GRAPH_UPLOAD_SESSION_LIMIT_BYTES / (1024 * 1024);
      throw new Error(
        `Attachment "${att.name}" is ${sizeMb}MB which exceeds the ${limitMb}MB Microsoft Graph upload limit.`,
      );
    }

    if (buffer.length <= MicrosoftDeskService.MICROSOFT_GRAPH_INLINE_ATTACHMENT_LIMIT_BYTES) {
      await MicrosoftDeskService.attachFileInline(accessToken, draftId, att, buffer);
      return;
    }

    await MicrosoftDeskService.attachFileViaUploadSession(accessToken, draftId, att, buffer);
  }

  /** Inline attach for files ≤ 3 MB (single base64 POST). */
  private static async attachFileInline(
    accessToken: string,
    draftId: string,
    att: { name: string; contentType: string; cid?: string; isInline?: boolean },
    buffer: Buffer,
  ): Promise<void> {
    const contentBytes = buffer.toString('base64');
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
          ...(att.isInline && { isInline: true }),
          ...(att.cid && { contentId: att.cid }),
        }),
      },
    );
    if (!res.ok) {
      const errBody = await res.text();
      logger.error(`Microsoft attachment add failed (${res.status}) for ${att.name}: ${errBody}`);
      throw new Error(`${res.status}: ${extractGraphErrorMessage(errBody)}`);
    }
  }

  /**
   * Chunked upload for files > 3 MB. Microsoft Graph upload session protocol:
   *   1. POST /messages/{id}/attachments/createUploadSession  → { uploadUrl }
   *   2. PUT chunks to uploadUrl with `Content-Range: bytes a-b/total`
   *      until all bytes uploaded. Final PUT returns the attachment.
   * The uploadUrl is pre-authenticated — chunk PUTs do NOT include our
   * Bearer token (sending it would be a protocol error).
   */
  private static async attachFileViaUploadSession(
    accessToken: string,
    draftId: string,
    att: { name: string; contentType: string; cid?: string; isInline?: boolean },
    buffer: Buffer,
  ): Promise<void> {
    const totalSize = buffer.length;

    // 1. Create upload session.
    const sessionRes = await fetch(
      `${config.microsoftGraph.baseUrl}/me/messages/${draftId}/attachments/createUploadSession`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          AttachmentItem: {
            attachmentType: 'file',
            name: att.name,
            size: totalSize,
            contentType: att.contentType,
            ...(att.isInline && { isInline: true }),
            ...(att.cid && { contentId: att.cid }),
          },
        }),
      },
    );
    if (!sessionRes.ok) {
      const errBody = await sessionRes.text();
      logger.error(
        `Microsoft createUploadSession failed (${sessionRes.status}) for ${att.name}: ${errBody}`,
      );
      throw new Error(`${sessionRes.status}: ${extractGraphErrorMessage(errBody)}`);
    }
    const session = (await sessionRes.json()) as { uploadUrl?: string };
    const uploadUrl = session.uploadUrl;
    if (!uploadUrl) {
      throw new Error(
        `Microsoft createUploadSession returned no uploadUrl for ${att.name}.`,
      );
    }

    // 2. Stream chunks. Content-Range is inclusive on both ends, total is N.
    const chunkSize = MicrosoftDeskService.UPLOAD_SESSION_CHUNK_BYTES;
    for (let offset = 0; offset < totalSize; offset += chunkSize) {
      const end = Math.min(offset + chunkSize, totalSize);
      const chunk = buffer.subarray(offset, end);
      const contentRange = `bytes ${offset}-${end - 1}/${totalSize}`;

      const putRes = await fetch(uploadUrl, {
        method: 'PUT',
        headers: {
          'Content-Length': String(chunk.length),
          'Content-Range': contentRange,
        },
        body: chunk,
      });

      // Graph returns 202 for intermediate chunks and 200/201 for the final
      // chunk (with the attachment payload). Anything else is fatal.
      if (putRes.status !== 202 && putRes.status !== 200 && putRes.status !== 201) {
        const errBody = await putRes.text();
        logger.error(
          `Microsoft upload session chunk failed (${putRes.status}) for ${att.name} range ${contentRange}: ${errBody}`,
        );
        throw new Error(
          `${putRes.status}: ${extractGraphErrorMessage(errBody)}`,
        );
      }
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
       *
       * `fromEmailAddress` triggers a send-as flow: an address the auth'd user
       * has Send-As / Send-on-Behalf permission for (a shared mailbox or DL
       * configured in Exchange Admin Center). Graph honors the override on
       * the message body's `from` field; when omitted the user's primary
       * mailbox sends as-is.
       */
      async replyToConversation(params: {
        content: string;
        subject: string;
        to: string[];
        cc?: string[];
        bcc?: string[];
        latestExternalMessageId: string;
        threadId: string;
        fromEmailAddress?: string;
        /** Optional inline attachments (e.g. an ICS calendar invite or user-uploaded files). */
        attachments?: Array<{
          name: string;
          contentType: string;
          content: Buffer | string;
          cid?: string;
          isInline?: boolean;
        }>;
      }): Promise<{ threadId: string; messageId: string }> {
        const {
          content,
          subject,
          to,
          cc,
          bcc,
          latestExternalMessageId,
          threadId,
          fromEmailAddress,
          attachments,
        } = params;
        const accessToken = await getAccessToken();
        const fromOverride = fromEmailAddress
          ? { from: { emailAddress: { address: fromEmailAddress } } }
          : {};

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
          //    NB: `from` is intentionally NOT set in the createReply body —
          //    Graph silently ignores it there. The reliable path is a
          //    follow-up PATCH on the draft (step 1b below).
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

          // 1b. Patch the draft's `from` to the send-as alias / DL when one
          //     was requested. Graph rejects with 403 if the auth'd user
          //     lacks Send-As permission on that mailbox / DL — surfaces
          //     here before send so the user gets a clear "permission
          //     missing" error instead of a silently-from-my-mailbox mail.
          if (fromEmailAddress) {
            const patchResponse = await fetch(
              `${config.microsoftGraph.baseUrl}/me/messages/${draft.id}`,
              {
                method: 'PATCH',
                headers: {
                  Authorization: `Bearer ${accessToken}`,
                  'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                  from: { emailAddress: { address: fromEmailAddress } },
                }),
              },
            );

            if (!patchResponse.ok) {
              const errorBody = await patchResponse.text();
              await MicrosoftDeskService.deleteDraft(accessToken, draft.id);
              logger.error(
                `Microsoft draft PATCH from-override failed: ${patchResponse.status} ${errorBody}`,
                { fromEmailAddress },
              );
              throw new Error(
                `Cannot send as ${fromEmailAddress}: the connected mailbox lacks Send-As permission on this address. Grant Send-As in Exchange Admin Center, then try again. (Graph: ${patchResponse.status})`,
              );
            }
          }

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

          // 3. Post-send verification. Even with the PATCH succeeding, some
          //    Send-As edge cases (DL nesting, recently-granted permissions
          //    not yet propagated) cause Graph to silently fall back to the
          //    user's primary mailbox at send time. Query the sent item's
          //    actual `from` and warn loudly so the user knows the
          //    recipient saw the wrong address — without raising the cost
          //    of every successful send.
          if (fromEmailAddress) {
            try {
              const sentLookup = await fetch(
                `${config.microsoftGraph.baseUrl}/me/messages/${draft.id}?$select=from`,
                { headers: { Authorization: `Bearer ${accessToken}` } },
              );
              if (sentLookup.ok) {
                const sentBody = (await sentLookup.json()) as {
                  from?: { emailAddress?: { address?: string } };
                };
                const actual = sentBody.from?.emailAddress?.address?.toLowerCase();
                const requested = fromEmailAddress.toLowerCase();
                if (actual && actual !== requested) {
                  logger.warn(
                    `Microsoft reply: send-as override silently dropped by Graph. requested=${requested} actual=${actual} — user likely lacks Send-As permission on the alias/DL`,
                    { draftId: draft.id, internetMessageId: draft.internetMessageId },
                  );
                }
              }
            } catch (verifyErr) {
              logger.warn(
                'Microsoft reply: send-as post-send verification failed',
                verifyErr,
              );
            }
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
            ...fromOverride,
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
          `${config.microsoftGraph.baseUrl}/me/mailFolders/sentitems/messages?$top=1&$orderby=sentDateTime desc&$select=internetMessageId,conversationId,from`,
          { headers: { Authorization: `Bearer ${accessToken}` } }
        );

        if (sentItemsResponse.ok) {
          const result = (await sentItemsResponse.json()) as {
            value: Array<{
              internetMessageId: string;
              conversationId: string;
              from?: { emailAddress?: { address?: string } };
            }>;
          };
          const sent = result.value?.[0];
          if (sent?.internetMessageId && sent?.conversationId) {
            const actualFrom = sent.from?.emailAddress?.address;
            if (
              fromEmailAddress &&
              actualFrom &&
              actualFrom.toLowerCase() !== fromEmailAddress.toLowerCase()
            ) {
              logger.warn(
                `Microsoft reply (sendMail fallback): send-as override silently dropped. requested=${fromEmailAddress.toLowerCase()} actual=${actualFrom.toLowerCase()} — user likely lacks Send-As permission`,
                { internetMessageId: sent.internetMessageId },
              );
            }
            logger.info(`Microsoft email sent successfully: ${sent.internetMessageId}`);
            return { threadId: sent.conversationId, messageId: sent.internetMessageId };
          }
        }

        logger.warn('Microsoft email sent but unable to resolve internetMessageId from sent items');
        throw new Error('Sent email but could not resolve message ID');
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
      }): Promise<{ threadId: string; messageId: string; fromEmail: string }> {
        const accessToken = await getAccessToken();

        const sendMailPayload: Record<string, unknown> = {
          message: {
            subject: params.subject,
            body: { contentType: 'html', content: params.content },
            toRecipients: formatRecipients(params.to),
            ...(params.cc?.length && { ccRecipients: formatRecipients(params.cc) }),
            ...(params.bcc?.length && { bccRecipients: formatRecipients(params.bcc) }),
            ...(params.fromEmailAddress && {
              from: { emailAddress: { address: params.fromEmailAddress } },
            }),
            ...(params.attachments?.length && {
              attachments: params.attachments.map(a => ({
                '@odata.type': '#microsoft.graph.fileAttachment',
                name: a.name,
                contentType: a.contentType,
                contentBytes: Buffer.isBuffer(a.content)
                  ? a.content.toString('base64')
                  : Buffer.from(a.content).toString('base64'),
                ...(a.isInline && { isInline: true }),
                ...(a.cid && { contentId: a.cid }),
              })),
            }),
          },
          saveToSentItems: true,
        };

        const sendMailResponse = await fetch(`${config.microsoftGraph.baseUrl}/me/sendMail`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
          body: JSON.stringify(sendMailPayload),
        });

        if (!sendMailResponse.ok) {
          const errorBody = await sendMailResponse.text();
          logger.error(`Microsoft sendMail (new) failed: ${sendMailResponse.status} ${errorBody}`);
          throw new Error(`Failed to send email: ${sendMailResponse.status}`);
        }

        const sentItemsResponse = await fetch(
          `${config.microsoftGraph.baseUrl}/me/mailFolders/sentitems/messages?$top=1&$orderby=sentDateTime desc&$select=internetMessageId,conversationId,from`,
          { headers: { Authorization: `Bearer ${accessToken}` } },
        );

        if (!sentItemsResponse.ok) {
          throw new Error('Sent email but could not look up sent item for IDs');
        }

        const sentResult = (await sentItemsResponse.json()) as {
          value: Array<{
            internetMessageId: string;
            conversationId: string;
            from?: { emailAddress?: { address?: string } };
          }>;
        };
        const sent = sentResult.value?.[0];

        if (!sent?.internetMessageId || !sent?.conversationId) {
          throw new Error('Sent email but could not resolve message ID from sent items');
        }

        const fromEmail =
          sent.from?.emailAddress?.address ||
          (await microsoftDeskService.resolveEmail(accessToken).catch(() => null)) ||
          '';

        if (
          params.fromEmailAddress &&
          fromEmail &&
          fromEmail.toLowerCase() !== params.fromEmailAddress.toLowerCase()
        ) {
          logger.warn(
            `Microsoft new email: send-as override silently dropped by Graph. requested=${params.fromEmailAddress.toLowerCase()} actual=${fromEmail.toLowerCase()} — user likely lacks Send-As permission on the alias/DL`,
            { internetMessageId: sent.internetMessageId },
          );
        }

        logger.info(`Microsoft new email sent: ${sent.internetMessageId}`);
        return {
          threadId: sent.conversationId,
          messageId: sent.internetMessageId,
          fromEmail,
        };
      },
    };
  }
}

export const microsoftDeskService = new MicrosoftDeskService();
