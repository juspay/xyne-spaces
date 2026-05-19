import { Request, Response } from 'express';
import { z } from 'zod';
import { stageReconstructionService } from '@/services/stageReconstructionService';
import { logger } from '@/utils/logger';

const stageReconstructionRequestSchema = z.object({
  channelId: z.string().trim().min(1, 'channelId is required'),
  dryRun: z.boolean().optional(),
  ticketIds: z.array(z.string().trim().min(1, 'ticketIds must contain non-empty strings')).optional(),
}).strict();

export class StageReconstructionController {
  reconstructStages = async (req: Request, res: Response): Promise<void> => {
    const parsedBody = stageReconstructionRequestSchema.safeParse(req.body);
    if (!parsedBody.success) {
      res.status(400).json({
        error: 'Invalid request body',
        details: parsedBody.error.flatten(),
      });
      return;
    }

    const actorUserId = req.user?.id;
    if (!actorUserId) {
      res.status(401).json({ error: 'Authenticated user required' });
      return;
    }

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.setHeader('Content-Encoding', 'none');

    if (res.socket) res.socket.setNoDelay(true);
    res.flushHeaders();

    const pingInterval = setInterval(() => {
      if (!res.writableEnded) {
        res.write(`data: ${JSON.stringify({ type: 'ping' })}\n\n`);
        if (typeof (res as any).flush === 'function') (res as any).flush();
      }
    }, 20_000);

    try {
      const stream = stageReconstructionService.reconstruct({
        channelId: parsedBody.data.channelId,
        dryRun: parsedBody.data.dryRun,
        ticketIds: parsedBody.data.ticketIds,
        actorUserId,
      });

      for await (const event of stream) {
        if (res.writableEnded) break;
        res.write(`data: ${JSON.stringify(event)}\n\n`);
        if (typeof (res as any).flush === 'function') (res as any).flush();
      }

      res.write(`data: ${JSON.stringify({ type: 'end' })}\n\n`);
      res.end();
    } catch (error) {
      logger.error('[StageReconstruction] Request failed', error);
      if (!res.writableEnded) {
        res.write(`data: ${JSON.stringify({ type: 'error', error: 'Failed to reconstruct ticket stages' })}\n\n`);
        res.end();
      }
    } finally {
      clearInterval(pingInterval);
    }
  };
}
