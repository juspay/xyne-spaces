import { Prisma } from '@prisma/client';
import { bumpChannelListVersion } from '@/zero/channel-list-cache-version';

const CHANNEL_WRITES = new Set([
  'create',
  'createMany',
  'createManyAndReturn',
  'update',
  'updateMany',
  'upsert',
  'delete',
  'deleteMany',
]);

/**
 * Invalidates the userAllChannels backend cache after any Prisma write to `channels`.
 * Creates carry the workspace; other writes don't, so they invalidate every workspace
 * (channel writes are rare compared with reads, and the cache rebuilds lazily).
 */
export const channelListCacheExtension = Prisma.defineExtension(client =>
  client.$extends({
    name: 'channel-list-cache',
    query: {
      channel: {
        async $allOperations({ operation, args, query }) {
          const result = await query(args);
          if (CHANNEL_WRITES.has(operation)) {
            const data = (args as { data?: unknown } | undefined)?.data as { workspaceId?: unknown } | undefined;
            const workspaceId = operation === 'create' && typeof data?.workspaceId === 'string' ? data.workspaceId : undefined;
            bumpChannelListVersion(workspaceId);
          }
          return result;
        },
      },
    },
  }),
);
