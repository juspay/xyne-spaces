import { db } from '@/database/client';
import { asService } from './base';

/**
 * Desk ids of `type` in the workspace (optionally limited to `ids`), whether or not the calling user
 * can see them. Call routing belongs to the workspace: moving old routing onto desks, or deciding a
 * desk was deleted, must not skip the private desks an admin or desk owner isn't a member of.
 */
export function findWorkspaceDeskIds(
  workspaceId: string,
  filter: { type?: string; ids?: string[] },
): Promise<string[]> {
  return asService(
    ['Channel'],
    'call routing: workspace-wide desk lookup, independent of which desks the caller can see',
    'call-connection-service',
    workspaceId,
    async () => {
      const channels = await db.channel.findMany({
        where: {
          workspaceId,
          ...(filter.type ? { type: filter.type } : {}),
          ...(filter.ids ? { id: { in: filter.ids } } : {}),
        },
        select: { id: true },
      });
      return channels.map(channel => channel.id);
    },
  );
}
