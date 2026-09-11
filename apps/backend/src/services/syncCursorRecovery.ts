import { logger } from '@/utils/logger';
import { NotificationType } from '@xyne/shared';
import { notificationService } from '@/notification-service';
import { ExternalSourceRepository } from '@/database/repositories/externalSourceRepository';

const TAG = '[SyncCursorRecovery]';
const externalSourceRepo = new ExternalSourceRepository();

/** Move the cursor forward after a range has been fully accounted for. */
export async function advanceSyncCursor(sourceId: string, historyId: string): Promise<void> {
  try {
    const source = await externalSourceRepo.findById(sourceId);
    if (!source) return;
    if (source.lastSyncCursor && BigInt(historyId) <= BigInt(source.lastSyncCursor)) return;

    await externalSourceRepo.update(sourceId, { lastSyncCursor: historyId });
    logger.info(`${TAG} [CURSOR_ADVANCED]`, {
      sourceId,
      sourceName: source.name,
      from: source.lastSyncCursor,
      to: historyId,
    });
  } catch (error) {
    logger.warn(`${TAG} failed to advance sync cursor`, { sourceId, error });
  }
}

export interface SeedSyncCursorParams {
  source: { id: string; name: string; channelId: string | null; workspaceId: string | null };
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

  if (!requesterUserId) {
    logger.error(`${TAG} [CURSOR_SEEDED] cursor expired unattended — gap needs a dated fetch`, {
      ...details,
      channelId: source.channelId,
    });
    return;
  }

  logger.warn(`${TAG} [CURSOR_SEEDED] cursor skipped a gap beyond Gmail's history window`, details);

  try {
    await notificationService.sendNotification(
      requesterUserId,
      NotificationType.EMAIL_BACKFILL_REQUIRED,
      "Older mail needs a manual fetch",
      'This mailbox was disconnected too long to restore emails automatically. Run a manual fetch to bring them in.',
      { sourceId: source.id, ...(source.channelId && { channelId: source.channelId }), reason },
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
