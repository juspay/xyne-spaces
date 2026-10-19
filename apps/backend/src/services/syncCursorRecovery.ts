import { ExternalSource } from '@prisma/client';
import { DeskType, NotificationType } from '@xyne/shared';
import { logger } from '@/utils/logger';
import { config } from '@/config/env';
import { db } from '@/database/client';
import { notificationService } from '@/notification-service';
import { ExternalSourceRepository } from '@/database/repositories/externalSourceRepository';
import { ExternalSourcePlatform } from '@/integrations/core/types';
import { GoogleService } from '@/services/googleService';
import { enqueueCursorCatchup, enqueueGapFetch } from '@/queues/emailFetchQueue';

const TAG = '[SyncCursorRecovery]';
const externalSourceRepo = new ExternalSourceRepository();
const MAX_ADVANCE_ATTEMPTS = 3;
// Gap fetches start a day early: mail that came just before the disconnect may not have been saved yet.
const GAP_FETCH_MARGIN_MS = 24 * 60 * 60 * 1000;

type CursorSource = Pick<
  ExternalSource,
  'id' | 'name' | 'sourceType' | 'channelId' | 'workspaceId' | 'ownerUserId' | 'updatedAt'
>;

/** Move the cursor forward after a range has been fully accounted for. */
export async function advanceSyncCursor(sourceId: string, historyId: string): Promise<void> {
  try {
    for (let attempt = 0; attempt < MAX_ADVANCE_ATTEMPTS; attempt++) {
      const source = await externalSourceRepo.findById(sourceId);
      if (!source) return;
      if (source.lastSyncCursor && BigInt(historyId) <= BigInt(source.lastSyncCursor)) return;

      // Compare-and-set, so a newer cursor written since our read is never replaced by this older one.
      if (await externalSourceRepo.compareAndSetSyncCursor(sourceId, source.lastSyncCursor, historyId)) {
        logger.info(`${TAG} [CURSOR_ADVANCED]`, {
          sourceId,
          sourceName: source.name,
          from: source.lastSyncCursor,
          to: historyId,
        });
        return;
      }
    }
    logger.warn(`${TAG} cursor kept changing during update — not advancing`, { sourceId, historyId });
  } catch (error) {
    logger.warn(`${TAG} failed to advance sync cursor`, { sourceId, error });
  }
}

export interface SeedSyncCursorParams {
  source: CursorSource;
  seedHistoryId: string;
  reason: 'cursor-expired' | 'no-cursor';
  requesterUserId?: string;
}

export async function seedSyncCursor(params: SeedSyncCursorParams): Promise<void> {
  const { source, seedHistoryId, reason, requesterUserId } = params;

  await externalSourceRepo.update(source.id, { lastSyncCursor: seedHistoryId });
  const details = { sourceId: source.id, sourceName: source.name, seededTo: seedHistoryId };

  if (reason === 'no-cursor') {
    logger.info(`${TAG} [CURSOR_SEEDED] seeded initial cursor`, details);
    return;
  }

  // No disconnect time here, so updatedAt is the start; it can be later than the last sync, so still notify.
  const gapFetchQueued = await queueGapFetch({ source, since: source.updatedAt, requesterUserId });

  if (!requesterUserId) {
    logger.error(`${TAG} [CURSOR_SEEDED] cursor expired unattended — gap needs a dated fetch`, {
      ...details,
      channelId: source.channelId,
      gapFetchQueued,
    });
    return;
  }

  logger.warn(`${TAG} [CURSOR_SEEDED] cursor skipped a gap beyond Gmail's history window`, details);
  await notifyBackfillRequired(source, requesterUserId);
}

/** Reconnect: true when Gmail no longer has history from the stored cursor. Any other error keeps the cursor. */
export async function isSyncCursorExpired(params: {
  sourceId: string;
  encryptedCredentials: string;
  cursor: string | null;
}): Promise<boolean> {
  const { sourceId, encryptedCredentials, cursor } = params;
  if (!cursor) return false;
  try {
    const google = GoogleService.fromEncryptedCredentials(encryptedCredentials, sourceId);
    return !(await google.hasHistoryFrom(cursor));
  } catch (error) {
    logger.warn(`${TAG} could not check the cursor on reconnect — keeping it`, {
      sourceId,
      error: error instanceof Error ? error.message : String(error),
    });
    return false;
  }
}

