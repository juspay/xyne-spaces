import { db } from '@/database/client';
import { redisService } from '@/services/redisService';
import { logger } from '@/utils/logger';

export type SdlcResourceKind = 'agents' | 'knowledge' | 'environments';

/**
 * Tells open SDLC views to refetch: one hub's members, or every SDLC hub member in a workspace.
 * Through Redis user events, so it reaches the main backend's sockets from the SDLC lane too.
 * Never throws: a missed push only leaves a view stale until its next mount or focus.
 */
export function notifySdlcResourceChanged(
  kind: SdlcResourceKind,
  where: { channelId: string } | { workspaceId: string }
): void {
  void (async () => {
    const members = await db.channelParticipant.findMany({
      where:
        'channelId' in where
          ? { channelId: where.channelId }
          : { workspaceId: where.workspaceId, channel: { type: 'SDLC' } },
      select: { userId: true },
      distinct: ['userId'],
    });
    const timestamp = new Date();
    await Promise.all(
      members.map(({ userId }) =>
        redisService.broadcastUserEvent(userId, {
          type: 'sdlc_resource_changed',
          userId,
          data: { kind },
          timestamp,
        })
      )
    );
  })().catch((error) => logger.warn(`[SDLC] ${kind} change push failed`, error));
}
