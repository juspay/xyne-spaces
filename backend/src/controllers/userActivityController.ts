import { Request, Response } from 'express';
import { db } from '@/database/client';
import { logger } from '@/utils/logger';
import type { UserActivityResponse, Platform } from '@xyne/shared';

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

    // Fetch activities with original names
    const activities = await db.userActivityEvent.findMany({
      where: {
        userId,
        ...(cursor ? { timestamp: { lt: new Date(cursor) } } : {}),
      },
      orderBy: { timestamp: 'desc' },
      take: limit + 1, // Fetch one extra to check if there's more
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

    // Get unique event keys for alias lookup
    const eventKeys = activities.map(a => ({
      eventName: a.eventName,
      eventCategory: a.eventCategory,
    }));

    // Fetch all aliases for these events in one query
    const aliases = await db.activityAlias.findMany({
      where: {
        OR: eventKeys,
      },
    });

    // Create lookup map: "eventName|eventCategory" -> alias
    const aliasMap = new Map(
      aliases.map(a => [`${a.eventName}|${a.eventCategory}`, a])
    );

    // Transform activities: apply aliases, filter blacklisted
    const transformedData = [];
    for (const activity of activities) {
      const key = `${activity.eventName}|${activity.eventCategory}`;
      const alias = aliasMap.get(key);

      // Skip blacklisted activities
      if (alias?.isBlacklisted) {
        continue;
      }

      transformedData.push({
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
        timestamp: activity.timestamp.toISOString(),
        hasAlias: !!alias,
        isBlacklisted: false,
      });
    }

    const hasMore = transformedData.length > limit;
    const data = hasMore ? transformedData.slice(0, -1) : transformedData;
    const nextCursor = hasMore && data.length > 0
      ? activities[activities.length - 1].timestamp.toISOString()
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
