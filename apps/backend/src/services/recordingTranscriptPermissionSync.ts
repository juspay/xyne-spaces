import { CallType, EntityUserAccess, ShareableEntityType } from '@xyne/shared';
import { db } from '@/database/client';
import { withWorkspaceScope } from '@/database/tenant/context';
import { queueTranscriptFieldsUpdate, type TranscriptDocField } from '@/services/callVespaQueue';
import { logger } from '@/utils/logger';
import { mapWithConcurrency } from '@/utils/concurrency';

/**
 * A recording's ACL is denormalized into its Vespa transcript doc: `permissions` holds
 * everyone its live shares reach (see `computeRecordingPermissions`) and `isPrivate`
 * follows its link visibility. A share command refreshes its one recording
 * (callVespaQueue.queueRecordingTranscriptRefresh); this fans the same refresh out to every
 * recording shared to a group or channel when that group's or channel's membership changes.
 */

// Same bound as canvasPermissionSync: a channel can be shared many recordings.
const ENQUEUE_CONCURRENCY = 25;
const RECORDING_ACL_FIELDS: TranscriptDocField[] = ['permissions', 'isPrivate'];

async function refreshForShares(
  where: { channelId: string } | { userGroupId: string },
  label: string,
): Promise<void> {
  // Runs after the membership row is gone, so it must not be scoped to the actor.
  const recordings = await withWorkspaceScope(async () => {
    const shares = await db.entityAccess.findMany({
      where: {
        ...where,
        shareableEntityType: ShareableEntityType.NOTE_TAKER,
        entityUserAccess: { not: EntityUserAccess.REVOKED },
      },
      select: { entityId: true },
    });
    const callIds = Array.from(new Set(shares.map(s => s.entityId)));
    if (callIds.length === 0) return [];
    return db.call.findMany({
      where: { id: { in: callIds }, callType: CallType.HEADLESS },
      select: { id: true, workspaceId: true, callType: true },
    });
  });
  if (recordings.length === 0) return;

  logger.info(`[recordingTranscriptPermissionSync] refreshing ${recordings.length} recording ACL(s) for ${label}`);
  // queueTranscriptFieldsUpdate logs its own failures and never throws.
  await mapWithConcurrency(recordings, ENQUEUE_CONCURRENCY, call =>
    queueTranscriptFieldsUpdate(call, RECORDING_ACL_FIELDS),
  );
}

/** Refresh every recording shared to a channel, after a member joins or leaves it. */
export function refreshRecordingTranscriptPermissionsForChannel(channelId: string): Promise<void> {
  return refreshForShares({ channelId }, `channel ${channelId}`);
}

/** Refresh every recording shared to a user group, after a member joins or leaves it. */
export function refreshRecordingTranscriptPermissionsForGroup(userGroupId: string): Promise<void> {
  return refreshForShares({ userGroupId }, `group ${userGroupId}`);
}
