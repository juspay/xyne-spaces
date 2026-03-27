import { db } from '@/database/client';
import { logger } from '@/utils/logger';
import {
  buildSurfaceNudgeCountRowId,
  getSurfaceAreaIdField,
  type SurfaceAreaIdField,
} from '@xyne/shared';
import type { Prisma, PrismaClient } from '@prisma/client';

type PrismaTransaction = Prisma.TransactionClient;
type DatabaseLike = PrismaClient | PrismaTransaction;

function getSurfaceFilter(
  surfaceAreaField: SurfaceAreaIdField,
  surfaceAreaId: string,
): {
  messageId?: string;
  ticketId?: string;
  canvasId?: string;
  callId?: string;
  conversationId?: string;
} {
  return { [surfaceAreaField]: surfaceAreaId };
}

async function resolveChannelIdForSurface(
  tx: DatabaseLike,
  sourceType: string,
  sourceId: string,
): Promise<string | null> {
  switch (sourceType) {
    case 'MESSAGE': {
      const message = await tx.message.findUnique({
        where: { messageId: sourceId },
        select: {
          conversation: {
            select: {
              channelId: true,
            },
          },
        },
      });
      return message?.conversation?.channelId ?? null;
    }
    case 'TICKET': {
      const ticket = await tx.ticket.findUnique({
        where: { id: sourceId },
        select: { channelId: true },
      });
      return ticket?.channelId ?? null;
    }
    case 'CANVAS': {
      const canvas = await tx.canvas.findUnique({
        where: { id: sourceId },
        select: { channelId: true },
      });
      return canvas?.channelId ?? null;
    }
    case 'CALL': {
      const call = await tx.call.findUnique({
        where: { id: sourceId },
        select: { channelId: true },
      });
      return call?.channelId ?? null;
    }
    case 'CONVERSATION': {
      const conversation = await tx.conversation.findUnique({
        where: { conversationId: sourceId },
        select: { channelId: true },
      });
      return conversation?.channelId ?? null;
    }
    default:
      return null;
  }
}

export async function rebuildSurfaceNudgeAudienceCounts(params: {
  tx: DatabaseLike;
  sourceId: string;
  sourceType: string;
}): Promise<void> {
  const { tx, sourceId, sourceType } = params;
  const surfaceAreaField = getSurfaceAreaIdField(sourceType);
  if (!surfaceAreaField) {
    logger.warn('[SurfaceNudgeAudienceCount] Unsupported source type', {
      sourceId,
      sourceType,
    });
    return;
  }

  const surfaceFilter = getSurfaceFilter(surfaceAreaField, sourceId);

  await tx.surfaceNudgeCount.deleteMany({
    where: surfaceFilter,
  });
  await tx.surfaceNudge.updateMany({
    where: { sourceId },
    data: { surfaceNudgeCountId: null },
  });

  const renderableNudges = await tx.surfaceNudge.findMany({
    where: {
      sourceId,
      state: 'ACTIVE',
    },
    select: {
      id: true,
      visibleTo: true,
    },
  });

  if (renderableNudges.length === 0) {
    return;
  }

  const publicChannelId = await resolveChannelIdForSurface(tx, sourceType, sourceId);
  const now = new Date();
  const audienceBuckets = new Map<
    string,
    Prisma.SurfaceNudgeCountCreateManyInput & { nudgeIds: string[] }
  >();

  for (const nudge of renderableNudges) {
    if (nudge.visibleTo) {
      const rowId = buildSurfaceNudgeCountRowId({
        sourceType,
        sourceId,
        scope: 'user',
        audienceId: nudge.visibleTo,
      });
      const existing = audienceBuckets.get(rowId);
      if (existing) {
        existing.nudgeIds.push(nudge.id);
      } else {
        audienceBuckets.set(rowId, {
          id: rowId,
          nudgeCount: 1,
          userId: nudge.visibleTo,
          channelId: null,
          gid: null,
          gidType: null,
          ...surfaceFilter,
          createdAt: now,
          updatedAt: now,
          nudgeIds: [nudge.id],
        });
      }
      continue;
    }

    if (!publicChannelId) {
      continue;
    }

    const rowId = buildSurfaceNudgeCountRowId({
      sourceType,
      sourceId,
      scope: 'channel',
      audienceId: publicChannelId,
    });
    const existing = audienceBuckets.get(rowId);
    if (existing) {
      existing.nudgeIds.push(nudge.id);
    } else {
      audienceBuckets.set(rowId, {
        id: rowId,
        nudgeCount: 1,
        userId: null,
        channelId: publicChannelId,
        gid: null,
        gidType: null,
        ...surfaceFilter,
        createdAt: now,
        updatedAt: now,
        nudgeIds: [nudge.id],
      });
    }
  }

  const countRows = Array.from(audienceBuckets.values()).map(({ nudgeIds, ...row }) => row);
  if (countRows.length === 0) {
    return;
  }

  await tx.surfaceNudgeCount.createMany({
    data: countRows,
  });

  for (const bucket of audienceBuckets.values()) {
    await tx.surfaceNudge.updateMany({
      where: {
        id: { in: bucket.nudgeIds },
      },
      data: {
        surfaceNudgeCountId: bucket.id,
      },
    });
  }
}

export async function rebuildSurfaceNudgeAudienceCountsWithDb(params: {
  sourceId: string;
  sourceType: string;
}): Promise<void> {
  const { sourceId, sourceType } = params;
  await db.$transaction(async tx => {
    await rebuildSurfaceNudgeAudienceCounts({
      tx,
      sourceId,
      sourceType,
    });
  });
}
