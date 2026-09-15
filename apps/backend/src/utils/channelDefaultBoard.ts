import { PrismaClient } from '@prisma/client';
import { logger } from '@/utils/logger';

export interface ResolvedChannelBoard {
  boardId: string;
  /** projectId of the resolved board (`board.projectId`). May be null if the board row has none. */
  projectId: string | null;
}

/**
 * Resolve a channel's default board (and that board's projectId).
 *
 * Primary source of truth: `ChannelBoardMapping` (isDefault first, then oldest).
 *
 * Legacy fallback: if no mapping row exists — e.g. a channel that predates the
 * backfill or was missed by it — fall back to the OLD behaviour of reading
 * `channel.projectId` and taking the oldest board in that project. Every time the
 * fallback fires it logs a WARN tagged `[CBM_FALLBACK]` with the channelId, so
 * missed backfills are observable in production.
 *
 * If `[CBM_FALLBACK]` never appears in the logs, the fallback block below (and the
 * last remaining reads of `channel.projectId`) can be deleted outright — that is
 * the whole point of the tag.
 *
 * Returns null only when neither the mapping nor the legacy project yields a board.
 *
 * @param db        A Prisma client (`db` / `this.prisma`). The same handle the
 *                  call site already uses, so ACL/tenant scoping is preserved.
 * @param channelId The channel to resolve the default board for.
 */
export async function resolveChannelDefaultBoard(
  db: PrismaClient,
  channelId: string,
): Promise<ResolvedChannelBoard | null> {
  // ---- Primary: ChannelBoardMapping ----
  const mapping = await db.channelBoardMapping.findFirst({
    where: { channelId },
    orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }],
    include: { board: { select: { id: true, projectId: true } } },
  });

  if (mapping?.board) {
    return { boardId: mapping.board.id, projectId: mapping.board.projectId };
  }

  // ---- Legacy fallback (DELETE once [CBM_FALLBACK] is confirmed gone) ----
  const channel = await db.channel.findUnique({
    where: { id: channelId },
    select: { projectId: true },
  });

  if (!channel?.projectId) {
    return null;
  }

  const board = await db.board.findFirst({
    where: { projectId: channel.projectId },
    orderBy: { createdAt: 'asc' },
    select: { id: true, projectId: true },
  });

  if (!board) {
    return null;
  }

  logger.warn(
    `[CBM_FALLBACK] No ChannelBoardMapping for channel ${channelId}; ` +
      `fell back to legacy channel.projectId=${channel.projectId} → board ${board.id}. ` +
      `This channel needs backfilling.`,
  );

  return { boardId: board.id, projectId: board.projectId };
}
