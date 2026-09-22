import { Request, Response } from 'express';
import { z } from 'zod';
import { DatabaseClient } from '@/database/client';
import { logger } from '@/utils/logger';
import { deskThreadCanvasService, CanvasGenerationInProgressError } from '@/services/deskThreadCanvasService';
import { ClawAgentNotAvailableError } from '@/services/clawAgentService';
import { assertChannelMembership } from '@/utils/channelMembership';

const prisma = DatabaseClient.getInstance();

const CreateDeskThreadCanvasSchema = z.object({
  scope: z.enum(['chat', 'email', 'both']),
  labels: z.array(z.string()).default([]),
  includeMerged: z.boolean().default(false),
});

export class DeskThreadCanvasController {
  /** Dispatches the agent and returns immediately with the created-or-reused
   *  canvas; it fills in when the agent's callback lands. */
  createCanvasFromThread = async (req: Request, res: Response): Promise<void> => {
    try {
      const { ticketId } = req.params;
      const userId = req.user?.id;
      const workspaceId = req.user?.workspaceId;
      if (!userId || !workspaceId) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
      }

      const parsed = CreateDeskThreadCanvasSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: 'Invalid request body', details: parsed.error.issues });
        return;
      }

      const ticket = await prisma.ticket.findUnique({ where: { id: ticketId } });
      if (!ticket || ticket.isArchived) {
        res.status(404).json({ error: 'Ticket not found' });
        return;
      }
      if (ticket.workspaceId !== workspaceId) {
        res.status(403).json({ error: 'Ticket belongs to a different workspace' });
        return;
      }
      // The app-level ACL is route-scoped: without this, any workspace member
      // could synthesize a private desk channel's thread into a canvas they own.
      const access = await assertChannelMembership(req, ticket.channelId);
      if (!access.ok) {
        res.status(access.status).json({ error: access.error });
        return;
      }

      const { scope, labels, includeMerged } = parsed.data;
      const result = await deskThreadCanvasService.dispatch({
        ticket,
        user: { id: userId, name: req.user?.name ?? req.user?.displayName ?? null, email: req.user!.email, workspaceId },
        scope,
        labels,
        includeMerged,
        cookie: req.headers.cookie,
      });
      res.json(result);
    } catch (error) {
      if (error instanceof CanvasGenerationInProgressError) {
        res.status(409).json({ error: 'Canvas generation already in progress for this ticket' });
        return;
      }
      if (error instanceof ClawAgentNotAvailableError) {
        res.status(409).json({ error: `Canvas generation agent isn't available in this workspace` });
        return;
      }
      logger.error('[DeskThreadCanvas] dispatch failed:', error);
      // Usually claw being unreachable — say so instead of making the user
      // read the server log.
      res.status(500).json({
        error:
          error instanceof Error
            ? `Couldn't start canvas generation: ${error.message}`
            : 'Failed to create canvas from thread',
      });
    }
  };
}
