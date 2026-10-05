import { transaction } from '../base';
import { db } from '@/database/client';
import { BulkTicketMode } from '@xyne/shared';
import { resolveInheritedOwner, linkCreatedEntities } from '@/sdlc/entityLinkService';
import { syncConversationSubTicketsMd } from '@/utils/ticketMd';
import {
  commitRows,
  commitSubTicketLinks,
  type BatchTicketContext,
  type PreparedRow,
} from '@/services/tickets/bulkTicketBatchService';

/** Comfortable for a batch this size; Prisma's 5s default is not. */
const BATCH_TRANSACTION_TIMEOUT_MS = 30_000;
const BATCH_TRANSACTION_MAX_WAIT_MS = 5_000;

/**
 * Commits a whole bulk ticket batch — every ticket row, SDLC links inherited
 * from the source conversation, sub-ticket links and the parent's rebuilt card —
 * so the request lands completely or not at all.
 */
export function commitBulkTicketBatchTx(params: {
  mode: BulkTicketMode;
  prepared: PreparedRow[];
  childRows: PreparedRow[];
  parentLink: { id: string; conversationId: string; workspaceId: string } | null;
  ctx: BatchTicketContext;
}) {
  const { mode, prepared, childRows, parentLink, ctx } = params;
  return transaction(
    [
      'Channel',
      'Conversation',
      'ConversationParticipant',
      'Merchant',
      'Message',
      'SdlcEntityLink',
      'SubTicket',
      'Ticket',
      'TicketActivity',
      'TicketDescription',
      'TicketStageEta',
      'TicketSubTicketMapping',
      'TicketTag',
    ],
    'createBulkTicketBatch: tickets, conversations, entity links, sub-ticket links and the parent card must commit atomically; tx is not ACL-wrapped',
    db,
    async (tx) => {
      await commitRows(tx, prepared, ctx);

      // SDLC linking: the owner comes from the conversation the batch was raised
      // in, not from the freshly created ones (those can't have a link yet).
      if (ctx.sourceConversationId) {
        const owner = await resolveInheritedOwner(tx, ctx.sourceConversationId);
        if (owner) {
          for (const row of prepared) {
            await linkCreatedEntities(
              tx,
              {
                owner,
                channelId: row.input.channelId,
                conversationId: row.conversationId,
                ticketId: row.ticketId,
              },
              { workspaceId: row.workspaceId, userId: ctx.createdBy }
            );
          }
        }
      }

      if (mode === BulkTicketMode.PARENT_SUB && parentLink) {
        await commitSubTicketLinks(tx, parentLink, childRows, ctx);
        // Reads back the rows just inserted above, so it must stay inside this
        // transaction — and running it once is the whole point: the per-item
        // path re-serialises the parent's entire child list on every insert.
        await syncConversationSubTicketsMd(tx, parentLink.id);
      }
    },
    { timeout: BATCH_TRANSACTION_TIMEOUT_MS, maxWait: BATCH_TRANSACTION_MAX_WAIT_MS }
  );
}
