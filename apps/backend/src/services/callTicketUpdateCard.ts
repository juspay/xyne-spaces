import { randomUUID } from 'crypto';
import type { Prisma } from '@prisma/client';
import { db } from '@/database/client';
import { runWithContext, withWorkspaceScope } from '@/database/tenant/context';
import { unifiedBotUserService } from '@/bots/unified/services/unified-bot-user-service.js';
import { logger } from '@/utils/logger';
import {
  buildTicketUpdatesContent,
  parseTicketUpdatesContent,
  type TicketUpdatesDoc,
} from '@/utils/ticketUpdateMarkdown';

const MAX_ATTEMPTS = 5;

/**
 * Every write to a "ticket updates" card goes through here. The card is one
 * message that several people act on at once (approve, ignore, a pipeline
 * re-run), and its state is the message content, so a plain read-modify-write
 * lets one writer overwrite another.
 *
 * There is no row lock: the write runs as the Xyne Automatic bot that posted
 * the card, through the ordinary client, and Prisma cannot make a conditional
 * update atomic. Instead each write is stamped with its own `writeId` and read
 * back; a stamp that is not ours means another writer landed in between, and
 * the attempt starts over from what the card holds now. `mutate` is therefore
 * applied to the latest document on every attempt and must be idempotent: on a
 * document that already carries its change it returns no `doc` (nothing to
 * write) and the same result.
 *
 * Callers must have checked the user's access to the call and to the ticket
 * before calling. Each stored write bumps `metadata.version`.
 */
export async function mutateTicketUpdatesCard<T>(
  messageId: string,
  mutate: (doc: TicketUpdatesDoc) => { doc?: TicketUpdatesDoc; result: T },
): Promise<{ found: false } | { found: true; result: T }> {
  const writeId = randomUUID();
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    // Read by id in workspace scope: the caller already decided who may act.
    const row = await withWorkspaceScope(async () => {
      return await db.message.findUnique({
        where: { messageId },
        select: { content: true, metadata: true, senderId: true, workspaceId: true },
      });
    });
    if (!row) return { found: false };

    const { doc, result } = mutate(parseTicketUpdatesContent(row.content));
    if (!doc) return { found: true, result };

    const bot = await unifiedBotUserService.getBotByBotId('xyne-automatic', row.workspaceId);
    if (!bot || bot.id !== row.senderId) {
      throw new Error('Ticket updates card is not a Xyne Automatic message - cannot update it');
    }
    const metadata = (row.metadata && typeof row.metadata === 'object' ? row.metadata : {}) as Record<string, unknown>;

    // Awaited inside the bot's context on purpose: a Prisma query only runs when
    // it is awaited, and awaiting it outside would run it as the caller.
    await runWithContext({ userId: bot.id, workspaceId: row.workspaceId }, async () => {
      return await db.message.update({
        where: { messageId },
        data: {
          content: buildTicketUpdatesContent(doc),
          edited: true,
          metadata: {
            ...metadata,
            version: Number(metadata['version'] ?? 1) + 1,
            writeId,
            ticketUpdatesCount: doc.updates.length,
            lastUpdatedAt: new Date().toISOString(),
          } as Prisma.InputJsonObject,
        },
        select: { messageId: true },
      });
    });

    const stored = await withWorkspaceScope(async () => {
      return await db.message.findUnique({ where: { messageId }, select: { metadata: true } });
    });
    const storedWriteId = (stored?.metadata as Record<string, unknown> | null)?.['writeId'];
    if (storedWriteId === writeId) return { found: true, result };

    // Someone else wrote the card between our read and our write: start over from what it holds now.
    logger.info('[callTicketUpdateCard] card_write_retry', { message_id: messageId, attempt });
  }
  throw new Error(`Ticket updates card ${messageId} kept changing underneath; gave up after ${MAX_ATTEMPTS} attempts`);
}
