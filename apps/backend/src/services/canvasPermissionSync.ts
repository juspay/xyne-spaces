import { db } from '@/database/client';
import { vespaQueue } from '@/queues/vespaQueue';
import { fileSchema, SubApp } from '@/vespa/src/types';
import { logger } from '@/utils/logger';

/**
 * Canvas ACL is denormalized into the Vespa file doc's `permissions` array (direct
 * users + expanded channel/group members — see `computeCanvasPermissions`). These
 * helpers keep that array fresh by enqueuing a **field-scoped** `permissions` update
 * (no content re-embed) whenever the underlying membership/shares change.
 */

// Cap on how many refresh jobs we enqueue concurrently. A single channel/group can
// have thousands of shared canvases; enqueuing them all at once (Promise.all over the
// whole set) would flood Redis/the queue in one burst. We enqueue in bounded chunks.
const ENQUEUE_CONCURRENCY = 25;

/** Enqueue a permissions-only refresh for a single canvas. */
export async function enqueueCanvasPermissionRefresh(canvasId: string): Promise<void> {
  await vespaQueue.addJob({
    schema: fileSchema,
    jobType: 'update',
    docId: canvasId,
    app: SubApp.CANVAS,
    fields: ['permissions'],
  });
}

async function refreshForShares(
  where: { channelId: string } | { userGroupId: string },
  label: string,
): Promise<void> {
  const shares = await db.canvasParticipant.findMany({ where, select: { canvasId: true } });
  const canvasIds = Array.from(new Set(shares.map(s => s.canvasId)));
  if (canvasIds.length === 0) return;

  logger.info(`[canvasPermissionSync] refreshing ${canvasIds.length} canvas ACL(s) for ${label}`);
  // Bounded-concurrency fan-out: process the canvasIds in fixed-size chunks so a large
  // membership change doesn't spike the queue with a flood of simultaneous enqueues.
  for (let i = 0; i < canvasIds.length; i += ENQUEUE_CONCURRENCY) {
    const chunk = canvasIds.slice(i, i + ENQUEUE_CONCURRENCY);
    await Promise.all(
      chunk.map(id =>
        enqueueCanvasPermissionRefresh(id).catch(err =>
          logger.warn(`[canvasPermissionSync] failed to enqueue refresh for canvas ${id}: ${err}`),
        ),
      ),
    );
  }
}

/**
 * Refresh the ACL of every canvas shared to a channel. Triggered from the
 * channel_participants side-effect (join/leave) — the precise membership signal, so
 * canvases are not recomputed on ordinary message activity.
 */
export function refreshCanvasPermissionsForChannel(channelId: string): Promise<void> {
  return refreshForShares({ channelId }, `channel ${channelId}`);
}

/**
 * Refresh the ACL of every canvas shared to a user-group. Triggered directly from the
 * user_group_mappings side-effect (group membership is Zero-managed), so a member
 * joining/leaving a group updates the canvases shared to it.
 */
export function refreshCanvasPermissionsForGroup(userGroupId: string): Promise<void> {
  return refreshForShares({ userGroupId }, `group ${userGroupId}`);
}
