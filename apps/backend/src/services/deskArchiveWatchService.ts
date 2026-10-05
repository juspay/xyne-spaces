/**
 * Desk archive ↔ Gmail watch lifecycle.
 *
 * Archived desk channels drop inbound ingestion (see ExternalSourceCore.processChannel).
 * For Gmail-backed desks we also stop the mailbox's Pub/Sub watch on archive so Gmail
 * stops pushing events we would only discard, keep the daily renewal from silently
 * re-establishing it, and re-establish it on unarchive.
 *
 * Gmail's users.stop() is per-mailbox, not per-source: if the same mailbox also backs
 * another active source (another non-archived desk, or a workspace-level DL / alias
 * source with no channel binding) we leave the watch alone.
 */

import { db } from '@/database/client';
import { ExternalSourcePlatform } from '@/integrations/core/types';
import { GoogleService } from '@/services/googleService';
import { stopGmailWatchBeforeDeactivation } from '@/services/gmailWatchStopService';
import { logger } from '@/utils/logger';

const TAG = '[DeskArchiveWatch]';

const GMAIL_WATCH_SOURCE_TYPES = [ExternalSourcePlatform.GOOGLE, 'google-channel-email'] as string[];

const watchSourceSelect = {
  id: true,
  name: true,
  sourceType: true,
  displayName: true,
  channelId: true,
  credentials: true,
} as const;

/**
 * Drop sources whose bound channel is archived. Sources without a channel binding
 * (workspace-level DL / alias mailboxes) are always kept.
 */
export async function excludeArchivedChannelSources<T extends { channelId: string | null }>(
  sources: T[],
): Promise<T[]> {
  const channelIds = [...new Set(sources.map(s => s.channelId).filter((id): id is string => !!id))];
  if (channelIds.length === 0) return sources;

  const archived = await db.channel.findMany({
    where: { id: { in: channelIds }, isArchived: true },
    select: { id: true },
  });
  if (archived.length === 0) return sources;

  const archivedIds = new Set(archived.map(c => c.id));
  return sources.filter(s => !s.channelId || !archivedIds.has(s.channelId));
}

async function findChannelGmailSources(channelId: string) {
  return db.externalSource.findMany({
    // Channel-bound Gmail desks are 'google' sources; alias/DL mailboxes are workspace-level.
    where: { channelId, isActive: true, sourceType: ExternalSourcePlatform.GOOGLE },
    select: watchSourceSelect,
  });
}

/** True when another active, non-archived source still needs this mailbox's watch. */
async function isMailboxSharedWithLiveSource(source: { id: string; displayName: string }): Promise<boolean> {
  const others = await db.externalSource.findMany({
    where: {
      id: { not: source.id },
      isActive: true,
      sourceType: { in: GMAIL_WATCH_SOURCE_TYPES },
      displayName: { equals: source.displayName, mode: 'insensitive' },
    },
    select: { id: true, channelId: true },
  });
  if (others.length === 0) return false;
  return (await excludeArchivedChannelSources(others)).length > 0;
}

export async function stopGmailWatchesForArchivedDesk(channelId: string): Promise<void> {
  const sources = await findChannelGmailSources(channelId);
  for (const source of sources) {
    if (await isMailboxSharedWithLiveSource(source)) {
      logger.info(`${TAG} Mailbox shared with another live source; keeping Gmail watch`, {
        channelId,
        sourceId: source.id,
      });
      continue;
    }
    await stopGmailWatchBeforeDeactivation(source, TAG);
    logger.info(`${TAG} Stopped Gmail watch for archived desk`, { channelId, sourceId: source.id });
  }
}

export async function resumeGmailWatchesForUnarchivedDesk(channelId: string): Promise<void> {
  const sources = await findChannelGmailSources(channelId);
  for (const source of sources) {
    if (typeof source.credentials !== 'string' || !source.credentials) continue;
    try {
      const svc = GoogleService.fromEncryptedCredentials(source.credentials, source.id);
      const { historyId } = await svc.setupGmailWatch();
      // Mail that arrived while the desk was archived is intentionally not
      // back-filled: move the cursor to "now" so the next push starts fresh.
      await db.externalSource.update({ where: { id: source.id }, data: { lastSyncCursor: historyId } });
      logger.info(`${TAG} Resumed Gmail watch for unarchived desk`, { channelId, sourceId: source.id, historyId });
    } catch (err) {
      // Daily renewal will retry; it no longer skips this source once unarchived.
      logger.warn(`${TAG} Failed to resume Gmail watch for unarchived desk`, {
        channelId,
        sourceId: source.id,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
}
