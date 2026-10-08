import { GuestEntity, WorkspaceRole } from '@xyne/shared';
import { DatabaseClient } from '@/database/client';
import { asSystem } from './base';

export interface GuestSearchScope {
  /** Every active GUEST in the workspace. */
  guestUserIds: string[];
  /** Guests the searcher shares no channel or canvas with — left out of people-search. */
  hiddenGuestUserIds: string[];
}

/**
 * Which guests a (non-guest) searcher may find in search. A guest is visible only to people
 * who share a channel or canvas with them. Runs as system: the guest's own participant and
 * guest_access rows must be read regardless of what the searcher's scope would expose, and only
 * the resulting user ids — never the rows — leave this function.
 */
export function getGuestSearchScope(
  workspaceId: string,
  searcherId: string,
): Promise<GuestSearchScope> {
  return asSystem(
    ['User', 'ChannelParticipant', 'GuestAccess', 'Canvas', 'CanvasParticipant'],
    'search guest scoping: intersect the guests\' channels/canvases with the searcher\'s to decide which guests the searcher may find',
    async () => {
      const db = DatabaseClient.getInstance();
      const guests = await db.user.findMany({
        where: { workspaceId, role: WorkspaceRole.GUEST, leftAt: null },
        select: { id: true },
      });
      const guestUserIds = guests.map(g => g.id);
      if (guestUserIds.length === 0) return { guestUserIds, hiddenGuestUserIds: [] };

      const [guestChannelRows, guestAccessRows, guestCanvasRows] = await Promise.all([
        db.channelParticipant.findMany({
          where: { userId: { in: guestUserIds } },
          select: { userId: true, channelId: true },
        }),
        db.guestAccess.findMany({
          where: { workspaceId, userId: { in: guestUserIds } },
          select: { userId: true, accessibleEntityId: true, accessibleEntityType: true },
        }),
        db.canvasParticipant.findMany({
          where: { userId: { in: guestUserIds } },
          select: { userId: true, canvasId: true },
        }),
      ]);

      // surface id → guests on it
      const guestsByChannel = new Map<string, Set<string>>();
      const guestsByCanvas = new Map<string, Set<string>>();
      const add = (map: Map<string, Set<string>>, key: string, userId: string): void => {
        const set = map.get(key) ?? new Set<string>();
        set.add(userId);
        map.set(key, set);
      };
      guestChannelRows.forEach(r => add(guestsByChannel, r.channelId, r.userId));
      guestCanvasRows.forEach(r => r.userId && add(guestsByCanvas, r.canvasId, r.userId));
      guestAccessRows.forEach(r => {
        if (r.accessibleEntityType === GuestEntity.CHANNEL) add(guestsByChannel, r.accessibleEntityId, r.userId);
        if (r.accessibleEntityType === GuestEntity.CANVAS) add(guestsByCanvas, r.accessibleEntityId, r.userId);
      });

      const guestChannelIds = [...guestsByChannel.keys()];
      const guestCanvasIds = [...guestsByCanvas.keys()];

      const [searcherChannels, searcherCanvasShares, searcherOwnedCanvases] = await Promise.all([
        guestChannelIds.length
          ? db.channelParticipant.findMany({
              where: { userId: searcherId, channelId: { in: guestChannelIds } },
              select: { channelId: true },
            })
          : [],
        guestCanvasIds.length
          ? db.canvasParticipant.findMany({
              where: { userId: searcherId, canvasId: { in: guestCanvasIds } },
              select: { canvasId: true },
            })
          : [],
        guestCanvasIds.length
          ? db.canvas.findMany({
              where: { id: { in: guestCanvasIds }, createdBy: searcherId },
              select: { id: true },
            })
          : [],
      ]);

      const visible = new Set<string>();
      searcherChannels.forEach(r => guestsByChannel.get(r.channelId)?.forEach(id => visible.add(id)));
      searcherCanvasShares.forEach(r => guestsByCanvas.get(r.canvasId)?.forEach(id => visible.add(id)));
      searcherOwnedCanvases.forEach(r => guestsByCanvas.get(r.id)?.forEach(id => visible.add(id)));

      return {
        guestUserIds,
        hiddenGuestUserIds: guestUserIds.filter(id => !visible.has(id)),
      };
    },
  );
}
