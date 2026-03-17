import { Request, Response, NextFunction } from "express";
import { z } from "zod";
import { repositories } from "@/database/repositories";
import { logger } from "@/utils/logger";

const ChannelValidationSchema = z.object({
  channelId: z.string().min(1, 'Channel ID is required').trim().optional(),
  conversationId: z.string().min(1, 'Conversation ID is required').trim().optional(),
  userId: z.string().min(1, 'User ID is required').trim(),
}).refine(
  data => !!data.channelId || !!data.conversationId,
  { message: 'Either channelId or conversationId is required', path: ['channelId'] }
);

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
 * Helper function to resolve and validate channel access
 */
async function resolveAndValidateChannel(
  channelId: string | undefined,
  conversationId: string | undefined,
  userId: string,
  res: Response
): Promise<string | null> {
  let resolvedChannelId = channelId;

  // Resolve channelId from conversationId if not provided
  if (!resolvedChannelId && conversationId) {
    const conversation = await repositories.conversations.findById(conversationId);
    if (!conversation) {
      logger.warn(`[CHANNEL-VALIDATION] Conversation ${conversationId} not found`);
      sendError(res, 404, 'Not Found', 'Conversation not found');
      return null;
    }
    resolvedChannelId = conversation.channelId;
  }

  if (!resolvedChannelId) {
    logger.warn('[CHANNEL-VALIDATION] Unable to resolve channelId from request');
    sendError(res, 400, 'Bad Request', 'Channel ID is required');
    return null;
  }

  // Validate channel exists
  const channel = await repositories.channels.findById(resolvedChannelId);
  if (!channel) {
    logger.warn(`[CHANNEL-VALIDATION] Channel ${resolvedChannelId} not found`);
    sendError(res, 404, 'Not Found', 'Channel not found');
    return null;
  }

  // Validate user is a participant
  const isParticipant = await repositories.channelParticipants.isParticipant(
    resolvedChannelId,
    userId
  );

  if (!isParticipant) {
    logger.warn(`[CHANNEL-VALIDATION] User ${userId} does not have access to channel ${resolvedChannelId}`);
    sendError(res, 403, 'Forbidden', 'Bot does not have channel access');
    return null;
  }

  return resolvedChannelId;
}

/**
 * Middleware to validate channel access for GET requests
 * Reads channelId and conversationId from query params, userId from body
 */
export async function validateChannelAccessForGet(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const channelId = req.query.channelId as string | undefined;
    const conversationId = req.query.conversationId as string | undefined;
    const userId = req.body.userId;

    const validationResult = ChannelValidationSchema.safeParse({
      channelId,
      conversationId,
      userId,
    });

    if (!validationResult.success) {
      sendError(res, 400, 'Bad Request', 'Validation error');
      return;
    }

    const validated = validationResult.data;
    const resolvedChannelId = await resolveAndValidateChannel(
      validated.channelId,
      validated.conversationId,
      validated.userId,
      res
    );

    if (!resolvedChannelId) {
      return; // Error already sent
    }

    next();
  } catch (error) {
    logger.error('[CHANNEL-VALIDATION] Unexpected error in GET channel validation middleware:', error);
    sendError(res, 500, 'Internal Server Error', 'Failed to validate channel access');
  }
}

/**
 * Middleware to validate channel access for POST requests
 * Reads channelId, conversationId, and userId from body
 */
export async function validateChannelAccessForPost(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const channelId = req.body.channelId;
    const conversationId = req.body.conversationId;
    const userId = req.body.userId;

    const validationResult = ChannelValidationSchema.safeParse({
      channelId,
      conversationId,
      userId,
    });

    if (!validationResult.success) {
      sendError(res, 400, 'Bad Request', 'Validation error');
      return;
    }

    const validated = validationResult.data;
    const resolvedChannelId = await resolveAndValidateChannel(
      validated.channelId,
      validated.conversationId,
      validated.userId,
      res
    );

    if (!resolvedChannelId) {
      return; // Error already sent
    }

    next();
  } catch (error) {
    logger.error('[CHANNEL-VALIDATION] Unexpected error in POST channel validation middleware:', error);
    sendError(res, 500, 'Internal Server Error', 'Failed to validate channel access');
  }
}