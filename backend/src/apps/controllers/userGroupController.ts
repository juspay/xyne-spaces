import { Request, Response } from 'express';
import { logger } from '@/utils/logger';
import { getAllUserGroups } from '../core/userGroupUtils';

export class UserGroupController {
  listUserGroups = async (_req: Request, res: Response): Promise<void> => {
    try {
      const userGroups = await getAllUserGroups();

      res.status(200).json(userGroups);
    } catch (error) {
      logger.error('Error fetching user groups:', error);

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
