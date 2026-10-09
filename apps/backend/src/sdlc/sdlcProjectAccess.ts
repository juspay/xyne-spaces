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
  return (await sdlcAccessibleProjectIds(db, actor, [projectId])).has(projectId);
}

/** The subset of `projectIds` the actor may work on, in three queries whatever the count. */
export async function sdlcAccessibleProjectIds(
  db: Db,
  actor: SdlcActor,
  projectIds: string[]
): Promise<Set<string>> {
  if (projectIds.length === 0) return new Set();
  const [user, participants, projectAdmin] = await Promise.all([
    db.user.findFirst({
      where: { id: actor.userId, workspaceId: actor.workspaceId },
      select: { role: true },
    }),
    db.channelParticipant.findMany({
      where: {
        userId: actor.userId,
        channel: { projectId: { in: projectIds }, workspaceId: actor.workspaceId },
      },
      select: { channel: { select: { projectId: true } } },
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
  if (!user || user.role === WorkspaceRole.GUEST) return new Set();
  if (projectAdmin) return new Set(projectIds);
  return new Set(participants.flatMap((p) => p.channel.projectId ?? []));
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
