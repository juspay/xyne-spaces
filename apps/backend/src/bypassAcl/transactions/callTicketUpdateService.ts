import { Prisma } from '@prisma/client';
import { transaction } from '../base';
import { db } from '@/database/client';
import { lockMessageContentAndMetadata } from '@/bypassAcl/rowLockServices';
import {
  buildTicketUpdatesContent,
  parseTicketUpdatesContent,
  type TicketUpdatesDoc,
} from '@/utils/ticketUpdateMarkdown';

/**
 * Every write to a "ticket updates" card goes through here. The card is one
 * message that several people act on at once (approve, ignore, a pipeline
 * re-run), and its state is the message content, so a plain read-modify-write
 * lets one writer overwrite another. This locks the message row, re-reads the
 * content under the lock, applies `mutate` to that current document and writes
 * the result, so writers are serialised and none works from a stale copy.
 *
 * `mutate` returns the document to store (omit `doc` to leave the card
 * untouched) and a result for the caller. Each stored write bumps
 * `metadata.version`.
 *
 * The card is a bot message and the messages ACL only lets users edit their own
 * messages, so this runs outside the ACL. Callers must have checked the user's
 * access to the call and to the ticket before calling.
 */
export function mutateTicketUpdatesCardTx<T>(
  messageId: string,
  mutate: (doc: TicketUpdatesDoc) => { doc?: TicketUpdatesDoc; result: T },
): Promise<{ found: false } | { found: true; result: T; content: string }> {
  return transaction(
    ['Message'],
    'ticket updates card: approve/ignore/re-run must re-read and rewrite the card under a row lock so concurrent writers cannot overwrite each other; access is checked by the caller',
    db,
    async (tx) => {
      const row = await lockMessageContentAndMetadata(tx, messageId);
      if (!row) return { found: false as const };
      const { doc, result } = mutate(parseTicketUpdatesContent(row.content));
      if (!doc) return { found: true as const, result, content: row.content };
      const content = buildTicketUpdatesContent(doc);
      const metadata = (row.metadata && typeof row.metadata === 'object' ? row.metadata : {}) as Record<string, unknown>;
      await tx.message.update({
        where: { messageId },
        data: {
          content,
          edited: true,
          metadata: {
            ...metadata,
            version: Number(metadata['version'] ?? 1) + 1,
            ticketUpdatesCount: doc.updates.length,
            lastUpdatedAt: new Date().toISOString(),
          } as Prisma.InputJsonObject,
        },
      });
      return { found: true as const, result, content };
    },
  );
}
