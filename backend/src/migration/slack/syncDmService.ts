/**
 * /sync-dm command handler
 * Migrates ALL DMs (1:1 and group) of the token holder to Xyne Spaces.
 *
 * Flow:
 *  1. auth.test  → identify the caller's Slack user ID
 *  2. users.info → resolve caller email → Xyne user ID
 *  3. conversations.list(types=im,mpim) → every DM the user has
 *  4. For each DM:
 *     a. Resolve all other participants (Slack → email → Xyne user)
 *     b. findOrCreateDMChannel(callerXyneId, [otherXyneIds], workspaceId)
 *        → dedup: sorted participant list used as channel name, so
 *          personA→personB and personB→personA resolve to the same channel
 *     c. Check externalSource slackMigration-{slackDmId}: skip if already done
 *     d. conversations.info → channel.created timestamp
 *     e. runMigrationDm → full history migration
 */

import { WebClient } from '@slack/web-api';
import { Request, Response } from 'express';
import { logger } from '../../utils/logger';
import { checkUserAuthorization } from './command';
import { runMigrationDm } from './slackConversationService';
import { getSyncDmModal } from './utils/blockKit';
import { postMessage } from './utils/postMessage';
import { UserRepository } from '../../database/repositories/users';
import { ChannelRepository } from '../../database/repositories/channelRepository';
import { ChannelParticipantRepository } from '../../database/repositories/channelParticipantRepository';
import { findOrCreateUser } from '../scripts/ingestConversationSlack';
import { getUserInfo, UserInfoCache } from './utils/extractConversation';
import { config } from '../../config/env';
import { getBotConfigByTeamId, getBotConfigByWorkspaceId, getWorkspaceIdByTeamId } from './slackMigrationBotConfig';
import { db } from '../../database/client';
import { AuthProvider } from '@prisma/client';

// ─────────────────────────────────────────────────────────────────────────────
// Command handler — opens the modal
// ─────────────────────────────────────────────────────────────────────────────

