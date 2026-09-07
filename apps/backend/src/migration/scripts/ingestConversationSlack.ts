/**
 * Slack Conversation Ingest Service
 * Handles bulk ingestion of Slack conversations with thread support
 */

import { logger } from '../../utils/logger';
import { AuthProvider, ExternalEntityType, MessageDirection, WorkspaceRole, UserType, MessageType, OrgRole, UserStatus } from '@xyne/shared';
import { UserRepository } from '../../database/repositories/users';
import { MessageRepository } from '../../database/repositories/messageRepository';
import { ExternalMessageRepository } from '../../database/repositories/externalMessageRepository';
import { ExternalSourceRepository } from '../../database/repositories/externalSourceRepository';
import { ChannelRepository } from '../../database/repositories/channelRepository';
import crypto from 'crypto';
import { SlackMessage, SlackFile, UserInfoCache } from '../slack/utils/extractConversation';
import {
  ExternalAttachmentService,
  ExternalAttachment,
  DownloadedAttachment,
} from '@/services/externalAttachmentService';
import { encrypt } from '../../services/encryptionService';
import { config } from '../../config/env';
import { conversationService } from '../../services/conversationService';
import { grantPermissionsForRole } from '../../services/permissionMatrix';
import { db } from '@/database/client';

// ============================================================================
// Types
// ============================================================================

export interface IngestConversationSlackInput {
  slackMessages: SlackMessage[];
  externalSourceName: string;
  channelId: string;
  onlyReplies?: boolean;
  workspaceId: string;
  userToken?: string;
  botToken?: string;
  /**
   * When true, do NOT flip the channel's `isMigrated` flag here. Used by the
   * DM flow (sync-dm), which ingests in many sub-batches but only wants the
   * channel marked migrated after the WHOLE DM finishes — see runMigrationDm.
   * Leave false/undefined for the regular channel flow (unchanged behaviour).
   */
  skipChannelMigratedUpdate?: boolean;
  /** Pause (ms) between messages to cap DB/Vespa-queue rate (self-serve migration); 0/undefined = unpaced. */
  interMessageDelayMs?: number;
  onProgress?: () => void;
}

export interface IngestConversationSlackResult {
  success: boolean;
  errorDetails?: string[];
}

interface MessageIngestionResult {
  messageId: string;
  conversationId: string;
}

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Parse Slack timestamp to Date object
 * Throws an error if unable to parse the timestamp
 */
export function parseSlackTimestamp(slackTs: string): Date {
  const timestamp = parseFloat(slackTs);

  if (isNaN(timestamp)) {
    throw new Error(`Invalid Slack timestamp (NaN): ${slackTs}`);
  }

  const date = new Date(timestamp * 1000);

  if (isNaN(date.getTime())) {
    throw new Error(`Invalid date from timestamp: ${slackTs} (parsed as ${timestamp})`);
  }

  return date;
}

