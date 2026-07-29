import { Request, Response, NextFunction } from 'express';
import { scheduleCallController } from '@/controllers/scheduleCallController';
import { logger } from '@/utils/logger';

const DEFAULT_START_LEAD_MS = 5 * 60 * 1000;
const DEFAULT_DURATION_MS = 30 * 60 * 1000;

export class AppCallController {

  scheduleCall = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const startsAt =
        typeof req.body?.startsAt === 'number'
          ? req.body.startsAt
          : Date.now() + DEFAULT_START_LEAD_MS;
      const endsAt =
        typeof req.body?.endsAt === 'number' ? req.body.endsAt : startsAt + DEFAULT_DURATION_MS;

      req.body.startsAt = startsAt;
      req.body.endsAt = endsAt;

      await scheduleCallController.scheduleCall(req, res);
    } catch (error) {
      logger.error('[AppCallController] Failed to schedule call:', error);
      next(error);
    }
  };
}
