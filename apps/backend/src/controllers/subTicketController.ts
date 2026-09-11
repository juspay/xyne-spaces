import { Request, Response } from 'express';
import {
  linkExistingSubTicket,
  SubTicketLinkError,
  unlinkSubTicket,
  type SubTicketLinkActor,
} from '@/services/subTicketLinkService';
import { logger } from '@/utils/logger';

function resolveActor(req: Request): SubTicketLinkActor | null {
  const userId = req.user?.id;
  const workspaceId = req.user?.workspaceId;
  if (!userId || !workspaceId) {
    return null;
  }
  // role here is untrusted (the API-key path sets the key's role); the service
  // re-resolves the workspace role from users.role before any guest decision.
  return { userId, workspaceId, role: req.user?.role ?? '' };
}

function handleError(res: Response, error: unknown, fallback: string): void {
  if (error instanceof SubTicketLinkError) {
    res.status(error.status).json({ error: error.message });
    return;
  }
  logger.error(`[SubTicketController] ${fallback}:`, error);
  res.status(500).json({ error: fallback });
}

export class SubTicketController {
  linkExisting = async (req: Request, res: Response): Promise<void> => {
    const actor = resolveActor(req);
    if (!actor) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { ticketId, mappedTicketId, subTicketTitle } = req.body ?? {};
    if (typeof ticketId !== 'string' || !ticketId.trim()) {
      res.status(400).json({ error: 'ticketId is required' });
      return;
    }
    if (typeof mappedTicketId !== 'string' || !mappedTicketId.trim()) {
      res.status(400).json({ error: 'mappedTicketId is required' });
      return;
    }

    try {
      const result = await linkExistingSubTicket({
        actor,
        ticketId: ticketId.trim(),
        mappedTicketId: mappedTicketId.trim(),
        subTicketTitle:
          typeof subTicketTitle === 'string' && subTicketTitle.trim()
            ? subTicketTitle.trim()
            : 'Subticket',
      });
      res.status(201).json(result);
    } catch (error) {
      handleError(res, error, 'Failed to link sub-ticket');
    }
  };

  unlink = async (req: Request, res: Response): Promise<void> => {
    const actor = resolveActor(req);
    if (!actor) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { mappingId } = req.body ?? {};
    if (typeof mappingId !== 'string' || !mappingId.trim()) {
      res.status(400).json({ error: 'mappingId is required' });
      return;
    }

    try {
      await unlinkSubTicket({ actor, mappingId: mappingId.trim() });
      res.status(204).send();
    } catch (error) {
      handleError(res, error, 'Failed to unlink sub-ticket');
    }
  };
}
