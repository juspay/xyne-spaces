import type { Prisma, PrismaClient } from '@prisma/client';
import {
  SDLC_ARTIFACT_REPOSITORY_RELATION,
  SDLC_MEMBERSHIP_RELATION,
  SDLC_TRACK_MEMBERSHIP_RELATION,
} from '@xyne/shared/sdlc';


type Db = PrismaClient | Prisma.TransactionClient;

/**
 * The hub a repository belongs to, oldest membership first. Returns null when it
 * belongs to none, which is a repository registered but not yet added to a hub.
 *
 * A repository can be in several hubs. Callers that know which one they mean
 * should pass it down instead of calling this; this is the answer for background
 * work that has no such context, and it is exact whenever the repository lives in
 * a single hub.
 */
export async function resolveSdlcChannelId(db: Db, repoId: string): Promise<string | null> {
  const membership = await db.sdlcEntityLink.findFirst({
    where: {
      targetType: 'REPOSITORY',
      targetId: repoId,
      relationType: SDLC_MEMBERSHIP_RELATION,
    },
    orderBy: { createdAt: 'asc' },
    select: { channelId: true },
  });
  return membership?.channelId ?? null;
}

/** Same, but throws rather than returning null — for paths that cannot continue. */
export async function requireSdlcChannelId(db: Db, repoId: string): Promise<string> {
  const channelId = await resolveSdlcChannelId(db, repoId);
  if (!channelId) {
    throw new Error(`SDLC repository ${repoId} does not belong to a hub`);
  }
  return channelId;
}

/** Whether a repository is part of a given hub. */
export async function isRepositoryInChannel(
  db: Db,
  repoId: string,
  channelId: string
): Promise<boolean> {
  const membership = await db.sdlcEntityLink.findFirst({
    where: {
      channelId,
      targetType: 'REPOSITORY',
      targetId: repoId,
      relationType: SDLC_MEMBERSHIP_RELATION,
    },
    select: { id: true },
  });
  return Boolean(membership);
}

/**
 * The hub an actor reaches a repository through, plus their role in it.
 *
 * This is the read check for every repo-scoped SDLC surface: a repository is
 * readable when the actor participates in at least one hub it belongs to.
 * Returns null when they participate in none.
 */
export async function findSdlcMembershipForActor(
  db: Db,
  input: { workspaceId: string; repoId: string; userId: string; channelId?: string }
): Promise<{ channelId: string; role: string } | null> {
  const membership = await db.sdlcEntityLink.findFirst({
    where: {
      workspaceId: input.workspaceId,
      targetType: 'REPOSITORY',
      targetId: input.repoId,
      relationType: SDLC_MEMBERSHIP_RELATION,
      ...(input.channelId ? { channelId: input.channelId } : {}),
      channel: { participants: { some: { userId: input.userId } } },
    },
    orderBy: { createdAt: 'asc' },
    select: {
      channelId: true,
      channel: {
        select: {
          participants: { where: { userId: input.userId }, select: { role: true }, take: 1 },
        },
      },
    },
  });
  const role = membership?.channel?.participants[0]?.role;
  return membership?.channelId && role ? { channelId: membership.channelId, role } : null;
}

export async function repoIdsForChannel(db: Db, channelId: string): Promise<string[]> {
  const edges = await db.sdlcEntityLink.findMany({
    where: {
      channelId,
      sourceType: 'CHANNEL',
      targetType: 'REPOSITORY',
      relationType: SDLC_MEMBERSHIP_RELATION,
    },
    orderBy: { createdAt: 'asc' },
    select: { targetId: true },
  });
  return [...new Set(edges.map((edge) => edge.targetId))];
}

/**
 * The tracks of a hub. Tracks carry no scope column; the CHANNEL -> TRACK edge is
 * what places one, so the id list comes from the link table.
 */
export async function trackIdsForChannel(db: Db, channelId: string): Promise<string[]> {
  const edges = await db.sdlcEntityLink.findMany({
    where: {
      channelId,
      targetType: 'TRACK',
      relationType: SDLC_TRACK_MEMBERSHIP_RELATION,
    },
    select: { targetId: true },
  });
  return edges.map((edge) => edge.targetId);
}

/** Whether a track belongs to a given hub. */
export async function isTrackInChannel(
  db: Db,
  trackId: string,
  channelId: string
): Promise<boolean> {
  const edge = await db.sdlcEntityLink.findFirst({
    where: {
      channelId,
      targetType: 'TRACK',
      targetId: trackId,
      relationType: SDLC_TRACK_MEMBERSHIP_RELATION,
    },
    select: { id: true },
  });
  return Boolean(edge);
}

export async function isCanvasInChannel(
  db: Db,
  canvasId: string,
  channelId: string
): Promise<boolean> {
  const canvas = await db.canvas.findFirst({
    where: { id: canvasId, channelId },
    select: { id: true },
  });
  if (!canvas) return false;
  const artifact = await db.sdlcArtifact.findFirst({
    where: { artifactId: canvasId },
    select: { artifactId: true },
  });
  return Boolean(artifact);
}

export async function canvasIdsForRepos(
  db: Db,
  channelId: string,
  repoIds: readonly string[]
): Promise<string[]> {
  if (repoIds.length === 0) return [];
  const edges = await db.sdlcEntityLink.findMany({
    where: {
      channelId,
      sourceType: 'CANVAS',
      targetType: 'REPOSITORY',
      targetId: { in: [...repoIds] },
      relationType: SDLC_ARTIFACT_REPOSITORY_RELATION,
    },
    select: { sourceId: true },
  });
  return [...new Set(edges.map(edge => edge.sourceId))];
}