export const findOrCreateUser = async (
  userEmail: string,
  userName: string,
  isDeactivated: boolean,
  userRepo: UserRepository,
  userCache: Map<string, { id: string; isDeactivated: boolean }> | undefined,
  workspaceId: string
): Promise<string> => {
  if (!userEmail && !userCache) {
    throw new Error(`Missing user email for user: ${userName}`);
  }

  if (userCache && userCache.has(userEmail)) {
    return userCache.get(userEmail)!.id;
  }

  let user = await userRepo.findByEmail(userEmail, workspaceId);

  if (!user) {
    let orgMember = await db.orgMember.findUnique({
      where: { email: userEmail },
      select: { memberId: true },
    });

    if (!orgMember) {
      const workspace = await db.workspace.findUnique({
        where: { id: workspaceId },
        select: { orgId: true },
      });
      if (!workspace) {
        throw new Error(`Workspace ${workspaceId} not found`);
      }
      try {
        orgMember = await db.orgMember.create({
          data: {
            orgId: workspace.orgId,
            email: userEmail,
            role: OrgRole.MEMBER,
          },
          select: { memberId: true },
        });
        logger.info('[IngestSlack] OrgMember created for migration user', { userEmail });
      } catch (err) {
        // Parallel ingest workers can create the same org member at the same instant — on a unique-violation, re-read the winner.
        if ((err as { code?: string })?.code !== 'P2002') throw err;
        orgMember = await db.orgMember.findUnique({ where: { email: userEmail }, select: { memberId: true } });
        if (!orgMember) throw err;
      }
    }

    try {
      user = await userRepo.create({
        email: userEmail,
        name: userName,
        providerUserId: `slack-migrated-${userEmail}`,
        authProvider: AuthProvider.GOOGLE,
        status: isDeactivated ? 'INACTIVE' : 'ACTIVE',
        workspace: { connect: { id: workspaceId } },
        orgMember: { connect: { memberId: orgMember.memberId } },
      });
      logger.info('[IngestSlack] User created', { userId: user.id, userEmail });
      await grantPermissionsForRole(user.id, userEmail, WorkspaceRole.MEMBER, workspaceId);
    } catch (err) {
      // Same race for the user row: another worker won — re-read and reuse it (its permissions are already granted).
      if ((err as { code?: string })?.code !== 'P2002') throw err;
      user = await userRepo.findByEmail(userEmail, workspaceId);
      if (!user) throw err;
    }
  }

  if (userCache) {
    userCache.set(userEmail, { id: user.id, isDeactivated });
  }
  return user.id;
};

/**
 * Create a new User (APP type) + InstalledApps row for the given app in the given workspace.
 * Email is derived from the app name slug + botId to guarantee global uniqueness:
 *   "Deploy Bot" + "BAAAA" → deploy-bot-baaaa@app.xyne.ai
 * This means each (botId, workspaceId) pair always gets its own distinct user row.
 */
const installAppForWorkspace = async (
  appId: string,
  appName: string,
  botId: string,
  workspaceId: string,
): Promise<string> => {
  const nameSlug = appName
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
  const botIdSlug = botId.toLowerCase().replace(/[^a-z0-9]/g, '');
  const email = `${nameSlug}-${botIdSlug}@app.xyne.ai`;

  const workspace = await db.workspace.findUnique({ where: { id: workspaceId }, select: { orgId: true } });
  if (!workspace) throw new Error(`[installAppForWorkspace] Workspace ${workspaceId} not found`);

  let orgMember = await db.orgMember.findUnique({ where: { email }, select: { memberId: true } });
  if (!orgMember) {
    orgMember = await db.orgMember.create({
      data: { email, orgId: workspace.orgId, role: OrgRole.MEMBER },
      select: { memberId: true },
    });
  }

  const appUser = await db.user.create({
    data: {
      name: appName,
      email,
      providerUserId: `xyne-app-${appId}-${workspaceId}`,
      authProvider: AuthProvider.API_KEY,
      userType: UserType.APP,
      status: UserStatus.ACTIVE,
      workspace: { connect: { id: workspaceId } },
      orgMember: { connect: { memberId: orgMember.memberId } },
    },
  });

  const signingSecret = crypto.randomBytes(32).toString('hex');
  const encryptedSecret = encrypt(signingSecret);
  const now = new Date();
  await db.installedApps.create({
    data: { appId, workspaceId, userId: appUser.id, signingSecret: encryptedSecret, version: 1, createdAt: now, updatedAt: now },
  });

  logger.info('[installAppForWorkspace] Created app user', { appId, workspaceId, botId, userId: appUser.id, email });
  return appUser.id;
};

/**
 * Find or create a Xyne user representing a Slack bot in the target workspace.
 *
 * Design principles:
 * - botId (BXXXXXXX) is the source of truth — one botId = one user per workspace.
 * - Each (botId, workspaceId) pair always gets its own apps + users + installed_apps row.
 *   No cross-workspace sharing of app rows.
 * - App name is `${botName}-${botId}` to disambiguate bots with similar names.
 * - Email uses botId suffix to guarantee global uniqueness:
 *   "Deploy Bot" + "BAAAA" → deploy-bot-baaaa@app.xyne.ai
 */
