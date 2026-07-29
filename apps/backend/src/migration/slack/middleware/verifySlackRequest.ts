/**
 * Slack Request Verification Middleware
 * Verifies that requests are genuinely from Slack using signature verification
 * Required for production security
 */

import { Request, Response, NextFunction } from 'express';
import crypto from 'crypto';
import { logger } from '../../../utils/logger';
import { getBotConfigByTeamId } from '../slackMigrationBotConfig';

/**
 * Middleware to verify Slack request signatures
 * Prevents unauthorized access and replay attacks
 */
export function verifySlackRequest(req: Request, res: Response, next: NextFunction) {
  try {
    const slackSignature = req.headers['x-slack-signature'] as string;
    const timestamp = req.headers['x-slack-request-timestamp'] as string;

    // For slash commands: team_id is a top-level field in req.body
    // For interactive payloads: team_id is nested inside req.body.payload (a JSON string) as payload.team.id
    let teamId = req.body?.team_id as string | undefined;
    if (!teamId && req.body?.payload) {
      const rawPayload = typeof req.body.payload === 'string' ? req.body.payload : JSON.stringify(req.body.payload);
      let payload: Record<string, unknown>;
      try {
        payload = JSON.parse(rawPayload);
      } catch (err) {
        logger.error('[Slack Verification] Failed to parse interactive payload', {
          error: err,
          payloadPreview: rawPayload.slice(0, 100),
        });
        return res.status(400).send('Invalid payload format');
      }
      teamId = (payload?.team as Record<string, unknown>)?.id as string | undefined ?? payload?.team_id as string | undefined;
    }
    logger.info('[Slack Verification] Incoming request team_id', { team_id: teamId });

    // Resolve the signing secret for this specific team
    const signingSecret = teamId ? getBotConfigByTeamId(teamId).slackSigningSecret : '';
    if (!signingSecret) {
      logger.error('[Slack Verification] No signing secret found for team', { team_id: teamId });
      return res.status(500).json({
        response_type: 'ephemeral',
        text: 'Slack verification is not configured.',
      });
    }

    // Check if required headers are present
    if (!slackSignature || !timestamp) {
      logger.warn('[Slack Verification] Missing signature or timestamp headers');
      return res.status(400).send('Missing required headers');
    }

    // Prevent replay attacks - reject requests older than 5 minutes
    const currentTime = Math.floor(Date.now() / 1000);
    const requestTime = parseInt(timestamp, 10);

    if (Math.abs(currentTime - requestTime) > 300) {
      logger.warn('[Slack Verification] Request timestamp too old', {
        currentTime,
        requestTime,
        diff: currentTime - requestTime,
      });
      return res.status(400).send('Request timestamp is too old');
    }

    // Get the raw body for signature verification.
    // Prefer req.rawBody captured verbatim by the parser's verify callback
    // (set in migration/slack/index.ts). Falling back to reconstruction is
    // unreliable because URLSearchParams re-encoding can differ from what
    // Slack actually signed.
    let rawBody: string;

    if ((req as any).rawBody !== undefined) {
      // Exact bytes Slack signed
      rawBody = (req as any).rawBody;
    } else if (req.body && typeof req.body === 'object') {
      // For urlencoded data (command endpoint)
      if (req.headers['content-type']?.includes('application/x-www-form-urlencoded')) {
        // Reconstruct the raw body from parsed form data
        rawBody = new URLSearchParams(req.body).toString();
      }
      // For form-data with payload (interactive endpoint)
      else if (req.body.payload) {
        rawBody = `payload=${encodeURIComponent(
          typeof req.body.payload === 'string' ? req.body.payload : JSON.stringify(req.body.payload)
        )}`;
      }
      // Fallback
      else {
        rawBody = JSON.stringify(req.body);
      }
    } else {
      rawBody = req.body || '';
    }

    // Create signature base string
    const sigBasestring = `v0:${timestamp}:${rawBody}`;

    // Try each configured signing secret (supports multi-workspace setups)
    const expected = 'v0=' + crypto.createHmac('sha256', signingSecret).update(sigBasestring, 'utf8').digest('hex');
    const expectedBuf = Buffer.from(expected, 'utf8');
    const receivedBuf = Buffer.from(slackSignature, 'utf8');
    const isValid = expectedBuf.length === receivedBuf.length && crypto.timingSafeEqual(expectedBuf, receivedBuf);

    if (!isValid) {
      logger.warn('[Slack Verification] Invalid signature for team', {
        received: slackSignature,
        team_id: teamId,
      });
      return res.status(401).send('Invalid signature');
    }

    // Signature is valid, proceed to next middleware
    logger.debug('[Slack Verification] Request verified successfully');
    return next();
  } catch (error) {
    logger.error('[Slack Verification] Error during verification', {
      error: error instanceof Error ? error.message : 'Unknown error',
      stack: error instanceof Error ? error.stack : undefined,
    });
    return res.status(500).send('Verification error');
  }
}
