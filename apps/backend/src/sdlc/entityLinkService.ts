import { Prisma, type PrismaClient } from '@prisma/client';
import { SDLC_TRACK_FLAT_RELATION, type EntityLinkOwner } from '@xyne/shared';
import { logger } from '@/utils/logger';
import { isCanvasInChannel, isTrackInChannel } from './sdlcChannelMembership';

type Db = PrismaClient | Prisma.TransactionClient;

export type EntityLinkActor = { workspaceId: string; userId: string };

export type EnsureLinkInput = {
  channelId: string;
  sourceType: string;
  sourceId: string;
  targetType: string;
  targetId: string;
  relationType: string;
};

export async function ensureLink(
  db: Db,
  link: EnsureLinkInput,
  actor: EntityLinkActor
): Promise<{ created: boolean }> {
  if (!link.channelId) {
    throw new Error('Entity links require a channelId');
  }
  const result = await db.sdlcEntityLink.createMany({
    data: [{ ...link, workspaceId: actor.workspaceId, createdBy: actor.userId }],
    skipDuplicates: true,
  });
  return { created: result.count > 0 };
}

export async function resolveFolderTrackId(
  db: Db,
  folderId: string
): Promise<string | null> {
  const edge = await db.sdlcEntityLink.findFirst({
    where: {
      sourceType: 'TRACK',
      targetType: 'FOLDER',
      targetId: folderId,
      relationType: SDLC_TRACK_FLAT_RELATION,
    },
    select: { sourceId: true },
  });
  return edge?.sourceId ?? null;
}

export async function validateOwnerInChannel(
  db: Db,
  owner: EntityLinkOwner,
  channelId: string
): Promise<boolean> {
  if (owner.sourceType === 'TRACK') {
    return isTrackInChannel(db, owner.sourceId, channelId);
  }
  if (owner.sourceType === 'FOLDER') {
    const trackId = await resolveFolderTrackId(db, owner.sourceId);
    return trackId ? isTrackInChannel(db, trackId, channelId) : false;
  }
  return isCanvasInChannel(db, owner.sourceId, channelId);
}

export async function resolveInheritedOwner(
  db: Db,
  conversationId: string
): Promise<EntityLinkOwner | null> {
  const link = await db.sdlcEntityLink.findFirst({
    where: {
      targetType: 'CONVERSATION',
      targetId: conversationId,
      relationType: 'DISCUSSION',
    },
    select: { sourceType: true, sourceId: true },
  });
  return link &&
    (link.sourceType === 'CANVAS' ||
      link.sourceType === 'TRACK' ||
      link.sourceType === 'FOLDER')
    ? { sourceType: link.sourceType, sourceId: link.sourceId }
    : null;
}

export async function linkCreatedEntities(
  db: Db,
  input: {
    owner: EntityLinkOwner;
    channelId: string;
    conversationId?: string;
    ticketId?: string;
  },
  actor: EntityLinkActor
): Promise<void> {
  const { owner, channelId, conversationId, ticketId } = input;

  if (!(await validateOwnerInChannel(db, owner, channelId))) {
    logger.warn('[entityLinkService] owner not in channel; skipping links', {
      channelId,
      sourceType: owner.sourceType,
      sourceId: owner.sourceId,
      conversationId,
      ticketId,
    });
    return;
  }

  if (conversationId) {
    const existingDiscussion = await db.sdlcEntityLink.findFirst({
      where: {
        targetType: 'CONVERSATION',
        targetId: conversationId,
        relationType: 'DISCUSSION',
      },
      select: { id: true },
    });
    if (!existingDiscussion) {
      await ensureLink(
        db,
        {
          channelId,
          sourceType: owner.sourceType,
          sourceId: owner.sourceId,
          targetType: 'CONVERSATION',
          targetId: conversationId,
          relationType: 'DISCUSSION',
        },
        actor
      );
    }
  }

  if (ticketId) {
    if (owner.sourceType === 'CANVAS') {
      await ensureLink(
        db,
        {
          channelId,
          sourceType: 'CANVAS',
          sourceId: owner.sourceId,
          targetType: 'TICKET',
          targetId: ticketId,
          relationType: 'TICKET',
        },
        actor
      );
      const trackEdge = await db.sdlcEntityLink.findFirst({
        where: {
          channelId,
          sourceType: 'TRACK',
          targetType: 'CANVAS',
          targetId: owner.sourceId,
          relationType: SDLC_TRACK_FLAT_RELATION,
        },
        select: { sourceId: true },
      });
      if (trackEdge) {
        await ensureLink(
          db,
          {
            channelId,
            sourceType: 'TRACK',
            sourceId: trackEdge.sourceId,
            targetType: 'TICKET',
            targetId: ticketId,
            relationType: 'TRACK_ITEM',
          },
          actor
        );
      }
    } else {
      if (owner.sourceType === 'FOLDER') {
        await ensureLink(
          db,
          {
            channelId,
            sourceType: 'FOLDER',
            sourceId: owner.sourceId,
            targetType: 'TICKET',
            targetId: ticketId,
            relationType: 'TICKET',
          },
          actor
        );
      }
      const trackId =
        owner.sourceType === 'FOLDER'
          ? await resolveFolderTrackId(db, owner.sourceId)
          : owner.sourceId;
      if (trackId) {
        await ensureLink(
          db,
          {
            channelId,
            sourceType: 'TRACK',
            sourceId: trackId,
            targetType: 'TICKET',
            targetId: ticketId,
            relationType: 'TRACK_ITEM',
          },
          actor
        );
      }
    }
  }
}
