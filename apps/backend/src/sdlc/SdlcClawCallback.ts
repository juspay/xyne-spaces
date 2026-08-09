import type { Request, Response } from 'express';
import { logger } from '@/utils/logger';
import { sdlcClawExecutionService } from './SdlcClawExecutionService';

export async function handleSdlcClawCallback(
  req: Request<{ executionId: string; step: string }>,
  res: Response,
): Promise<void> {
  try {
    await sdlcClawExecutionService.handleCallback(
      req.params.executionId,
      req.params.step,
      req.body ?? {},
    );
    res.json({ success: true });
  } catch (error) {
    logger.error('[SDLC-CLAW] callback failed', {
      executionId: req.params.executionId,
      step: req.params.step,
      error,
    });
    res.status(500).json({ success: false, error: 'Failed to process SDLC Claw callback' });
  }
}
