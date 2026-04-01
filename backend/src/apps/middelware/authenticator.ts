import { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { logger } from '@/utils/logger';
import { decrypt } from '@/services/encryptionService';
import { repositories } from '@/database/repositories';
import jwt from 'jsonwebtoken';


const TokenPayloadSchema = z.object({
    appId: z.string().min(1, 'appId is required').trim(),
    userId: z.string().min(1, 'userId is required').trim(),
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
 * Middleware to authenticate external app requests using JWT token from Authorization header
 */
export async function authenticateApp(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    // 1. Extract JWT token from Authorization header
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      logger.error('[APP-AUTH] Authorization header is missing or does not start with Bearer');
      sendError(res, 401, 'Unauthorized', 'JWT token is required in Authorization header (Bearer token)');
      return;
    }

    const jwtToken = authHeader.substring(7); // Remove 'Bearer ' prefix
    if (!jwtToken || jwtToken.trim().length === 0) {
      logger.error('[APP-AUTH] JWT token is missing after Bearer prefix');
      sendError(res, 401, 'Unauthorized', 'JWT token is required in Authorization header');
      return;
    }

    // 2. Decode and validate JWT token payload with Zod
    const decoded = jwt.decode(jwtToken);
    const tokenResult = TokenPayloadSchema.safeParse(decoded);
    if (!tokenResult.success) {
      logger.error(`[APP-AUTH] Token payload validation failed:`, tokenResult.error);
      sendError(res, 401, 'Unauthorized', `Invalid token payload`);
      return;
    }

    const { appId, userId } = tokenResult.data;

    // 4. Look up installedApp record using appId and userId
    const installedApp = await repositories.installedApps.findFirst({
      where: {
        appId,
        userId,
      },
    });

    if (!installedApp) {
      logger.error(`[APP-AUTH] No installed app found for appId: ${appId} and userId: ${userId}`);
      sendError(res, 401, 'Unauthorized', 'App installation not found');
      return;
    }

    // 5. Decrypt the signingSecret from the database
    const signingSecret = decrypt(installedApp.signingSecret);

    // 6. Verify the JWT token using the signingSecret
    const verified = jwt.verify(jwtToken, signingSecret);
    
    // Validate verified payload structure
    const verifiedResult = TokenPayloadSchema.safeParse(verified);
    if (!verifiedResult.success) {
      logger.error(`[APP-AUTH] Verified token payload validation failed:`, verifiedResult.error);
      sendError(res, 401, 'Unauthorized', `Invalid verified token payload`);
      return;
    }

    // Authentication successful - append userId and appId to request body
    req.body.userId = userId;
    req.body.appId = appId;

    next();
  } catch (error) {
    if (error instanceof jwt.JsonWebTokenError || error instanceof jwt.TokenExpiredError || error instanceof jwt.NotBeforeError) {
      logger.error(`[APP-AUTH] JWT verification failed:`, error);
      sendError(res, 401, 'Unauthorized', 'Invalid or expired token');
      return;
    }
    
    if (error instanceof Error) {
      const errorMessage = error.message.toLowerCase();
      if (errorMessage.includes('invalid encrypted data format') || 
          errorMessage.includes('invalid iv length') ||
          errorMessage.includes('bad decrypt')) {
        logger.error(`[APP-AUTH] Failed to decrypt signing secret:`, error);
        sendError(res, 401, 'Unauthorized', 'Token verification failed');
        return;
      }
    }
    
    // All other errors are unexpected
    logger.error('[APP-AUTH] Unexpected error in authentication middleware:', error);
    sendError(res, 500, 'Internal server error', 'Authentication failed');
  }
}
