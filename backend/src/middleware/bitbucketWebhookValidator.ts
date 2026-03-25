import { Request, Response, NextFunction } from 'express';
import crypto from 'crypto';
import { logger } from '../utils/logger';
import { config } from '@/config/env';

class BitbucketWebhookMiddleware {
  private readonly webhookSecret: string;

  constructor() {
    if (!config.bitbucket.webhookSecret) {
      logger.warn('SCM_WEBHOOK_SECRET is not configured, webhook updates will be rejected');
    }
    this.webhookSecret = config.bitbucket.webhookSecret;
  }
  
  verify = (req: Request, res: Response, next: NextFunction): void => {
    try {
      const signature = req.headers['x-hub-signature'];
      logger.debug('[Webhook-Validator] Bitbucket webhook received');
      if (!signature || typeof signature !== 'string') {
        logger.warn('Missing Bitbucket webhook signature');
        res.status(401).json({
          error: 'Unauthorized',
          message: 'Missing webhook signature'
        });
        return;
      }

      if (!req.body || !(req.body instanceof Buffer)) {
        logger.error('Webhook payload is not a raw buffer');
        res.status(400).json({
          error: 'Bad Request',
          message: 'Invalid webhook payload'
        });
        return;
      }

      const expectedSignature =
        'sha256=' +
        crypto
          .createHmac('sha256', this.webhookSecret)
          .update(req.body)
          .digest('hex');

      if (!crypto.timingSafeEqual(
        Buffer.from(signature),
        Buffer.from(expectedSignature)
      )) {
        logger.warn('Invalid Bitbucket webhook signature');
        res.status(401).json({
          error: 'Unauthorized',
          message: 'Invalid webhook signature'
        });
        return;
      }
      try {
        req.body = JSON.parse(req.body.toString('utf8'));
      } catch (parseError) {
       logger.error('Failed to parse webhook JSON', parseError);
        res.status(400).json({
        error: 'Bad Request',
        message: 'Invalid JSON payload'
      });
      return;
    }

      next();
    } catch (error) {
      logger.error('Webhook verification failed', error);
      res.status(401).json({
        error: 'Unauthorized',
        message: 'Webhook verification failed'
      });
      return;
    }
  };
}

export const bitbucketWebhookMiddleware = new BitbucketWebhookMiddleware();
