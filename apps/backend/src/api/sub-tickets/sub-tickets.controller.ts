import { api } from '@xyne/shared';
import { ContractError, controller } from '@/framework/api';
import { linkExistingSubTicket, SubTicketLinkError, unlinkSubTicket, type SubTicketLinkActor } from '@/services/subTicketLinkService';
import type { AuthenticatedUser } from '@/types/express';
import { logger } from '@/utils/logger';

// ─── Sub-tickets ────────────────────────────────────────────────────────────

function subTicketActor(user: AuthenticatedUser | undefined): SubTicketLinkActor {
  const userId = user?.id;
  const workspaceId = user?.workspaceId;
  if (!userId || !workspaceId) throw new ContractError(401, { error: 'Unauthorized' });
  // role here is untrusted (the API-key path sets the key's role); the service re-resolves the
  // workspace role from users.role before any guest decision.
  return { userId, workspaceId, role: user?.role ?? '' };
}

function subTicketFailure(error: unknown, fallback: string): ContractError {
  if (error instanceof ContractError) return error;
  if (error instanceof SubTicketLinkError) return new ContractError(error.status, { error: error.message });
  logger.error(`[SubTicketController] ${fallback}:`, error);
  return new ContractError(500, { error: fallback });
}

/** POST /sub-tickets/link: answers 201. */
export const linkSubTicket = controller(api.subTickets.link, async (input, reply) => {
  reply.status(201);
  const actor = subTicketActor(input.user);
  const { ticketId, mappedTicketId, subTicketTitle } = input.body;
  try {
    return await linkExistingSubTicket({
      actor,
      ticketId: ticketId.trim(),
      mappedTicketId: mappedTicketId.trim(),
      subTicketTitle: typeof subTicketTitle === 'string' && subTicketTitle.trim() ? subTicketTitle.trim() : 'Subticket',
    });
  } catch (error) {
    throw subTicketFailure(error, 'Failed to link sub-ticket');
  }
});

/** POST /sub-tickets/unlink: answers 204. */
export const unlinkSubTicketHandler = controller(api.subTickets.unlink, async (input, reply) => {
  reply.status(204);
  const actor = subTicketActor(input.user);
  try {
    await unlinkSubTicket({ actor, mappingId: input.body.mappingId.trim() });
    return null;
  } catch (error) {
    throw subTicketFailure(error, 'Failed to unlink sub-ticket');
  }
});