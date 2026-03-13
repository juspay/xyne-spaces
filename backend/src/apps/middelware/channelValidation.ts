import { Request, Response, NextFunction } from "express";
import { z } from "zod";
import { repositories } from "@/database/repositories";
import { logger } from "@/utils/logger";


const ChannelValidationSchema = z.object({
  channelId: z.string().min(1, 'Channel ID is required').trim(),
  userId: z.string().min(1, 'User ID is required').trim(),
});
/**
 * Helper function to send error response
 */
function sendError(res: Response, status: number, error: string, message: string): void {
    res.status(status).json({
      error,
      message,
    });
  }
  
  /**
   * Middleware to validate channel access for external app requests
   * Validates channelId is present and checks if userId is a participant in the channel
   */
  export async function validateChannelAccess(
    req: Request,  
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      // Validate request body with Zod
      const bodyResult = ChannelValidationSchema.safeParse(req.body);
      
      if (!bodyResult.success) {
        sendError(res, 400, 'Bad Request', `Validation error`);
        return;
      }

      const { channelId, userId } = bodyResult.data;

      const channel = await repositories.channels.findById(channelId);
      if (!channel) {
        logger.warn(`[CHANNEL-VALIDATION] Channel ${channelId} not found`);
        sendError(res, 404, 'Not Found', 'Channel not found');
        return;
      }
  
      const isParticipant = await repositories.channelParticipants.isParticipant(
        channelId,
        userId
      );
  
      if (!isParticipant) {
        logger.warn(`[CHANNEL-VALIDATION] User ${userId} does not have access to channel ${channelId}`);
        sendError(res, 403, 'Forbidden', 'Bot does not have channel access');
        return;
      }
      next();
    } catch (error) {
      logger.error('[CHANNEL-VALIDATION] Unexpected error in channel validation middleware:', error);
      sendError(res, 500, 'Internal Server Error', 'Failed to validate channel access');
    }
  }