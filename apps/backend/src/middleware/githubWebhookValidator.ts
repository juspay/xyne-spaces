import { Request, Response, NextFunction } from 'express';
import crypto from 'crypto';
import { logger } from '../utils/logger';
import { config } from '@/config/env';

class GitHubWebhookMiddleware {
  private readonly webhookSecrets: string[];
  private readonly webhookSecretConfigured: boolean;

  constructor() {
    // Accept EITHER secret so two webhooks can share this one endpoint:
    //  - the dedicated GitHub App secret (GITHUB_APP_WEBHOOK_SECRET), and
    //  - the internal app's shared secret (SCM_WEBHOOK_SECRET) used today.
    const secrets = [
      config.github?.appWebhookSecret,
      config.github?.webhookSecret,
    ].filter((s): s is string => !!s && s.trim().length > 0);
    this.webhookSecrets = Array.from(new Set(secrets));
    this.webhookSecretConfigured = this.webhookSecrets.length > 0;

    if (!this.webhookSecretConfigured) {
      logger.warn(
        'No GitHub webhook secret configured (GITHUB_APP_WEBHOOK_SECRET / SCM_WEBHOOK_SECRET); GitHub webhook updates will be rejected'
      );
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

      // Passes if the signature matches ANY configured secret (App or internal).
      const rawBody = req.body;
      const signatureMatches = this.webhookSecrets.some((secret) => {
        const expected =
          'sha256=' +
          crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
        // timingSafeEqual throws on length mismatch — guard first.
        return (
          signature.length === expected.length &&
          crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))
        );
      });

      if (!signatureMatches) {
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
