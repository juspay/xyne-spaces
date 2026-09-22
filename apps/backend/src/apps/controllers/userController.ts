import { Request, Response } from 'express';
import { z } from 'zod';
import { logger } from '@/utils/logger';
import { getUserData, setUserStatus, clearUserStatus } from '../core/userUtils';

const GetUserQuerySchema = z.object({
  userId: z.string().min(1, 'User ID is required').trim(),
});

const MAX_DURATION_SECONDS = 365 * 24 * 60 * 60; // 1 year

const SetStatusBodySchema = z
  .object({
    statusEmoji: z.string().max(100).nullable().optional(),
    statusContent: z.string().max(200).nullable().optional(),
    durationSeconds: z
      .number()
      .int()
      .positive()
      .max(MAX_DURATION_SECONDS)
      .optional(),
    expiresAt: z.number().int().positive().optional(),
  })
  .refine(
    (body) => !(body.durationSeconds !== undefined && body.expiresAt !== undefined),
    { message: 'Provide only one of durationSeconds or expiresAt' },
  )
  .refine(
    (body) => Boolean(body.statusEmoji || body.statusContent),
    { message: 'At least one of statusEmoji or statusContent is required' },
  );

export class UserController {
  getUserInfo = async (req: Request, res: Response): Promise<void> => {
    try {
      const queryResult = GetUserQuerySchema.safeParse(req.query);
      
      if (!queryResult.success) {
        res.status(400).json({ 
          error: 'Validation error',
          code: 'VALIDATION_ERROR',
        });
        return;
      }

      const { userId } = queryResult.data;

      const userData = await getUserData(userId);

      res.status(200).json(userData);
    } catch (error) {
      logger.error('Error fetching user data:', error);

      if (error instanceof Error) {
        if (error.message.includes('not found')) {
          res.status(404).json({
            error: error.message,
            code: 'NOT_FOUND',
          });
          return;
        }
      }

      res.status(500).json({ error: 'Internal server error' });
    }
  };

  /**
   * POST /api/apps/user/status
   *
   * Sets the status of the calling app's own user. The target user is always
   * taken from the verified app token — an app can never set another user's
   * status through this endpoint.
   */
  setStatus = async (req: Request, res: Response): Promise<void> => {
    try {
      const bodyResult = SetStatusBodySchema.safeParse(req.body ?? {});

      if (!bodyResult.success) {
        res.status(400).json({
          error: bodyResult.error.issues[0]?.message ?? 'Validation error',
          code: 'VALIDATION_ERROR',
        });
        return;
      }

      const user = req.user;
      if (!user?.id || !user.workspaceId) {
        res.status(401).json({ error: 'Unauthorized', code: 'UNAUTHORIZED' });
        return;
      }

      const status = await setUserStatus(user.id, user.workspaceId, bodyResult.data);

      res.status(200).json(status);
    } catch (error) {
      logger.error('Error setting user status:', error);

      if (error instanceof Error && /required|must be|only one of|Invalid emoji/.test(error.message)) {
        res.status(400).json({ error: error.message, code: 'VALIDATION_ERROR' });
        return;
      }

      res.status(500).json({ error: 'Internal server error' });
    }
  };

  /**
   * DELETE /api/apps/user/status
   *
   * Clears the calling app user's status (emoji, text and expiry). Idempotent:
   * clearing an already-empty status succeeds.
   */
  deleteStatus = async (req: Request, res: Response): Promise<void> => {
    try {
      const user = req.user;
      if (!user?.id || !user.workspaceId) {
        res.status(401).json({ error: 'Unauthorized', code: 'UNAUTHORIZED' });
        return;
      }

      const status = await clearUserStatus(user.id, user.workspaceId);

      res.status(200).json(status);
    } catch (error) {
      logger.error('Error clearing user status:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  };
}