/** After a reconnect saved the row: catch up from the cursor, or fetch the gap by date if it had expired. */
export async function queueReconnectSync(params: {
  source: CursorSource;
  cursorExpired: boolean;
  disconnectedAt: Date;
  watchHistoryId: string;
  requesterUserId?: string;
}): Promise<void> {
  const { source, cursorExpired, disconnectedAt, watchHistoryId, requesterUserId } = params;
  if (!cursorExpired) {
    await enqueueCursorCatchup({ sourceId: source.id, watchHistoryId, requesterUserId });
    return;
  }

  logger.warn(`${TAG} [CURSOR_EXPIRED] reconnected after Gmail's history window — cursor reset`, {
    sourceId: source.id,
    sourceName: source.name,
    disconnectedAt,
  });
  if (await queueGapFetch({ source, since: disconnectedAt, requesterUserId })) return;
  if (requesterUserId) await notifyBackfillRequired(source, requesterUserId);
}

/**
 * Queues dated fetches, from a day before `since` to now, for mail the cursor can no longer reach.
 * Desk and DL mailboxes only: the channel email mailbox has no single address to fetch.
 */
export async function queueGapFetch(params: {
  source: CursorSource;
  since: Date;
  requesterUserId?: string;
}): Promise<boolean> {
  const { source, since, requesterUserId } = params;
  if (source.sourceType !== ExternalSourcePlatform.GOOGLE || !config.enableEmailFetchWorker) return false;

  const startDate = new Date(since.getTime() - GAP_FETCH_MARGIN_MS).toISOString();
  const endDate = new Date().toISOString();
  // A desk's own mailbox fetches into that desk; the shared DL mailbox fetches once per DL desk.
  const targets = source.channelId
    ? [{ channelId: source.channelId, dlEmail: null, ownerUserId: await deskOwnerId(source.channelId) }]
    : await db.emailChannelPreference.findMany({
        where: { workspaceId: source.workspaceId, deskType: DeskType.DL, dlEmail: { not: null } },
        select: { channelId: true, dlEmail: true, ownerUserId: true },
      });

  let queued = 0;
  for (const target of targets) {
    const notifyUserId = requesterUserId ?? source.ownerUserId ?? target.ownerUserId;
    if (!notifyUserId) {
      logger.warn(`${TAG} no user to notify — skipping gap fetch`, {
        sourceId: source.id,
        channelId: target.channelId,
      });
      continue;
    }
    const enqueued = await enqueueGapFetch({
      sourceId: source.id,
      channelId: target.channelId,
      requesterUserId: notifyUserId,
      workspaceId: source.workspaceId,
      startDate,
      endDate,
      ...(target.dlEmail && { targetChannelId: target.channelId, dlEmail: target.dlEmail }),
    });
    if (enqueued) queued++;
  }

  if (queued > 0) {
    logger.info(`${TAG} [GAP_FETCH_QUEUED]`, {
      sourceId: source.id,
      sourceName: source.name,
      startDate,
      endDate,
      jobs: queued,
    });
  }
  return queued > 0;
}

async function deskOwnerId(channelId: string): Promise<string | null> {
  const preference = await db.emailChannelPreference.findUnique({
    where: { channelId },
    select: { ownerUserId: true },
  });
  return preference?.ownerUserId ?? null;
}

async function notifyBackfillRequired(source: CursorSource, requesterUserId: string): Promise<void> {
  try {
    await notificationService.sendNotification(
      requesterUserId,
      NotificationType.EMAIL_BACKFILL_REQUIRED,
      "Older mail needs a manual fetch",
      'This mailbox was disconnected too long to restore emails automatically. Run a manual fetch to bring them in.',
      {
        sourceId: source.id,
        ...(source.channelId && { channelId: source.channelId }),
        reason: 'cursor-expired',
      },
      buildActionUrl(source.workspaceId, source.channelId),
    );
  } catch (error) {
    logger.error(`${TAG} failed to publish backfill-required notification`, {
      sourceId: source.id,
      error,
    });
  }
}

/** Undefined rather than a broken link when the source has no workspace. */
function buildActionUrl(workspaceId: string | null, channelId: string | null): string | undefined {
  if (!workspaceId) return undefined;
  return channelId ? `/${workspaceId}/support/${channelId}` : `/${workspaceId}/support`;
}
