import { Prisma, type PrismaClient } from '@prisma/client';
import type { EntityLinkOwner } from '@xyne/shared';
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

export async function validateOwnerInChannel(
  db: Db,
  owner: EntityLinkOwner,
  channelId: string
): Promise<boolean> {
  return owner.sourceType === 'TRACK'
    ? isTrackInChannel(db, owner.sourceId, channelId)
    : isCanvasInChannel(db, owner.sourceId, channelId);
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
  return link && (link.sourceType === 'CANVAS' || link.sourceType === 'TRACK')
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
          relationType: 'TRACK_ITEM',
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
      await ensureLink(
        db,
        {
          channelId,
          sourceType: 'TRACK',
          sourceId: owner.sourceId,
          targetType: 'TICKET',
          targetId: ticketId,
          relationType: 'TRACK_ITEM',
        },
        actor
      );
    }
  }
}
