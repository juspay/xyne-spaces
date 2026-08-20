import { Request, Response } from 'express';
import { z } from 'zod';
import { logger } from '@/utils/logger';
import { getUserData } from '../core/userUtils';
import { DatabaseClient } from '@/database/client';
import { UserPresenceStatus } from '@xyne/shared';

const GetUserQuerySchema = z.object({
  userId: z.string().min(1, 'User ID is required').trim(),
});

const SetOwnStatusBodySchema = z
  .object({
    statusEmoji: z.string().max(100).nullable().optional(),
    statusContent: z.string().max(280).nullable().optional(),
    statusExpiryAt: z.coerce.date().nullable().optional(),
    assignmentUnavailableUntil: z.coerce.date().nullable().optional(),
    notificationsPausedUntil: z.coerce.date().nullable().optional(),
  })
  .refine((data) => Object.values(data).some((value) => value !== undefined), {
    message: 'At least one status field must be provided',
  });

const prisma = DatabaseClient.getInstance();

function decodeStatusEmoji(statusEmoji: string | null | undefined): string | null | undefined {
  if (statusEmoji === undefined || statusEmoji === null) return statusEmoji;
  try {
    const decoded = decodeURIComponent(statusEmoji);
    if (!decoded.trim()) return null;
    if (decoded.length > 100) throw new Error('Invalid emoji encoding');
    return decoded;
  } catch (error) {
    if (error instanceof URIError) throw new Error('Invalid emoji encoding');
    throw error;
  }
}

export class UserController {
  setOwnStatus = async (req: Request, res: Response): Promise<void> => {
    try {
      const bodyResult = SetOwnStatusBodySchema.safeParse(req.body);
      if (!bodyResult.success) {
        res.status(400).json({
          error: 'Validation error',
          code: 'VALIDATION_ERROR',
        });
        return;
      }

      const userId = req.user?.id;
      const workspaceId = req.user?.workspaceId;
      if (!userId || !workspaceId) {
        res.status(401).json({ error: 'Unauthorized', code: 'UNAUTHORIZED' });
        return;
      }

      const {
        statusEmoji,
        statusContent,
        statusExpiryAt,
        assignmentUnavailableUntil,
        notificationsPausedUntil,
      } = bodyResult.data;
      const validatedEmoji = decodeStatusEmoji(statusEmoji);
      const now = new Date();

      const result = await prisma.$transaction(async (tx) => {
        const existingPresence = await tx.userPresence.findUnique({ where: { userId } });
        const presence = await tx.userPresence.upsert({
          where: { userId },
          create: {
            userId,
            workspaceId,
            status: UserPresenceStatus.OFFLINE,
            lastActiveAt: now,
            lastSeenAt: now,
            isManual: false,
            ...(statusEmoji !== undefined && { statusEmoji: validatedEmoji }),
            ...(statusContent !== undefined && { statusContent }),
            ...(statusExpiryAt !== undefined && { statusExpiryAt }),
            ...(assignmentUnavailableUntil !== undefined && { assignmentUnavailableUntil }),
            ...(notificationsPausedUntil !== undefined && { notificationsPausedUntil }),
          },
          update: {
            lastActiveAt: now,
            lastSeenAt: now,
            status: existingPresence?.status ?? UserPresenceStatus.OFFLINE,
            ...(statusEmoji !== undefined && { statusEmoji: validatedEmoji }),
            ...(statusContent !== undefined && { statusContent }),
            ...(statusExpiryAt !== undefined && { statusExpiryAt }),
            ...(assignmentUnavailableUntil !== undefined && { assignmentUnavailableUntil }),
            ...(notificationsPausedUntil !== undefined && { notificationsPausedUntil }),
          },
        });

        await tx.user.update({
          where: { id: userId },
          data: {
            lastActiveAt: now,
            ...(statusEmoji !== undefined && { statusEmoji: validatedEmoji }),
            ...(statusContent !== undefined && { statusContent }),
            ...(statusExpiryAt !== undefined && { statusExpiryAt }),
            ...(assignmentUnavailableUntil !== undefined && { assignmentUnavailableUntil }),
            ...(notificationsPausedUntil !== undefined && { notificationsPausedUntil }),
          },
        });

        return presence;
      });

      res.status(200).json({
        userId,
        statusEmoji: result.statusEmoji,
        statusContent: result.statusContent,
        statusExpiryAt: result.statusExpiryAt,
        assignmentUnavailableUntil: result.assignmentUnavailableUntil,
        notificationsPausedUntil: result.notificationsPausedUntil,
      });
    } catch (error) {
      logger.error('Error setting own user status:', error);

      if (error instanceof Error && error.message.includes('Invalid emoji')) {
        res.status(400).json({ error: error.message, code: 'VALIDATION_ERROR' });
        return;
      }

      res.status(500).json({ error: 'Internal server error' });
    }
  };

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
