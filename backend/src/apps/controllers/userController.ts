import { Request, Response } from 'express';
import { z } from 'zod';
import { logger } from '@/utils/logger';
import { getUserData } from '../core/userUtils';

const GetUserQuerySchema = z.object({
  userId: z.string().min(1, 'User ID is required').trim(),
});

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
}