export const findOrCreateApp = async (
  botName: string,
  botId: string,
  botCache: UserInfoCache,
  botUserId?: string,
  workspaceId?: string
): Promise<string> => {
  // ── 0. In-memory cache hit (same migration run) ──────────────────────────
  if (botCache.has(botId)) {
    return botCache.get(botId)!.userId!;
  }

  const userRepo = new UserRepository();

  // ── 1. DB lookup: user already exists for this botId in this workspace ───
  // workspaceId is passed so the query is scoped to the target workspace.
  const existingUser = await userRepo.findByMetadataField('slackBotId', botId, workspaceId);
  if (existingUser) {
    botCache.set(botId, { userId: existingUser.id });
    logger.info('[findOrCreateApp] Reusing existing bot user', { botId, userId: existingUser.id, workspaceId });
    return existingUser.id;
  }

  // ── 2. Not found in target workspace — create fresh app + user ───────────
  // Each workspace gets its own apps row so workspace-scoped features
  // (permissions, webhooks, commands) are cleanly isolated.
  const xyneUser = await db.user.findFirst({ where: { email: 'john.doe@gmail.com' } });
  let creatorUser = xyneUser;
  if (!creatorUser) {
    if (config.env === 'development' && workspaceId) {
      creatorUser = await db.user.findFirst({ where: { workspaceId } });
    } else {
      throw new Error('[findOrCreateApp] Creator user john.doe@gmail.com not found');
    }
  }
  if (!creatorUser) {
    throw new Error('[findOrCreateApp] No fallback workspace user found for local migration');
  }

  // Build a unique app name so bots with identical display names (e.g. two
  // different "Jira" integrations) are distinguishable in the workspace.
  const uniqueBotName = `${botName.trim()}-${botId}`;

  // The app is owned by the target workspace's org — apps are ORG-scoped now.
  const targetWorkspaceId = workspaceId ?? creatorUser.workspaceId;
  const targetWorkspace = await db.workspace.findUnique({
    where: { id: targetWorkspaceId },
    select: { orgId: true },
  });
  if (!targetWorkspace?.orgId) {
    throw new Error(`[findOrCreateApp] Could not resolve org for workspace ${targetWorkspaceId}`);
  }

  // Create the apps row — bypass createApp()'s name-uniqueness check because
  // the same bot name is intentionally allowed across different workspaces.
  // Populate the org-scoped columns (orgId/scope/version) and an app-level
  // signing secret so the row is valid in the new multi-org model; without
  // these it's invisible in the Org/Marketplace views and hidden by the ACL.
  const now = new Date();
  const app = await db.apps.create({
    data: {
      name: uniqueBotName,
      workspaceId: targetWorkspaceId,
      createdBy: creatorUser.id,
      orgId: targetWorkspace.orgId,
      scope: 'ORG',
      version: 1,
      signingSecret: encrypt(crypto.randomBytes(32).toString('hex')),
      createdAt: now,
      updatedAt: now,
    },
  });

  // Create the user + installed_apps in the target workspace.
  // installAppForWorkspace uses email = slug-botId@app.xyne.ai, so this is
  // always unique regardless of bot name or how many workspaces the bot is in.
  const newUserId = await installAppForWorkspace(app.id, uniqueBotName, botId, targetWorkspaceId);

  await userRepo.upsertMetaDataField(newUserId, 'slackBotId', botId);
  if (botUserId) await userRepo.upsertMetaDataField(newUserId, 'slackId', botUserId);

  botCache.set(botId, { userId: newUserId });
  logger.info('[findOrCreateApp] Created new bot user', { botId, botName: uniqueBotName, workspaceId: targetWorkspaceId, userId: newUserId });
  return newUserId;
};

// ============================================================================
// Main Function
// ============================================================================

/**
 * Ingest Slack conversations into the database
 */