export async function handleSyncDmCommand(req: Request, res: Response): Promise<Response> {
  try {
    const { trigger_id, channel_id, user_id, team_id } = req.body;

    const token = getBotConfigByTeamId(team_id).slackBotToken;
    if (!token) {
      logger.error('[Migration] slackBotToken is not set for team', { team_id });
      return res.status(200).json({
        response_type: 'ephemeral',
        text: 'Slack integration is not configured.',
      });
    }

    const authResult = await checkUserAuthorization(user_id, team_id);
    if (!authResult.authorized) {
      logger.warn('[Migration] Unauthorized user attempted /sync-dm command', { user_id, team_id });
      return res.status(200).json({
        response_type: 'ephemeral',
        text: authResult.message || 'You are not authorized to perform this action.',
      });
    }

    const client = new WebClient(token);
    await client.views.open({
      trigger_id,
      view: getSyncDmModal(channel_id) as any,
    });

    return res.status(200).send();
  } catch (error) {
    logger.error('[Migration] Error handling /sync-dm command', {
      error: error instanceof Error ? error.message : 'Unknown error',
    });
    return res.status(200).json({
      response_type: 'ephemeral',
      text: 'Failed to open modal. Please try again.',
    });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Bulk DM migration
// ─────────────────────────────────────────────────────────────────────────────

// Dedicated Slack channel for ALL /sync-dm updates (plan, progress, summary).
// The migration bot must be a member of this channel to post. Override via env.
const SYNC_DM_LOG_CHANNEL = process.env.SYNC_DM_LOG_CHANNEL || 'C0BCN9BDQMN';

// How many DMs/group-DMs to migrate concurrently. Override via env; defaults to 3.
// Falls back to 3 for missing/invalid/non-positive values.
const SYNC_DM_CONCURRENCY = (() => {
  const parsed = parseInt(process.env.SYNC_DM_CONCURRENCY ?? '', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 3;
})();

export async function runMigrationAllDms({
  userToken,
  userId: slackUserId,
  teamId,
}: {
  userToken: string;
  userId?: string;
  // Accepted for API compatibility but ignored — all updates go to SYNC_DM_LOG_CHANNEL.
  responseChannelId?: string;
  teamId?: string;
}): Promise<void> {
  const workspaceId = (teamId ? getWorkspaceIdByTeamId(teamId) : '') || config.defaultWorkspaceId;
  const wsConfig = getBotConfigByWorkspaceId(workspaceId || '');
  // All /sync-dm updates go to the dedicated sync-dm channel.
  const logChannelId = SYNC_DM_LOG_CHANNEL;
  const userClient = new WebClient(userToken);
  const dmBotToken = wsConfig.slackBotToken;

  if (!workspaceId) {
    logger.error('[SyncDM] defaultWorkspaceId not configured');
    if (logChannelId) {
      await postMessage({ channelId: logChannelId, text: '❌ Migration failed: defaultWorkspaceId is not configured.', botToken: dmBotToken });
    }
    return;
  }

  // ── Step 1: Identify the caller ──────────────────────────────────────────
  let callerSlackId: string;
  try {
    const authTest = await userClient.auth.test();
    callerSlackId = authTest.user_id as string;
  } catch (err) {
    logger.error('[SyncDM] auth.test failed — invalid user token', { error: err });
    if (logChannelId) {
      await postMessage({ channelId: logChannelId, text: '❌ DM migration failed: invalid user token (auth.test failed).', botToken: dmBotToken });
    }
    return;
  }

  // ── Step 2: Resolve caller to Xyne user ──────────────────────────────────
  const userRepo = new UserRepository();
  const userCache = new Map<string, { id: string; isDeactivated: boolean }>();

  const callerXyneId = await resolveSlackToXyneUser(
    callerSlackId, userClient, userRepo, userCache, workspaceId
  );

  if (!callerXyneId) {
    logger.error('[SyncDM] Could not resolve caller to a Xyne user', { callerSlackId });
    if (logChannelId) {
      await postMessage({ channelId: logChannelId, text: '❌ DM migration failed: your Slack account is not registered in Xyne.', botToken: dmBotToken });
    }
    return;
  }

  // ── Step 3: List all DMs ─────────────────────────────────────────────────
  const allDms: any[] = [];
  let cursor: string | undefined;

  do {
    const result = await userClient.conversations.list({
      types: 'im,mpim',
      exclude_archived: false,
      limit: 200,
      cursor,
    });

    if (result.channels) {
      allDms.push(...result.channels);
    }
    cursor = (result.response_metadata as any)?.next_cursor || undefined;
  } while (cursor);

  logger.info('[SyncDM] Found DMs to migrate', { count: allDms.length, callerSlackId });

  if (logChannelId) {
    await postMessage({
      channelId: logChannelId,
      text: `🔄 Starting DM migration for <@${slackUserId}>: found *${allDms.length}* DM conversation(s) (including bots/unresolvable users — those will be skipped).`,
      botToken: dmBotToken,
    });
  }

  // ── Step 3.5: Pre-provision ALL participants from ALL DMs ─────────────────
  // This ensures @mentions work correctly even if mentioned users haven't been
  // created yet (e.g., Archit's DM mentions @suryansh before Suryansh's DM is migrated)
  logger.info('[SyncDM] Pre-provisioning all DM participants', { dmCount: allDms.length });

  const allParticipantIds = new Set<string>();
  for (const dm of allDms) {
    if (dm.is_im && dm.user) {
      allParticipantIds.add(dm.user);
    } else if (dm.is_mpim) {
      try {
        const membersResult = await userClient.conversations.members({ channel: dm.id });
        const members: string[] = (membersResult.members as string[]) || [];
        members.forEach((id) => allParticipantIds.add(id));
      } catch (_err) {
        // conversations.members can fail for some DMs; skip
      }
    }
  }

  const userInfoCache: UserInfoCache = new Map();
  let provisioned = 0;

  for (const slackId of allParticipantIds) {
    try {
      const userInfo = await getUserInfo(slackId, userInfoCache, workspaceId);
      if (!userInfo || userInfo.isBot) continue;
      if (!userInfo.userEmail || !userInfo.userName) continue;
      if (!userInfo.userId) {
        await findOrCreateUser(
          userInfo.userEmail,
          userInfo.userName,
          userInfo.isDeactivated ?? false,
          userRepo,
          userCache,
          workspaceId,
        );
        provisioned++;
      }
    } catch (err) {
      logger.warn('[SyncDM] Failed to provision participant', {
        slackId,
        error: err instanceof Error ? err.message : err,
      });
    }
  }

  logger.info('[SyncDM] Pre-provisioning complete', { total: allParticipantIds.size, provisioned });

  const channelRepo = new ChannelRepository();
  const channelParticipantRepo = new ChannelParticipantRepository();

  let migrated = 0;
  let skippedUnresolvable = 0;
  let failed = 0;
  let alreadyMigrated = 0;
  // Non-empty DMs we actually consider. Empty DMs (zero messages) are skipped
  // up front and never counted or surfaced anywhere.
  let consideredDms = 0;

  // ── Step 4: Classify each DM — already fully migrated vs. pending ─────────
  // A DM's Xyne channel is marked isMigrated=true only after ALL of its batches
  // finish (see runMigrationDm). So on a re-run we skip fully migrated DMs and
  // resume the rest — including any interrupted half-way (still isMigrated=false).
  interface PendingDm {
    slackDmId: string;
    xyneDmChannelId: string;
  }
  const pending: PendingDm[] = [];

  for (const dm of allDms) {
    const slackDmId: string = dm.id;

    try {
      // ── 4a: Skip empty DMs up front ──────────────────────────────────
      // conversations.history(limit:1) with an empty `messages` array means the
      // DM has no messages at all — nothing to migrate, so we never create a
      // Xyne channel for it and don't count it anywhere. On a probe error we do
      // NOT skip (fall through) so a transient failure can't drop a real DM.
      try {
        const probe = await userClient.conversations.history({ channel: slackDmId, limit: 1, inclusive: true });
        if (!probe.messages || probe.messages.length === 0) {
          logger.info('[SyncDM] Empty DM (no messages) — skipping, no channel created', { slackDmId });
          continue;
        }
      } catch (err) {
        logger.warn('[SyncDM] Empty-DM probe failed, proceeding with migration', {
          slackDmId,
          error: err instanceof Error ? err.message : err,
        });
      }

      consideredDms++;

      // ── 4b: Resolve other participant(s) ─────────────────────────────
      let otherSlackIds: string[] = [];

      if (dm.is_im) {
        // 1:1 DM — other person is in dm.user
        if (dm.user) otherSlackIds = [dm.user];
      } else if (dm.is_mpim) {
        // Group DM — fetch members
        const membersResult = await userClient.conversations.members({ channel: slackDmId });
        const members: string[] = (membersResult.members as string[]) || [];
        otherSlackIds = members.filter((id) => id !== callerSlackId);
      }

      if (otherSlackIds.length === 0) {
        logger.warn('[SyncDM] No other participants found, skipping', { slackDmId });
        skippedUnresolvable++;
        continue;
      }

      const otherXyneIds: string[] = [];
      for (const slackId of otherSlackIds) {
        const xyneId = await resolveSlackToXyneUser(slackId, userClient, userRepo, userCache, workspaceId);
        if (xyneId) {
          otherXyneIds.push(xyneId);
        } else {
          logger.warn('[SyncDM] Could not resolve participant, skipping DM', { slackDmId, slackId });
        }
      }

      if (otherXyneIds.length === 0) {
        logger.warn('[SyncDM] No resolvable Xyne participants, skipping', { slackDmId });
        skippedUnresolvable++;
        continue;
      }

      // ── 4b: Find or create Xyne DM channel ──────────────────────────
      // findOrCreateDMChannel sorts participant IDs → dedup guarantee:
      // person A running /sync-dm after person B will find the same channel.
      const xyneDmChannelId = await channelRepo.findOrCreateDMChannel(
        callerXyneId,
        otherXyneIds,
        channelParticipantRepo,
        workspaceId
      );

      // ── 4c: Skip if this DM's channel is already fully migrated ──────
      const xyneChannel = await channelRepo.findById(xyneDmChannelId);
      if (xyneChannel && (xyneChannel as any).isMigrated) {
        logger.info('[SyncDM] Already fully migrated, skipping', { slackDmId, xyneDmChannelId });
        alreadyMigrated++;
        continue;
      }

      pending.push({ slackDmId, xyneDmChannelId });
    } catch (err) {
      logger.error('[SyncDM] Failed to classify DM', {
        slackDmId,
        error: err instanceof Error ? err.message : err,
      });
      failed++;
    }
  }

  // ── Step 4.5: Report the plan (migrated vs. yet-to-migrate) ───────────────
  // Counts reflect only non-empty DMs (consideredDms); empty DMs are excluded.
  logger.info('[SyncDM] Migration plan', {
    total: consideredDms,
    alreadyMigrated,
    toMigrate: pending.length,
    skippedUnresolvable,
  });
  if (logChannelId) {
    await postMessage({
      channelId: logChannelId,
      text:
        `📊 DM migration plan for <@${slackUserId}>:\n` +
        `• Total conversations: *${consideredDms}*\n` +
        `• ✅ Already migrated (skipping): *${alreadyMigrated}*\n` +
        `• 🔄 To migrate now: *${pending.length}*\n` +
        `• ⏭️ Skipped (bot/unresolvable): *${skippedUnresolvable}*`,
      botToken: dmBotToken,
    });
  }

  // ── Step 5: Migrate the pending DMs (up to SYNC_DM_CONCURRENCY at a time) ──
  // Each DM threads its own updates under its own message in the log channel,
  // so concurrent runs stay readable even though they interleave in time.
  const migrateOne = async ({ slackDmId, xyneDmChannelId }: PendingDm): Promise<void> => {
    try {
      // Get DM creation timestamp so we capture full history from day 1.
      let dmCreatedTimestamp: number | undefined;
      try {
        const info = await userClient.conversations.info({ channel: slackDmId });
        const created = (info.channel as any)?.created;
        if (typeof created === 'number') dmCreatedTimestamp = created;
      } catch (err) {
        logger.warn('[SyncDM] Could not get channel created timestamp', { slackDmId, error: err });
      }

      logger.info('[SyncDM] Migrating DM', { slackDmId, xyneDmChannelId, dmCreatedTimestamp });

      const result = await runMigrationDm({
        dmChannelId: slackDmId,
        xyneSpaceChannelId: xyneDmChannelId,
        userToken,
        dmCreatedTimestamp,
        userId: slackUserId,
        responseChannelId: logChannelId,
      });

      if (result.success) {
        migrated++;
      } else {
        failed++;
      }
    } catch (err) {
      logger.error('[SyncDM] Failed to migrate DM', {
        slackDmId,
        error: err instanceof Error ? err.message : err,
      });
      failed++;
    }
  };

  // Fixed-size worker pool: keeps up to SYNC_DM_CONCURRENCY migrations in flight.
  let nextIndex = 0;
  const worker = async (): Promise<void> => {
    while (nextIndex < pending.length) {
      const dm = pending[nextIndex++];
      await migrateOne(dm);
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(SYNC_DM_CONCURRENCY, pending.length) }, () => worker()),
  );

  // ── Summary ───────────────────────────────────────────────────────────────
  if (logChannelId) {
    await postMessage({
      channelId: logChannelId,
      text: `✅ DM migration complete for <@${slackUserId}>:\n• Migrated: ${migrated}\n• Already migrated (skipped): ${alreadyMigrated}\n• Skipped (bot/unresolvable user): ${skippedUnresolvable}\n• Failed: ${failed}`,
      botToken: dmBotToken,
    });
  }

  logger.info('[SyncDM] Bulk DM migration complete', { migrated, skippedUnresolvable, failed, callerSlackId });
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

async function resolveSlackToXyneUser(
  slackId: string,
  client: WebClient,
  userRepo: UserRepository,
  cache: Map<string, { id: string; isDeactivated: boolean }>,
  workspaceId: string
): Promise<string | null> {
  try {
    const info = await client.users.info({ user: slackId });
    const profile = (info.user as any)?.profile;
    const email: string | undefined = profile?.email;
    const name: string =
      profile?.real_name || profile?.display_name || profile?.first_name || slackId;
    const isDeactivated = !!(info.user as any)?.deleted;

    if (!email) {
      logger.warn('[SyncDM] Slack user has no email', { slackId });
      return null;
    }

    try {
      const xyneId = await findOrCreateUser(email, name, isDeactivated, userRepo, cache, workspaceId);
      return xyneId || null;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (!msg.includes('orgMember not found')) throw err;

      // ── Auto-provision: user is in Slack workspace but not yet invited to Xyne ──
      logger.info('[SyncDM] Auto-provisioning orgMember for DM participant', { email, name });

      // Derive orgId from the default workspace
      const targetWorkspaceId = config.defaultWorkspaceId || workspaceId;
      const wsOrg = await db.workspaceOrganization.findFirst({
        where: { workspaceId: targetWorkspaceId },
        select: { orgId: true },
      });
      if (!wsOrg?.orgId) {
        logger.warn('[SyncDM] Could not derive orgId for workspace, skipping participant', { workspaceId: targetWorkspaceId, email });
        return null;
      }

      // Upsert orgMember (idempotent — in case of race)
      const orgMember = await db.orgMember.upsert({
        where: { email: email.toLowerCase() },
        update: { leftAt: null },
        create: {
          orgId: wsOrg.orgId,
          email: email.toLowerCase(),
          role: 'MEMBER',
        },
      });

      // Create the Xyne user linked to the orgMember
      const user = await userRepo.create({
        email: email.toLowerCase(),
        name,
        providerUserId: `slack-migrated-${email.toLowerCase()}`,
        authProvider: AuthProvider.GOOGLE,
        status: isDeactivated ? 'INACTIVE' : 'ACTIVE',
        workspace: { connect: { id: targetWorkspaceId } },
        orgMember: { connect: { memberId: orgMember.memberId } },
      });

      logger.info('[SyncDM] Auto-provisioned Xyne user for DM participant', { userId: user.id, email });
      if (cache) cache.set(email, { id: user.id, isDeactivated });
      return user.id;
    }
  } catch (err) {
    logger.warn('[SyncDM] Could not resolve Slack user', {
      slackId,
      error: err instanceof Error ? err.message : err,
    });
    return null;
  }
}
