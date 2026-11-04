import type { Prisma, PrismaClient } from '@prisma/client';
import type { ACLContext } from '../base-acl';
import { getAccessibleChannelIds, isGuestContext } from './channel-access-helper';

/** Polls whose message sits in a channel the principal can read. */
export async function pollChannelWhere(
  ctx: ACLContext,
  prisma: PrismaClient
): Promise<Prisma.PollWhereInput> {
  const channel: Prisma.ChannelWhereInput = isGuestContext(ctx)
    ? {
        workspaceId: ctx.workspaceId,
        id: { in: await getAccessibleChannelIds(prisma, ctx.userId, ctx) },
      }
    : {
        workspaceId: ctx.workspaceId,
        OR: [{ visibility: 'PUBLIC' }, { participants: { some: { userId: ctx.userId } } }],
      };
  return { message: { conversation: { channel } } };
}

export function pollResultVisibilityWhere(userId: string): Prisma.PollWhereInput {
  return {
    OR: [
      { createdBy: userId },
      { resultVisibility: 'EVERYONE' },
      { resultVisibility: 'AFTER_CLOSE', closedAt: { not: null } },
      {
        resultVisibility: 'ADMIN_ONLY',
        message: {
          conversation: {
            channel: {
              OR: [{ createdBy: userId }, { participants: { some: { userId, role: 'ADMIN' } } }],
            },
          },
        },
      },
    ],
  };
}