export async function ingestConversationSlack(
  input: IngestConversationSlackInput
): Promise<IngestConversationSlackResult> {
  const { slackMessages, externalSourceName, channelId, onlyReplies = false, workspaceId, userToken, botToken: inputBotToken, skipChannelMigratedUpdate = false, interMessageDelayMs = 0, onProgress } = input;

  logger.info('[IngestSlack] Starting ingestion', {
    externalSourceName,
    channelId,
    messageCount: slackMessages.length,
  });

  const errorDetails: string[] = [];

  try {
    // Initialize repositories
    const externalSourceRepo = new ExternalSourceRepository();
    const externalMessageRepo = new ExternalMessageRepository();
    const userRepo = new UserRepository();
    const messageRepo = new MessageRepository();
    const channelRepo = new ChannelRepository();

    // Get or create external source
    let externalSource = await externalSourceRepo.findByName(externalSourceName);

    if (!externalSource) {
      const botToken = inputBotToken || config.slackBotToken;
      if (!botToken) {
        throw new Error('SLACK_BOT_TOKEN is not configured');
      }

      const encryptedCredentials = encrypt(JSON.stringify({ botToken }));

      externalSource = await externalSourceRepo.create({
        name: externalSourceName,
        sourceType: 'slack',
        displayName: 'Slack Migration',
        channelId,
        credentials: encryptedCredentials,
      });

      logger.info('[IngestSlack] External source created', {
        externalSourceId: externalSource.id,
      });
    }

    const externalSourceId = externalSource.id;

    // User cache for lookups
    const userCache = new Map<string, { id: string; isDeactivated: boolean }>();
    const botCache: UserInfoCache = new Map();

    // Helper: Download attachments (returns empty array on failure)
    const downloadAttachments = async (
      slackFiles: SlackFile[] | undefined
    ): Promise<DownloadedAttachment[]> => {
      if (!slackFiles || slackFiles.length === 0) {
        return [];
      }

      try {
        const externalAttachments: ExternalAttachment[] = slackFiles
          // Keep if prefetched (self-serve offline) or it has a url_private to fetch. Gating on
          // userToken dropped attachments for callers without one; download failures skip downstream.
          .filter((file) => file.prefetchedStoragePath || file.url_private)
          .map((file) =>
            file.prefetchedStoragePath
              ? { fileName: file.name, mimeType: file.mimetype, size: file.size, storageSourcePath: file.prefetchedStoragePath, storageSourceEncrypted: true }
              : { fileName: file.name, fileUrl: file.url_private, mimeType: file.mimetype, size: file.size },
          );
        return await new ExternalAttachmentService().downloadAttachmentsForSource(
          externalSourceName,
          externalAttachments,
          {
            maxFileSize: 1024 * 1024 * 1024, // 1GB (Slack's max file size)
            timeout: 600000, // 10 minutes (enough to move a 1GB file)
            scopeType: 'EXTERNAL_MESSAGE',
            scopeId: externalSourceName,
            overrideToken: userToken, // Use user token for DM attachments
          }
        );
      } catch (error) {
        logger.error('[IngestSlack] Failed to download attachments', {
          error: error instanceof Error ? error.message : 'Unknown error',
        });
        return []; // Continue without attachments
      }
    };

    // Helper: Find existing conversation by thread
    const findConversationByThread = async (externalThreadId: string): Promise<string | null> => {
      const existingThreadMessage = await externalMessageRepo.findByThreadId(
        externalSourceId,
        externalThreadId,
        ExternalEntityType.MESSAGE
      );

      if (!existingThreadMessage || !existingThreadMessage.entityId) {
        return null;
      }

      const existingMessage = await messageRepo.findById(existingThreadMessage.entityId);
      return existingMessage?.conversationId || null;
    };

    // Helper: Ingest a single message (throws on failure)
    const ingestMessage = async (
      externalId: string,
      externalThreadId: string,
      content: string,
      userId?: string,
      userEmail?: string,
      userName?: string,
      isDeactivated: boolean = false,
      slackFiles?: SlackFile[],
      replyBroadcast?: boolean,
      botId?: string,
      botName?: string,
      botUserId?: string,
      isPinned?: boolean
    ): Promise<MessageIngestionResult> => {
      let resolvedUserId = userId;

      if (!resolvedUserId) {
        if (botId) {
          resolvedUserId = await findOrCreateApp(
            botName ?? botId,
            botId,
            botCache,
            botUserId,
            workspaceId
          );
        } else {
          if (!userEmail || !userName) {
            throw new Error(
              `Missing user information: userId=${userId}, email=${userEmail}, name=${userName}`
            );
          }
          resolvedUserId = await findOrCreateUser(
            userEmail,
            userName,
            isDeactivated,
            userRepo,
            userCache,
            workspaceId
          );
        }
      }

      // Parse timestamp (throws if fails)
      const createdAt = parseSlackTimestamp(externalId);

      // Download attachments (continues on failure)
      const downloadedAttachments = await downloadAttachments(slackFiles);

      // If a message had files but none migrated and there's no text, use file name(s) as
      // placeholder so the message isn't dropped.
      let effectiveContent = content;
      if ((!effectiveContent || !effectiveContent.trim()) && downloadedAttachments.length === 0 && (slackFiles?.length ?? 0) > 0) {
        effectiveContent = slackFiles!.map((f) => `📎 ${f.name}`).join(' ');
      }

      // Find or create conversation
      const existingConversationId = await findConversationByThread(externalThreadId);
      const isNewConversation = !existingConversationId;

      let message;
      let conversation;
      let conversationId: string;

      if (isNewConversation) {
        // Create new conversation with message (skip participant check since participants are added before migration)
        const result = await conversationService.createConversationWithMessage({
          channelId,
          userId: resolvedUserId,
          content: effectiveContent,
          msgType: MessageType.USER,
          uploadedFiles: downloadedAttachments,
          isBot: false,
          createdAt,
          isAddingParticipant: false,
          pinned: isPinned || false,
          suppressAutomations: true, // migrated history must never fire workflows/automations
        });

        message = result.message;
        conversation = result.conversation;
        conversationId = conversation.conversationId;
      } else {
        // Add message to existing conversation (skip participant check since participants are added before migration)
        conversationId = existingConversationId;

        const result = await conversationService.addMessageToConversation({
          conversationId,
          userId: resolvedUserId,
          content: effectiveContent,
          msgType: MessageType.USER,
          uploadedFiles: downloadedAttachments,
          replyBroadcast: replyBroadcast ?? false,
          isBot: false,
          lastActivityAt: createdAt,
          createdAt,
          isAddingParticipant: false,
          markParticipantsRead: true,
          suppressAutomations: true, // migrated history must never fire workflows/automations
        });

        message = result.message;
      }

      // Create external message tracking
      await externalMessageRepo.create({
        externalSourceId,
        externalId,
        externalThreadId,
        entityId: message.messageId,
        direction: MessageDirection.INCOMING,
      });

      return {
        messageId: message.messageId,
        conversationId,
      };
    };

    // Process all messages
    let ingestProgress = 0;
    for (const slackMessage of slackMessages) {
      if (++ingestProgress % 200 === 0) onProgress?.();
      try {
        // Skip main message ingestion if onlyReplies is true
        if (!onlyReplies) {
          // Check for duplicate top-level message.
          //
          // IMPORTANT: if the parent was already migrated (e.g. a previous run
          // was OOM-killed mid-thread, leaving the parent + some replies written
          // but the rest missing), we must NOT skip the whole thread. Doing so
          // permanently drops the un-migrated replies. Instead we only skip
          // re-inserting the parent and fall through to the reply loop below,
          // which back-fills any missing replies. Each reply is de-duped
          // independently, so re-running is fully idempotent.
          const existingTopLevel = await externalMessageRepo.findByExternalId(
            externalSourceId,
            slackMessage.externalId
          );

          if (!existingTopLevel) {
            // Ingest top-level message (throws on failure)
            // Use userId if available, otherwise use userEmail/userName or botId
            await ingestMessage(
              slackMessage.externalId,
              slackMessage.externalId, // externalThreadId same for top-level
              slackMessage.content,
              slackMessage.userId,
              slackMessage.userEmail,
              slackMessage.userName,
              slackMessage.isDeactivated || false,
              slackMessage.files,
              undefined,
              slackMessage.botId,
              slackMessage.botName,
              slackMessage.botUserId,
              slackMessage.isPinned
            );
          }
        }

        // Process thread replies
        if (slackMessage.replies && slackMessage.replies.length > 0) {
          for (const reply of slackMessage.replies) {
            try {
              // Check for duplicate reply
              const existingReply = await externalMessageRepo.findByExternalId(
                externalSourceId,
                reply.externalThreadId
              );

              if (existingReply) {
                continue; // Skip duplicate
              }

              // Ingest reply (throws on failure)
              // Use userId if available, otherwise use userEmail/userName or botId
              await ingestMessage(
                reply.externalThreadId,
                slackMessage.externalId, // parent thread ID
                reply.content,
                reply.userId,
                reply.userEmail,
                reply.userName,
                reply.isDeactivated || false,
                reply.files,
                reply.showInChannel ?? false,
                reply.botId,
                reply.botName,
                reply.botUserId,
                reply.isPinned
              );
            } catch (error) {
              const errorMsg = `Failed to ingest reply ${reply.externalThreadId}: ${
                error instanceof Error ? error.message : 'Unknown error'
              }`;
              errorDetails.push(errorMsg);
              logger.error('[IngestSlack] Reply ingestion failed', {
                replyId: reply.externalThreadId,
                error: error instanceof Error ? error.message : 'Unknown error',
              });
              // Continue with next reply
            }
          }
        }
      } catch (error) {
        const errorMsg = `Failed to ingest message ${slackMessage.externalId}: ${
          error instanceof Error ? error.message : 'Unknown error'
        }`;
        errorDetails.push(errorMsg);
        logger.error('[IngestSlack] Message ingestion failed', {
          externalId: slackMessage.externalId,
          error: error instanceof Error ? error.message : 'Unknown error',
        });
        // Continue with next message
      }
      // Pace DB writes / Vespa-queue jobs when the caller asks (self-serve migration).
      if (interMessageDelayMs > 0) await new Promise((r) => setTimeout(r, interMessageDelayMs));
    }

    logger.info('[IngestSlack] Ingestion completed', {
      totalMessages: slackMessages.length,
      errors: errorDetails.length,
    });

    // The DM flow defers this — it marks the channel migrated only after the
    // whole DM (all batches) completes, so a half-migrated DM stays isMigrated=false
    // and gets resumed on re-run. The channel flow marks it here, per batch, as before.
    if (!skipChannelMigratedUpdate) {
      const channel = await channelRepo.findById(channelId);
      if (channel && !(channel as any).isMigrated) {
        await channelRepo.update(channelId, { isMigrated: true });
        const project = channel.projectId
          ? await db.project.findUnique({ where: { id: channel.projectId }, select: { name: true } })
          : null;
        logger.info('analytics_event', {
          event: 'channel_migrated',
          timestamp: new Date().toISOString(),
          channelId,
          channelName: channel.name,
          channelProjectName: project?.name ?? null,
          sourceType: 'slack',
        });
      }
    }

    return {
      success: errorDetails.length === 0,
      errorDetails: errorDetails.length > 0 ? errorDetails : undefined,
    };
  } catch (error) {
    logger.error('[IngestSlack] Fatal error during ingestion', {
      error: error instanceof Error ? error.message : 'Unknown error',
      stack: error instanceof Error ? error.stack : undefined,
    });

    return {
      success: false,
      errorDetails: [`Fatal error: ${error instanceof Error ? error.message : 'Unknown error'}`],
    };
  }
}
