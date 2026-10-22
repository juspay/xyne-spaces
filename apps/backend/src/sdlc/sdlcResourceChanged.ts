import { db } from '@/database/client';
import { redisService } from '@/services/redisService';
import { logger } from '@/utils/logger';

export type SdlcResourceKind = 'agents' | 'knowledge' | 'environments';

/**
 * Tells SDLC and Library views open in the workspace to refetch; anyone not on those pages fetches on arrival.
 * Through Redis, so it reaches the main backend's sockets from the SDLC lane too.
 * Never throws: a missed push only leaves a view stale until its next mount or focus.
 */
export function notifySdlcResourceChanged(
  kind: SdlcResourceKind,
  where: { channelId: string } | { workspaceId: string }
): void {
  void (async () => {
    const workspaceId =
      'workspaceId' in where
        ? where.workspaceId
        : (await db.channel.findUnique({ where: { id: where.channelId }, select: { workspaceId: true } }))
            ?.workspaceId;
    if (workspaceId) await redisService.broadcastSdlcResourceChanged({ workspaceId, kind });
  })().catch((error) => logger.warn(`[SDLC] ${kind} change push failed`, error));
}
