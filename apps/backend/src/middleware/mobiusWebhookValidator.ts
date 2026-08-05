import { Request, Response, NextFunction } from 'express';
import crypto from 'crypto';
import { logger } from '../utils/logger';
import { config } from '@/config/env';

// Verifies inbound Mobius webhooks: constant-time x-api-key check against
// MOBIUS_WEBHOOK_API_KEY, then parses the raw Buffer body into JSON.
class MobiusWebhookMiddleware {
  private readonly webhookApiKey: string;
  private readonly webhookApiKeyConfigured: boolean;

  constructor() {
    this.webhookApiKey = config.mobius.webhookApiKey || '';
    this.webhookApiKeyConfigured = this.webhookApiKey.trim().length > 0;

    if (!this.webhookApiKeyConfigured) {
      logger.warn('MOBIUS_WEBHOOK_API_KEY is not configured, Mobius webhook updates will be rejected');
    }
  }

  verify = (req: Request, res: Response, next: NextFunction): void => {
    try {
      if (!this.webhookApiKeyConfigured) {
        logger.error('[Mobius-Webhook-Validator] Rejecting webhook because MOBIUS_WEBHOOK_API_KEY is empty');
        res.status(503).json({
          error: 'Service Unavailable',
          message: 'Webhook API key is not configured',
        });
        return;
      }

      const apiKey = req.headers['x-api-key'];
      logger.debug('[Mobius-Webhook-Validator] Mobius webhook received');
      if (!apiKey || typeof apiKey !== 'string') {
        logger.warn('Missing Mobius webhook API key');
        res.status(401).json({
          error: 'Unauthorized',
          message: 'Missing webhook API key',
        });
        return;
      }

      const providedBuffer = Buffer.from(apiKey);
      const expectedBuffer = Buffer.from(this.webhookApiKey);
      if (
        providedBuffer.length !== expectedBuffer.length ||
        !crypto.timingSafeEqual(providedBuffer, expectedBuffer)
      ) {
        logger.warn('Invalid Mobius webhook API key');
        res.status(401).json({
          error: 'Unauthorized',
          message: 'Invalid webhook API key',
        });
        return;
      }

      if (Buffer.isBuffer(req.body)) {
        try {
          req.body = JSON.parse(req.body.toString('utf8'));
        } catch (parseError) {
          logger.error('Failed to parse Mobius webhook JSON', parseError);
          res.status(400).json({
            error: 'Bad Request',
            message: 'Invalid JSON payload',
          });
          return;
        }
      }

      next();
    } catch (error) {
      logger.error('Mobius webhook verification failed', error);
      res.status(401).json({
        error: 'Unauthorized',
        message: 'Webhook verification failed',
      });
      return;
    }
  };
}

export const mobiusWebhookMiddleware = new MobiusWebhookMiddleware();
