/**
 * A ticket is dated by the message that created it. When an older message of the same thread is
 * appended later (a pull that brings back opening messages the live path missed, or a polled
 * message that lost a race to a newer one), the ticket, its conversation and its SLA should start
 * at the real first message. Shared by the app-desk pull and the X adapter.
 */
import { db } from '@/database/client';
import { vespaQueue } from '@/queues/vespaQueue';
import { computeSlaDueDates } from '@/utils/slaCalculator';
import { logger } from '@/utils/logger';
import { ticketSchema } from '@/vespa/src/types';

const TAG = '[BackdateConversation]';

/**
 * Priority-SLA boards set the ticket's `eta` from its first message at creation. Returns the eta
 * for the earlier start, but only when the current eta is still exactly the one that policy gives
 * for the old start, i.e. nobody (an agent, a stage rule) has changed it since.
 */
async function slaEtaForNewStart(
  ticket: { boardId: string | null; priority: string; createdAt: Date; eta: Date | null },
  newStart: Date,
): Promise<Date | null> {
  if (!ticket.boardId || !ticket.eta) return null;
  const board = await db.board.findUnique({ where: { id: ticket.boardId }, select: { metadata: true } });
  if ((board?.metadata as { slaPolicyType?: string } | null)?.slaPolicyType !== 'priority') return null;
  const policy = await db.boardSlaPolicy.findUnique({
    where: { boardId_priority: { boardId: ticket.boardId, priority: ticket.priority as never } },
    select: {
      responseHours: true,
      resolutionHours: true,
      businessHoursOnly: true,
      timezone: true,
      workdayStart: true,
      workdayEnd: true,
      isActive: true,
    },
  });
  if (!policy?.isActive) return null;
  const original = computeSlaDueDates(ticket.createdAt, policy).slaResolutionDue;
  if (!original || original.getTime() !== ticket.eta.getTime()) return null;
  return computeSlaDueDates(newStart, policy).slaResolutionDue;
}

/**
 * Moves the conversation's ticket and the conversation back to `sentAt` when they are dated later.
 * Conditional updates: it only ever moves a date earlier, so a re-run, a concurrent append or an
 * out-of-order page cannot push it forward again. Also moves an untouched priority-SLA eta, and
 * re-feeds the ticket's search document (a feed job re-reads the row).
 */
export async function backdateConversationToMessage(conversationId: string, sentAt: Date): Promise<void> {
  const lateTickets = await db.ticket.findMany({
    where: { conversationId, createdAt: { gt: sentAt } },
    select: { id: true, workspaceId: true, boardId: true, priority: true, createdAt: true, eta: true },
  });
  const [tickets, conversations] = await db.$transaction([
    db.ticket.updateMany({
      where: { conversationId, createdAt: { gt: sentAt } },
      data: { createdAt: sentAt },
    }),
    db.conversation.updateMany({
      where: { conversationId, createdAt: { gt: sentAt } },
      data: { createdAt: sentAt },
    }),
  ]);
  if (tickets.count === 0 && conversations.count === 0) return;
  logger.info(`${TAG} Backdated thread to an older message`, { conversationId, createdAt: sentAt.toISOString() });

  for (const ticket of lateTickets) {
    try {
      const eta = await slaEtaForNewStart(ticket, sentAt);
      if (eta) await db.ticket.updateMany({ where: { id: ticket.id, eta: ticket.eta }, data: { eta } });
    } catch (error) {
      logger.warn(`${TAG} Could not move the SLA due date with the backdate`, { ticketId: ticket.id, error: String(error) });
    }
    vespaQueue
      .addJob({ schema: ticketSchema, jobType: 'feed', docId: ticket.id, workspaceId: ticket.workspaceId })
      .catch((error: unknown) => logger.error(`${TAG} Search re-feed after backdate failed`, { ticketId: ticket.id, error }));
  }
}
