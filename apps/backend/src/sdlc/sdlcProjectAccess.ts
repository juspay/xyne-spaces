import type { Prisma, PrismaClient } from '@prisma/client';
import { AccessType, WorkspaceRole } from '@xyne/shared';
import { AppError } from '@/middleware/errorHandler';
import type { SdlcActor } from './types';

type Db = PrismaClient | Prisma.TransactionClient;

/**
 * Whether an actor may work on a project's SDLC repositories.
 *
 * Project access, not hub membership: a repository belongs to its project from the
 * moment it is registered. Anything that writes into a hub is gated by membership.
 */
export async function hasSdlcProjectAccess(
  db: Db,
  actor: SdlcActor,
  projectId: string
): Promise<boolean> {
  const [user, participant, projectAdmin] = await Promise.all([
    db.user.findFirst({
      where: { id: actor.userId, workspaceId: actor.workspaceId },
      select: { role: true },
    }),
    db.channelParticipant.findFirst({
      where: {
        userId: actor.userId,
        channel: { projectId, workspaceId: actor.workspaceId },
      },
      select: { id: true },
    }),
    db.resourceAccess.findFirst({
      where: {
        workspaceId: actor.workspaceId,
        accessType: AccessType.ADMIN,
        resource: { name: 'LISTPROJECTS' },
        OR: [
          { userId: actor.userId },
          {
            userGroup: {
              workspaceId: actor.workspaceId,
              userGroupMappings: { some: { userId: actor.userId } },
            },
          },
        ],
      },
      select: { id: true },
    }),
  ]);
  if (!user || user.role === WorkspaceRole.GUEST) return false;
  return Boolean(participant || projectAdmin);
}

export async function requireSdlcProjectAccess(
  db: Db,
  actor: SdlcActor,
  projectId: string,
  message = 'You must be a project participant to do this'
): Promise<void> {
  if (!(await hasSdlcProjectAccess(db, actor, projectId))) {
    throw new AppError(message, 403);
  }
}
