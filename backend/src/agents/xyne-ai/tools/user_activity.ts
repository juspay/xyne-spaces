/**
 * User Activity Tool
 * Fetches activity events for the current user within a given time range.
 */

import { z } from 'zod';
import type { Tool } from '@xynehq/jaf';
import { db } from '../../../database/client.js';
import { logger } from '../../../utils/logger.js';
import { getDescription, toIST } from './helpers.js';
import { userActivityService } from '../../../services/userActivityService.js';
import type { XyneAIAgentContext } from './types.js';

// ============================================================================
// Tool Factory
// ============================================================================

export function createUserActivityTool(): Tool<
  { start_time: string; end_time: string },
  XyneAIAgentContext
> {
  return {
    schema: {
      name: 'user_activity',
      description: getDescription('user_activity'),
      parameters: z.object({
        start_time: z
          .string()
          .describe('Start of the time range as an ISO 8601 timestamp (e.g. "2025-04-01T00:00:00.000Z")'),
        end_time: z
          .string()
          .describe('End of the time range as an ISO 8601 timestamp (e.g. "2025-04-13T23:59:59.999Z")'),
      }),
    },
    execute: async (args, context) => {
      const userId = context.userId;

      try {
        const startTime = new Date(args.start_time);
        const endTime = new Date(args.end_time);

        // Validate dates are parseable
        if (isNaN(startTime.getTime()) || isNaN(endTime.getTime())) {
          return 'Invalid date format. Please provide valid ISO 8601 timestamps (e.g., "2025-04-01T00:00:00.000Z").';
        }

        if (startTime > endTime) {
          return 'Invalid time range: start_time must be before end_time.';
        }

        const THREE_DAYS_MS = 3 * 24 * 60 * 60 * 1000;
        if (endTime.getTime() - startTime.getTime() > THREE_DAYS_MS) {
          return 'The maximum time window for activity queries is 3 days. Please narrow your date range.';
        }

        const activities = await db.userActivityEvent.findMany({
          where: {
            userId,
            timestamp: {
              gte: startTime,
              lte: endTime,
            },
          },
          orderBy: { timestamp: 'desc' },
          take: 1000, // Limit results to prevent memory exhaustion
        });

        if (activities.length === 0) {
          return `No activity found for the specified time range.`;
        }

        const resolved = await Promise.all(activities.map(a => userActivityService.resolveActivity(a)));

        return JSON.stringify(
          resolved.map(a => ({ ...a, timestamp: toIST(a.timestamp) })),
          null,
          2,
        );
      } catch (error) {
        logger.error('[Tool] user_activity error:', error);
        return 'An error occurred while fetching user activity. Please try again with a smaller time range.';
      }
    },
  };
}

export function getUserActivityTool() {
  return createUserActivityTool();
}
