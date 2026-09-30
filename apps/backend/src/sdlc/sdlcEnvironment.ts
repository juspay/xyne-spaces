import type { PrismaClient } from '@prisma/client';
import type { SdlcEnvironmentRow } from '@xyne/shared';
import { SDLC_MEMBERSHIP_RELATION } from '@xyne/shared/sdlc';
import { hasSdlcProjectAccess } from './sdlcProjectAccess';
import type { SdlcActor } from './types';

/** repoId → ids of the hubs it belongs to that the actor may see (public, or a participant). */
async function repoHubs(db: PrismaClient, actor: SdlcActor): Promise<Map<string, string[]>> {
  const links = await db.sdlcEntityLink.findMany({
    where: {
      workspaceId: actor.workspaceId,
      relationType: SDLC_MEMBERSHIP_RELATION,
      targetType: 'REPOSITORY',
      channel: {
        OR: [{ visibility: 'PUBLIC' }, { participants: { some: { userId: actor.userId } } }],
      },
    },
    select: { targetId: true, channelId: true },
  });
  const byRepo = new Map<string, string[]>();
  for (const link of links) {
    byRepo.set(link.targetId, [...(byRepo.get(link.targetId) ?? []), link.channelId]);
  }
  return byRepo;
}

// Sandbox Profiles are not stored here; the dashboard links them by matching each profile's repoUrl.
export async function listEnvironments(
  db: PrismaClient,
  actor: SdlcActor
): Promise<SdlcEnvironmentRow[]> {
  const repos = await db.repo.findMany({
    where: { workspaceId: actor.workspaceId, projectId: { not: null } },
    orderBy: { name: 'asc' },
    select: {
      id: true,
      name: true,
      url: true,
      canonicalUrl: true,
      projectId: true,
    },
  });
  // Same gate as the project repository listing: project access, not hub membership.
  const projectIds = [
    ...new Set(repos.flatMap((repo) => (repo.projectId ? [repo.projectId] : []))),
  ];
  const allowed = new Set(
    (
      await Promise.all(
        projectIds.map(async (id) => ((await hasSdlcProjectAccess(db, actor, id)) ? id : null))
      )
    ).filter(Boolean)
  );
  const hubsByRepo = await repoHubs(db, actor);
  return repos
    .filter((repo) => repo.projectId && allowed.has(repo.projectId))
    .map((repo) => ({
      repoId: repo.id,
      name: repo.name,
      url: repo.canonicalUrl || repo.url,
      hubChannelIds: hubsByRepo.get(repo.id) ?? [],
    }));
}
