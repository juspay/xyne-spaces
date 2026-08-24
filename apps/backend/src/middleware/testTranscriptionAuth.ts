import { timingSafeEqual } from 'crypto';
import type { NextFunction, Request, Response } from 'express';
import { config } from '@/config/env';
import { logger } from '@/utils/logger';

function secretKeysMatch(suppliedKey: string, configuredKey: string): boolean {
  const supplied = Buffer.from(suppliedKey, 'utf8');
  const configured = Buffer.from(configuredKey, 'utf8');
  return supplied.length === configured.length && timingSafeEqual(supplied, configured);
}

export function authorizeTestTranscription(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  const user = req.user;
  if (!user?.id) {
    logger.warn('[TestTranscription] Unauthorized request received', {
      callId: req.params.callId,
    });
    res.status(401).json({ success: false, error: 'Unauthorized' });
    return;
  }

  const requestedAgentName = typeof req.body?.agentName === 'string'
    ? req.body.agentName.trim().slice(0, 128)
    : null;
  const auditContext = {
    userId: user.id,
    userEmail: user.email,
    userName: user.displayName || user.name,
    workspaceId: user.workspaceId,
    callId: req.params.callId,
    requestedAgentName,
  };

  logger.info('[TestTranscription] Authorization requested', auditContext);

  // callRoutes is also mounted at /api/calls/claw with user-or-app auth. This
  // control-plane endpoint must only be reachable through the regular Spaces
  // user-authenticated /api/calls mount, never through an app token.
  if (req.baseUrl === '/api/calls/claw') {
    logger.warn('[TestTranscription] Authorization denied', {
      ...auditContext,
      reason: 'app_auth_route_not_allowed',
    });
    res.status(403).json({ success: false, error: 'Test transcription is not authorized' });
    return;
  }

  const { allowedUserIds, secretKey } = config.testTranscription;
  if (allowedUserIds.length === 0 || !secretKey) {
    logger.error('[TestTranscription] Server authorization is not configured', {
      ...auditContext,
    });
    res.status(503).json({ success: false, error: 'Test transcription is not configured' });
    return;
  }

  if (!allowedUserIds.includes(user.id)) {
    logger.warn('[TestTranscription] Authorization denied', {
      ...auditContext,
      reason: 'user_not_allowlisted',
    });
    res.status(403).json({ success: false, error: 'Test transcription is not authorized' });
    return;
  }

  const suppliedKey = req.get('x-test-transcription-key');
  if (!suppliedKey || !secretKeysMatch(suppliedKey, secretKey)) {
    logger.warn('[TestTranscription] Authorization denied', {
      ...auditContext,
      reason: 'invalid_secret_key',
    });
    res.status(403).json({ success: false, error: 'Test transcription is not authorized' });
    return;
  }

  logger.info('[TestTranscription] Authorization granted', {
    ...auditContext,
  });
  next();
}
