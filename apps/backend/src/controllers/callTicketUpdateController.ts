import type { Request, Response } from 'express';
import { z } from 'zod';
import { callTicketUpdateService } from '@/services/callTicketUpdateService';
import { logger } from '@/utils/logger';

const ApplySchema = z.object({
  postComment: z.boolean().default(true),
  changeStatus: z.boolean().default(false),
  message: z.string().trim().max(4000).optional(),
  stageName: z.string().trim().min(1).max(200).optional(),
});

/**
 * Approve / ignore one item on a call's "ticket updates" card. Both act as the
 * signed-in user: the comment is posted under their name and the stage move is
 * attributed to them, exactly as if they had done it on the ticket.
 */
export class CallTicketUpdateController {
  // POST /api/calls/:callId/ticket-updates/:updateId/apply
  apply = async (req: Request, res: Response): Promise<void> => {
    const userId = req.user?.id;
    const workspaceId = req.user?.workspaceId;
    const { callId, updateId } = req.params;
    if (!userId || !workspaceId) {
      res.status(401).json({ success: false, error: 'Unauthorized' });
      return;
    }
    const parsed = ApplySchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      res.status(400).json({ success: false, error: parsed.error.errors[0]?.message ?? 'Invalid request' });
      return;
    }
    try {
      const result = await callTicketUpdateService.apply({
        callExternalId: callId,
        updateId,
        userId,
        workspaceId,
        role: req.user?.role,
        ...parsed.data,
      });
      if (!result.ok) {
        res.status(result.status).json({ success: false, error: result.error, ...(result.stageOptions ? { stageOptions: result.stageOptions } : {}) });
        return;
      }
      res.json({ success: true, content: result.content, applied: result.applied });
    } catch (error) {
      logger.error(`[${callId}] ticket_update_apply_failed`, { update_id: updateId, error });
      res.status(500).json({ success: false, error: 'Failed to apply ticket update' });
    }
  };

  // POST /api/calls/:callId/ticket-updates/:updateId/ignore
  ignore = async (req: Request, res: Response): Promise<void> => {
    const userId = req.user?.id;
    const workspaceId = req.user?.workspaceId;
    const { callId, updateId } = req.params;
    if (!userId || !workspaceId) {
      res.status(401).json({ success: false, error: 'Unauthorized' });
      return;
    }
    try {
      const result = await callTicketUpdateService.ignore({
        callExternalId: callId,
        updateId,
        userId,
        workspaceId,
        role: req.user?.role,
      });
      if (!result.ok) {
        res.status(result.status).json({ success: false, error: result.error });
        return;
      }
      res.json({ success: true, content: result.content, ignored: result.ignored });
    } catch (error) {
      logger.error(`[${callId}] ticket_update_ignore_failed`, { update_id: updateId, error });
      res.status(500).json({ success: false, error: 'Failed to ignore ticket update' });
    }
  };
}

export const callTicketUpdateController = new CallTicketUpdateController();
