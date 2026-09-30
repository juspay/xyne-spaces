import { Prisma, type PrismaClient } from '@prisma/client';
import {
  SDLC_FOLDER_FLAT_RELATION,
  SDLC_TRACK_FLAT_RELATION,
  planSdlcFolderEdges,
  type EntityLinkOwner,
} from '@xyne/shared';
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

/**
 * Brings an item's folder edges, and those of everything under it, in line with where
 * it is now filed: the Prisma side of the Zero mutators' refileSdlcFolderEdges, for
 * the writers that file items outside Zero. Call it after writing or removing the
 * item's containment edge, in the same transaction.
 */
export async function refileFolderEdges(
  db: Db,
  input: {
    channelId: string;
    item: { type: string; id: string };
    /** Where it sits now; null once it no longer sits anywhere. */
    parent: { type: 'TRACK' | 'FOLDER'; id: string } | null;
  },
  actor: EntityLinkActor
): Promise<void> {
  const { channelId, item, parent } = input;
  const folderEdges = { channelId, relationType: SDLC_FOLDER_FLAT_RELATION };
  const ancestors =
    parent?.type === 'FOLDER'
      ? [
          parent.id,
          ...(
            await db.sdlcEntityLink.findMany({
              where: { ...folderEdges, targetType: 'FOLDER', targetId: parent.id },
              select: { sourceId: true },
            })
          ).map(edge => edge.sourceId),
        ]
      : [];
  const descendants =
    item.type === 'FOLDER'
      ? (
          await db.sdlcEntityLink.findMany({
            where: { ...folderEdges, sourceType: 'FOLDER', sourceId: item.id },
            select: { targetType: true, targetId: true },
          })
        ).map(edge => ({ type: edge.targetType, id: edge.targetId }))
      : [];
  const existing = await db.sdlcEntityLink.findMany({
    where: {
      ...folderEdges,
      targetId: { in: [item.id, ...descendants.map(descendant => descendant.id)] },
    },
    select: { id: true, sourceId: true, targetType: true, targetId: true },
  });
  const plan = planSdlcFolderEdges({ item, ancestors, descendants, existing });
  if (plan.remove.length > 0) {
    await db.sdlcEntityLink.deleteMany({ where: { id: { in: plan.remove } } });
  }
  if (plan.add.length > 0) {
    await db.sdlcEntityLink.createMany({
      data: plan.add.map(edge => ({
        workspaceId: actor.workspaceId,
        channelId,
        sourceType: 'FOLDER',
        ...edge,
        relationType: SDLC_FOLDER_FLAT_RELATION,
        createdBy: actor.userId,
      })),
      skipDuplicates: true,
    });
  }
}

/**
 * The track an item belongs to, read off the flat edge every track item carries.
 * One lookup whatever the item is and however deep it is filed, because the flat
 * edge does not move when containment does.
 */
export async function resolveItemTrackId(
  db: Db,
  targetType: string,
  targetId: string
): Promise<string | null> {
  const edge = await db.sdlcEntityLink.findFirst({
    where: {
      sourceType: 'TRACK',
      targetType,
      targetId,
      relationType: SDLC_TRACK_FLAT_RELATION,
    },
    select: { sourceId: true },
  });
  return edge?.sourceId ?? null;
}

export const resolveFolderTrackId = (db: Db, folderId: string): Promise<string | null> =>
  resolveItemTrackId(db, 'FOLDER', folderId);

export async function validateOwnerInChannel(
  db: Db,
  owner: EntityLinkOwner,
  channelId: string
): Promise<boolean> {
  if (owner.sourceType === 'TRACK') {
    return isTrackInChannel(db, owner.sourceId, channelId);
  }
  if (
    owner.sourceType === 'FOLDER' ||
    owner.sourceType === 'ATTACHMENT' ||
    owner.sourceType === 'LINK'
  ) {
    const trackId = await resolveItemTrackId(db, owner.sourceType, owner.sourceId);
    return trackId ? isTrackInChannel(db, trackId, channelId) : false;
  }
  return isCanvasInChannel(db, owner.sourceId, channelId);
}

export async function resolveInheritedOwner(
  db: Db,
  conversationId: string,
  channelId?: string
): Promise<EntityLinkOwner | null> {
  const link = await db.sdlcEntityLink.findFirst({
    where: {
      ...(channelId ? { channelId } : {}),
      targetType: 'CONVERSATION',
      targetId: conversationId,
      relationType: 'DISCUSSION',
    },
    // A thread filed on more than one item inherits the one it was filed on first,
    // the same one every time.
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    select: { sourceType: true, sourceId: true },
  });
  return link &&
    (link.sourceType === 'CANVAS' ||
      link.sourceType === 'TRACK' ||
      link.sourceType === 'FOLDER' ||
      link.sourceType === 'ATTACHMENT' ||
      link.sourceType === 'LINK')
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
      // A folder, a file or a link owns the ticket it spawned, the same way an
      // artifact does; only a track has no edge of its own to add.
      if (owner.sourceType !== 'TRACK') {
        await ensureLink(
          db,
          {
            channelId,
            sourceType: owner.sourceType,
            sourceId: owner.sourceId,
            targetType: 'TICKET',
            targetId: ticketId,
            relationType: 'TICKET',
          },
          actor
        );
      }
      const trackId =
        owner.sourceType === 'TRACK'
          ? owner.sourceId
          : await resolveItemTrackId(db, owner.sourceType, owner.sourceId);
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
