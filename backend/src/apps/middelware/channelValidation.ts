import { Request, Response, NextFunction } from "express";
import { z } from "zod";
import { repositories } from "@/database/repositories";
import { logger } from "@/utils/logger";

const ChannelValidationSchema = z.object({
  channelId: z.string().min(1, 'Channel ID is required').trim().optional(),
  channelName: z.string().min(1, 'Channel name is required').trim().optional(),
  conversationId: z.string().min(1, 'Conversation ID is required').trim().optional(),
  userId: z.string().min(1, 'User ID is required').trim(),
}).refine(
  data => !!data.channelId || !!data.channelName || !!data.conversationId,
  { message: 'Either channelId, channelName, or conversationId is required', path: ['channelId'] }
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
  channelName: string | undefined,
  conversationId: string | undefined,
  userId: string,
  res: Response
): Promise<string | null> {
  let resolvedChannelId = channelId;

  // Resolve channelId from channelName if not provided
  if (!resolvedChannelId && channelName) {
    const channel = await repositories.channels.findByName(channelName);
    if (!channel) {
      logger.warn(`[CHANNEL-VALIDATION] Channel with name "${channelName}" not found`);
      sendError(res, 404, 'Not Found', 'Channel not found');
      return null;
    }
    resolvedChannelId = channel.id;
  }

  // Resolve channelId from conversationId if still not provided
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
 * Validate the app bot has access to every channel in the list (parallel lookups).
 */
export async function validateChannelIdsAccess(
  channelIds: string[],
  userId: string,
): Promise<{ ok: true } | { ok: false; status: number; error: string; message: string }> {
  const uniqueChannelIds = [...new Set(channelIds.map(id => id.trim()).filter(Boolean))];
  if (uniqueChannelIds.length === 0) {
    return {
      ok: false,
      status: 400,
      error: 'Bad Request',
      message: 'At least one channelId is required',
    };
  }

  const results = await Promise.all(
    uniqueChannelIds.map(async channelId => {
      const channel = await repositories.channels.findById(channelId);
      if (!channel) {
        logger.warn(`[CHANNEL-VALIDATION] Channel ${channelId} not found`);
        return {
          ok: false as const,
          status: 404,
          error: 'Not Found',
          message: `Channel ${channelId} not found`,
        };
      }

      const isParticipant = await repositories.channelParticipants.isParticipant(
        channelId,
        userId,
      );
      if (!isParticipant) {
        logger.warn(
          `[CHANNEL-VALIDATION] User ${userId} does not have access to channel ${channelId}`,
        );
        return {
          ok: false as const,
          status: 403,
          error: 'Forbidden',
          message: `Bot does not have channel access to ${channelId}`,
        };
      }

      return { ok: true as const };
    }),
  );

  const failed = results.find(result => !result.ok);
  if (failed && !failed.ok) {
    return failed;
  }

  return { ok: true };
}

/**
 * Middleware to validate channel access for GET requests
 * Reads channelId and conversationId from query params, userId from the
 * authenticated app user (req.user, set by authenticateApp)
 */
export async function validateChannelAccessForGet(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const channelId = req.query.channelId as string | undefined;
    const channelName = req.query.channelName as string | undefined;
    const conversationId = req.query.conversationId as string | undefined;
    const userId = req.user?.id;

    const validationResult = ChannelValidationSchema.safeParse({
      channelId,
      channelName,
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
      validated.channelName,
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
 * Reads channelId and conversationId from body, userId from the
 * authenticated app user (req.user, set by authenticateApp)
 */
export async function validateChannelAccessForPost(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const channelId = req.body.channelId;
    const channelName = req.body.channelName;
    const conversationId = req.body.conversationId;
    const userId = req.user?.id;

    const validationResult = ChannelValidationSchema.safeParse({
      channelId,
      channelName,
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
      validated.channelName,
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