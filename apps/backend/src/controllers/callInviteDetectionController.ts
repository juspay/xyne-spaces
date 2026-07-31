import type { Request, Response } from 'express';
import { config } from '@/config/env';
import { repositories } from '@/database/repositories';
import { InternalCallInviteDetectionService } from '@/services/internalCallInviteDetectionService';
import {
  getCallInviteDetectionExternalReasons,
  getCallInviteDetectionLatency,
  getCallInviteDetectionRefreshes,
  getCallInviteDetectionResults,
} from '@/services/otel/callMetrics';
import { targetWorkspaceSessionService } from '@/services/targetWorkspaceSessionService';
import { buildInternalCallUrl } from '@/utils/urlUtils';
import { logger } from '@/utils/logger';

const isProduction = process.env.NODE_ENV === 'production';
const detectionService = new InternalCallInviteDetectionService(
  repositories.calls,
  targetWorkspaceSessionService
);

function getCookieString(req: Request, name: string): string | undefined {
  const value = req.cookies?.[name] as unknown;
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

/**
 * Public, privacy-neutral routing decision for the unified invite link. All
 * expected misses deliberately collapse to 200 { result: 'external' }.
 */
export async function detectInternalCallInvite(req: Request, res: Response): Promise<void> {
  const startedAt = Date.now();
  res.set('Cache-Control', 'no-store');

  try {
    const outcome = await detectionService.detect({
      externalId: req.params.externalId,
      cookies: req.cookies as Record<string, unknown> | undefined,
      sessionId: getCookieString(req, 'user_session_id'),
    });

    getCallInviteDetectionResults().add(1, { result: outcome.result });
    if (outcome.result === 'external') {
      getCallInviteDetectionExternalReasons().add(1, { reason: outcome.reason });
    }
    if (outcome.refresh !== 'not_attempted') {
      getCallInviteDetectionRefreshes().add(1, { status: outcome.refresh });
    }

    logger.info('[call-lobby] unified invite detection completed', {
      detect_internal_result: outcome.result,
      ...(outcome.result === 'external' ? { detect_internal_external_reason: outcome.reason } : {}),
      refresh: outcome.refresh,
      latencyMs: Date.now() - startedAt,
    });

    if (outcome.result === 'external') {
      res.status(200).json({ result: 'external' });
      return;
    }

    if (outcome.refreshedToken) {
      res.cookie(`xyne_ws_${outcome.workspaceId}_token`, outcome.refreshedToken, {
        httpOnly: true,
        secure: isProduction,
        sameSite: 'strict',
        path: '/',
        maxAge: config.jwt.expirationSeconds * 1000,
      });
    }

    res.status(200).json({
      result: 'internal',
      workspaceId: outcome.workspaceId,
      redirectUrl: buildInternalCallUrl(outcome.externalId, outcome.callType),
    });
  } catch (error) {
    logger.error('[call-lobby] unified invite detection failed unexpectedly', { error });
    res.status(500).json({ error: 'Internal server error' });
  } finally {
    getCallInviteDetectionLatency().record(Date.now() - startedAt);
  }
}
