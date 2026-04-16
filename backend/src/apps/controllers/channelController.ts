import { Request, Response } from 'express';
import { z } from 'zod';
import { repositories } from '@/database/repositories';
import { logger } from '@/utils/logger';
import { ChannelsResponse, ChannelListItem, ChannelListResponse } from '../types';

const GetChannelInfoBodySchema = z.object({
  channelId: z.string().min(1, 'Channel ID is required').trim().optional(),
  channelName: z.string().min(1, 'Channel name is required').trim().optional(),
}).refine(
  data => !!data.channelId || !!data.channelName,
  { message: 'Either channelId or channelName is required' }
);

const ListChannelsQuerySchema = z.object({
  limit: z.string().optional().transform(val => val ? parseInt(val, 10) : 100),
  cursor: z.string().optional(),
  projectId: z.string().optional(),
  scopeType: z.string().optional(),
});

export class ChannelController {
  /**
   * Get channel info
   * POST /api/apps/channel/info
   */
  getChannelByName = async (req: Request, res: Response): Promise<void> => {
    try {
      // Validate request body with Zod
      const bodyResult = GetChannelInfoBodySchema.safeParse(req.body);
      
      if (!bodyResult.success) {
        res.status(400).json({ 
          error: 'Validation error',
          code: 'VALIDATION_ERROR',
          details: bodyResult.error.errors
        });
        return;
      }

      const { channelId, channelName } = bodyResult.data;

      // Find channel by ID or name
      const channel = channelId
        ? await repositories.channels.findById(channelId)
        : await repositories.channels.findByName(channelName!);

      if (!channel) {
        res.status(404).json({ 
          error: 'Channel not found',
          code: 'CHANNEL_NOT_FOUND'
        });
        return;
      }

      const responseData: ChannelsResponse = {
        id: channel.id,
        name: channel.name,
        description: channel.description || undefined,
        type: channel.type,
        scopeType: channel.scopeType,
        visibility: channel.visibility,
        projectId: channel.projectId,
        createdBy: channel.createdBy,
        createdAt: channel.createdAt,
        participantCount: channel.participantCount,
      }

      // Return channel data
      res.json(responseData);
    } catch (error) {
      logger.error('[CHANNEL-CONTROLLER] Error getting channel by name:', error);
      res.status(500).json({ 
        error: 'Internal server error',
        code: 'INTERNAL_ERROR'
      });
    }
  };

  /**
   * List channels with cursor-based pagination
   * GET /api/apps/channel/list?limit=100&cursor=xxx&projectId=xxx&scopeType=xxx
   */
  listChannels = async (req: Request, res: Response): Promise<void> => {
    try {
      const queryResult = ListChannelsQuerySchema.safeParse(req.query);

      if (!queryResult.success) {
        res.status(400).json({
          error: 'Validation error',
          code: 'VALIDATION_ERROR',
          details: queryResult.error.errors,
        });
        return;
      }

      const { limit, cursor, projectId, scopeType } = queryResult.data;

      const where: Record<string, unknown> = {};
      if (projectId) where.projectId = projectId;
      if (scopeType) where.scopeType = scopeType;

      // Fetch one extra to determine hasMore
      const channels = await repositories.channels.findManyPaginated({
        where,
        limit: limit + 1,
        cursor,
      });

      const hasMore = channels.length > limit;
      const items = hasMore ? channels.slice(0, limit) : channels;
      const nextCursor = hasMore ? items[items.length - 1].id : undefined;

      const responseItems: ChannelListItem[] = items.map(channel => ({
        id: channel.id,
        name: channel.name,
        description: channel.description || undefined,
        scopeType: channel.scopeType,
        projectId: channel.projectId,
        createdBy: channel.createdBy,
        createdAt: channel.createdAt,
      }));

      const response: ChannelListResponse = {
        items: responseItems,
        hasMore,
        nextCursor,
      };

      res.status(200).json(response);
    } catch (error) {
      logger.error('[CHANNEL-CONTROLLER] Error listing channels:', error);
      res.status(500).json({
        error: 'Internal server error',
        code: 'INTERNAL_ERROR',
      });
    }
  };
}
