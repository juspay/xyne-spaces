import { db } from '@/database/client';
import { redisService } from '@/services/redisService';
import { logger } from '@/utils/logger';
import type { TelephonyEvent } from '@/integrations/adapters/ozonetel/types';

export interface LinkedTicketTarget {
  ticketId: string;
  conversationId: string;
  channelId: string;
}

/** The ticket POST /link-call tied this call to. externalId is monitorUCID ?? ucid, and both are stored. */
export async function resolveLinkedTicketTarget(
  event: TelephonyEvent,
): Promise<LinkedTicketTarget | null> {
  let ticketId: string | null;
  try {
    ticketId = await redisService.getOzonetelCallTicket(event.workspaceId, event.externalId);
  } catch (error) {
    logger.warn('[telephony] call_ticket_lookup_failed', {
      workspaceId: event.workspaceId,
      externalId: event.externalId,
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
  if (!ticketId) return null;

  const ticket = await db.ticket.findFirst({
    where: { id: ticketId, workspaceId: event.workspaceId },
    select: { id: true, conversationId: true, channelId: true },
  });
  if (!ticket?.conversationId || !ticket.channelId) return null;

  return { ticketId: ticket.id, conversationId: ticket.conversationId, channelId: ticket.channelId };
}
