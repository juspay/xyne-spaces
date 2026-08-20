import { Request, Response } from 'express';
import { z } from 'zod';
import { logger } from '@/utils/logger';
import { getUserData, getUserDataByEmail } from '../core/userUtils';

// Look up a user by EITHER userId OR email (exactly one is required).
// - userId: resolves a user globally by primary key (existing behaviour).
// - email: resolves a user by email. Because email is only unique per workspace,
//   the lookup is scoped to the caller's authenticated workspace (see handler).
//   An optional workspaceId may be supplied but, if present, must match the
//   caller's own workspace — cross-workspace lookups are rejected.
const GetUserQuerySchema = z
  .object({
    userId: z.string().trim().min(1).optional(),
    email: z.string().trim().toLowerCase().email().optional(),
    workspaceId: z.string().trim().min(1).optional(),
  })
  .refine((data) => Boolean(data.userId) !== Boolean(data.email), {
    message: 'Provide exactly one of userId or email',
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

      const { userId, email, workspaceId } = queryResult.data;

      let userData;

      if (userId) {
        userData = await getUserData(userId);
      } else {
        // Email lookups are scoped to the caller's authenticated workspace so an
        // app installed in one workspace cannot read another workspace's users.
        const callerWorkspaceId = req.user?.workspaceId;
        if (!callerWorkspaceId) {
          res.status(401).json({
            error: 'Unauthorized',
            code: 'UNAUTHORIZED',
          });
          return;
        }

        // If a workspaceId is supplied, it must be the caller's own workspace.
        if (workspaceId && workspaceId !== callerWorkspaceId) {
          res.status(403).json({
            error: 'Cannot access users outside your workspace',
            code: 'FORBIDDEN',
          });
          return;
        }

        userData = await getUserDataByEmail(email!, callerWorkspaceId);
      }

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
