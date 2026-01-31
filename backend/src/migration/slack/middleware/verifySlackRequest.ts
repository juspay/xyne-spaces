/**
 * Slack Request Verification Middleware
 * Verifies that requests are genuinely from Slack using signature verification
 * Required for production security
 */

import { Request, Response, NextFunction } from 'express';
import crypto from 'crypto';
import { logger } from '../../../utils/logger';
import { config } from '../../../config/env';

/**
 * Middleware to verify Slack request signatures
 * Prevents unauthorized access and replay attacks
 */
export function verifySlackRequest(req: Request, res: Response, next: NextFunction) {
  try {
    const slackSignature = req.headers['x-slack-signature'] as string;
    const timestamp = req.headers['x-slack-request-timestamp'] as string;
    const signingSecret = config.slackSigningSecret;

    // Check if signing secret is configured
    if (!signingSecret) {
      logger.error('[Slack Verification] SLACK_SIGNING_SECRET is not configured');
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

    // Get the raw body for signature verification
    // Slack requires the raw body, not parsed JSON
    let rawBody: string;

    if (req.body && typeof req.body === 'object') {
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

    // Calculate expected signature
    const mySignature =
      'v0=' +
      crypto.createHmac('sha256', signingSecret).update(sigBasestring, 'utf8').digest('hex');

    // Use timing-safe comparison to prevent timing attacks
    const isValid = crypto.timingSafeEqual(
      Buffer.from(mySignature, 'utf8'),
      Buffer.from(slackSignature, 'utf8')
    );

    if (!isValid) {
      logger.warn('[Slack Verification] Invalid signature', {
        expected: mySignature,
        received: slackSignature,
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
