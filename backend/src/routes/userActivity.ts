import { Router, Request, Response } from 'express';
import { DatabaseClient } from '@/database/client';
import { logger } from '@/utils/logger';
import type { UserActivityResponse, Platform } from '@xyne/shared';

const router = Router();
const prisma = DatabaseClient.getInstance();

router.get('/', async (req: Request, res: Response) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const cursor = req.query.cursor as string | undefined;
    const limit = Math.min(parseInt(req.query.limit as string) || 20, 50);

    const activities = await prisma.userActivityEvent.findMany({
      where: {
        userId,
        ...(cursor ? { timestamp: { lt: new Date(cursor) } } : {}),
      },
      orderBy: { timestamp: 'desc' },
      take: limit + 1, // Fetch one extra to check if there's more
    });

    const hasMore = activities.length > limit;
    const data = hasMore ? activities.slice(0, -1) : activities;
    const nextCursor = hasMore && data.length > 0
      ? data[data.length - 1].timestamp.toISOString()
      : null;

    // Transform data to match UserActivity type
    const transformedData = data.map(activity => ({
      ...activity,
      timestamp: activity.timestamp.toISOString(),
      platform: activity.platform as Platform,
      contextMetadata: activity.contextMetadata
        ? (activity.contextMetadata as Record<string, unknown>)
        : null,
    }));

    const response: UserActivityResponse = {
      data: transformedData,
      pagination: {
        hasMore,
        nextCursor,
      },
    };

    res.json(response);
  } catch (error) {
    logger.error('Error fetching user activities:', error);
    res.status(500).json({ error: 'Failed to fetch activities' });
  }
});

export default router;
