import { Request, Response, NextFunction } from 'express';
import crypto from 'crypto';
import { logger } from '../utils/logger';
import { config } from '@/config/env';

class GitHubWebhookMiddleware {
  private readonly webhookSecret: string;
  private readonly webhookSecretConfigured: boolean;

  constructor() {
    this.webhookSecret = config.github?.webhookSecret || '';
    this.webhookSecretConfigured = this.webhookSecret.trim().length > 0;

    if (!this.webhookSecretConfigured) {
      logger.warn('SCM_WEBHOOK_SECRET is not configured, GitHub webhook updates will be rejected');
    }
  }

  verify = (req: Request, res: Response, next: NextFunction): void => {
    try {
      if (!this.webhookSecretConfigured) {
        logger.error('[GitHub-Webhook-Validator] Rejecting webhook because SCM_WEBHOOK_SECRET is empty');
        res.status(503).json({
          error: 'Service Unavailable',
          message: 'Webhook secret is not configured',
        });
        return;
      }

      const signature = req.headers['x-hub-signature-256'];
      logger.debug('[GitHub-Webhook-Validator] GitHub webhook received');

      if (!signature || typeof signature !== 'string') {
        logger.warn('[GitHub-Webhook-Validator] Missing X-Hub-Signature-256 header');
        res.status(401).json({
          error: 'Unauthorized',
          message: 'Missing webhook signature',
        });
        return;
      }

      if (!req.body || !(req.body instanceof Buffer)) {
        logger.error('[GitHub-Webhook-Validator] Webhook payload is not a raw buffer');
        res.status(400).json({
          error: 'Bad Request',
          message: 'Invalid webhook payload',
        });
        return;
      }

      const expectedSignature =
        'sha256=' +
        crypto
          .createHmac('sha256', this.webhookSecret)
          .update(req.body)
          .digest('hex');

      if (
        !crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expectedSignature))
      ) {
        logger.warn('[GitHub-Webhook-Validator] Invalid GitHub webhook signature');
        res.status(401).json({
          error: 'Unauthorized',
          message: 'Invalid webhook signature',
        });
        return;
      }

      try {
        req.body = JSON.parse(req.body.toString('utf8'));
      } catch (parseError) {
        logger.error('[GitHub-Webhook-Validator] Failed to parse webhook JSON', parseError);
        res.status(400).json({
          error: 'Bad Request',
          message: 'Invalid JSON payload',
        });
        return;
      }

      next();
    } catch (error) {
      logger.error('[GitHub-Webhook-Validator] Webhook verification failed', error);
      res.status(401).json({
        error: 'Unauthorized',
        message: 'Webhook verification failed',
      });
    }
  };
}

export const githubWebhookMiddleware = new GitHubWebhookMiddleware();
