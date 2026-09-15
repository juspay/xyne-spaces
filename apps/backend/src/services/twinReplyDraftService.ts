import { DatabaseClient } from '@/database/client';
import { logger } from '@/utils/logger';
import type { TwinReplyDraft } from './twinReplyDraft';

export * from './twinReplyDraft';

const db = (): ReturnType<typeof DatabaseClient.getInstance> => DatabaseClient.getInstance();

function parseTwinMetadata(metadata: string | null | undefined): TwinReplyDraft | null {
  if (!metadata) return null;
  try {
    return JSON.parse(metadata) as TwinReplyDraft;
  } catch (error) {
    logger.warn('[TwinReplyDraft] metadata parse failed, ignoring row', { error });
    return null;
  }
}

export async function createTwinReplyDraft(draft: TwinReplyDraft): Promise<void> {
  const prisma = db();
  if (draft.sourceMessageId) {
    try {
      const existing = await prisma.draftMessage.findMany({
        where: {
          userId: draft.ownerUserId,
          conversationId: draft.conversationId,
          origin: 'twin',
        },
        select: { id: true, metadata: true },
      });
      const staleIds = existing
        .filter(row => parseTwinMetadata(row.metadata)?.sourceMessageId === draft.sourceMessageId)
        .map(row => row.id);
      if (staleIds.length > 0) {
        await prisma.draftMessage.deleteMany({ where: { id: { in: staleIds } } });
      }
    } catch (error) {
      logger.warn('[TwinReplyDraft] dedup delete failed (harmless duplicate possible)', { error });
    }
  }
  await prisma.draftMessage.create({
    data: {
      workspaceId: draft.workspaceId,
      channelId: draft.channelId,
      conversationId: draft.conversationId,
      userId: draft.ownerUserId,
      content: draft.message ?? '',
      hasAttachment: false,
      origin: 'twin',
      metadata: JSON.stringify(draft),
      createdAt: new Date(draft.createdAt),
      updatedAt: new Date(draft.createdAt),
    },
  });
}

export async function getTwinReplyDraftById(
  id: string,
  ownerUserId: string,
): Promise<TwinReplyDraft | null> {
  try {
    const row = await db().draftMessage.findFirst({
      where: { id, userId: ownerUserId, origin: 'twin' },
      select: { metadata: true },
    });
    return parseTwinMetadata(row?.metadata);
  } catch (error) {
    logger.warn('[TwinReplyDraft] read failed, treating as no draft', { error });
    return null;
  }
}

export async function deleteTwinReplyDraftById(id: string, ownerUserId: string): Promise<void> {
  try {
    await db().draftMessage.deleteMany({ where: { id, userId: ownerUserId, origin: 'twin' } });
  } catch (error) {
    logger.warn('[TwinReplyDraft] delete failed', { error });
  }
}
