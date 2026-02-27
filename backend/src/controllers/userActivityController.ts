import { Request, Response } from 'express';
import { db } from '@/database/client';
import { logger } from '@/utils/logger';
import type { UserActivityResponse, Platform } from '@xyne/shared';
import { userActivityService } from '@/services/userActivityService';

/**
 * Get user activities with aliases applied
 */
export async function getUserActivities(req: Request, res: Response): Promise<void> {
  try {
    const userId = req.user?.id;
    if (!userId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const cursor = req.query.cursor as string | undefined;
    const limit = Math.min(parseInt(req.query.limit as string) || 20, 50);

    const aliases = await db.activityAlias.findMany();

    const aliasMap = new Map(
      aliases.map(a => [`${a.eventName}|${a.eventCategory}`, a])
    );
    const blacklistedKeys = aliases
      .filter(a => a.isBlacklisted)
      .map(a => ({ eventName: a.eventName, eventCategory: a.eventCategory }));

    const activities = await db.userActivityEvent.findMany({
      where: {
        userId,
        ...(cursor ? { timestamp: { lt: new Date(cursor) } } : {}),
        ...(blacklistedKeys.length > 0 ? { NOT: blacklistedKeys } : {}),
      },
      orderBy: { timestamp: 'desc' },
      take: limit + 1, 
    });

    if (activities.length === 0) {
      const response: UserActivityResponse = {
        data: [],
        pagination: {
          hasMore: false,
          nextCursor: null,
        },
      };
      res.json(response);
      return;
    }

    const hasMore = activities.length > limit;
    const activitiesToProcess = hasMore ? activities.slice(0, limit) : activities;

    const resolvedActivities = await Promise.all(
      activitiesToProcess.map(async (activity) => userActivityService.resolveActivity(activity))
    );

    const data = resolvedActivities.map((activity) => {
      const key = `${activity.eventName}|${activity.eventCategory}`;
      const alias = aliasMap.get(key);
      return {
        id: activity.id,
        userId: activity.userId,
        sessionId: activity.sessionId,
        // Display names (aliased if exists)
        eventName: alias?.aliasEventName || activity.eventName,
        eventCategory: alias?.aliasEventCategory || activity.eventCategory,
        // Original names (for config/lookup)
        originalEventName: activity.eventName,
        originalEventCategory: activity.eventCategory,
        eventLabel: activity.eventLabel,
        url: activity.url,
        triggerType: activity.triggerType,
        contextMetadata: activity.contextMetadata
          ? (activity.contextMetadata as Record<string, unknown>)
          : null,
        platform: activity.platform as Platform,
        relatedData: activity.relatedData,
        timestamp: activity.timestamp.toISOString(),
        hasAlias: !!alias,
        isBlacklisted: false,
      };
    });

    const nextCursor = hasMore && data.length > 0
      ? data[data.length - 1].timestamp
      : null;

    const response: UserActivityResponse = {
      data,
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
}
