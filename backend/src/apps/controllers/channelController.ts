import { Request, Response } from 'express';
import { z } from 'zod';
import { repositories } from '@/database/repositories';
import { logger } from '@/utils/logger';
import { ChannelsResponse } from '../types';

const GetChannelByNameBodySchema = z.object({
  channelId: z.string().min(1, 'Channel name is required').trim(),
});

export class ChannelController {
  /**
   * Get channel by name
   * POST /api/apps/channel/info
   */
  getChannelByName = async (req: Request, res: Response): Promise<void> => {
    try {
      // Validate request body with Zod
      const bodyResult = GetChannelByNameBodySchema.safeParse(req.body);
      
      if (!bodyResult.success) {
        res.status(400).json({ 
          error: 'Validation error',
          code: 'VALIDATION_ERROR',
          details: bodyResult.error.errors
        });
        return;
      }

      const { channelId } = bodyResult.data;

      // Find channel by ID
      const channel = await repositories.channels.findById(channelId);

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
}
