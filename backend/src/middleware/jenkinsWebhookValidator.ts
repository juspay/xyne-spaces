import { Request, Response, NextFunction } from 'express';
import crypto from 'crypto';
import { logger } from '../utils/logger';
import { config } from '@/config/env';

class JenkinsWebhookMiddleware {
  private readonly webhookSecret: string;

  constructor() {
    if (!config.jenkins.webhookSecret) {
      logger.warn('JENKINS_WEBHOOK_SECRET is not configured, webhook updates will be rejected');
    }
    this.webhookSecret = config.jenkins.webhookSecret;
  }

  verify = (req: Request, res: Response, next: NextFunction): void => {
    try {
      const signature = req.headers['x-jenkins-signature'];
      logger.info('[Webhook-Validator] Jenkins webhook received');
      logger.info('[Webhook-Validator] Signature header:', signature);
      logger.info('[Webhook-Validator] Body type:', typeof req.body);
      logger.info('[Webhook-Validator] Body is Buffer:', req.body instanceof Buffer);
      if (req.body instanceof Buffer) {
        logger.info('[Webhook-Validator] Body length:', req.body.length);
        logger.info('[Webhook-Validator] Body preview:', req.body.toString('utf8').substring(0, 100));
      }

      if (!signature || typeof signature !== 'string') {
        logger.warn('Missing Jenkins webhook signature');
        res.status(401).json({
          error: 'Unauthorized',
          message: 'Missing webhook signature'
        });
        return;
      }

      // Handle both raw buffer and parsed JSON body
      let rawBody: Buffer;
      if (req.body instanceof Buffer) {
        rawBody = req.body;
      } else if (typeof req.body === 'object') {
        // Body was parsed by express.json(), stringify it
        rawBody = Buffer.from(JSON.stringify(req.body));
      } else {
        logger.error('Webhook payload is not valid');
        res.status(400).json({
          error: 'Bad Request',
          message: 'Invalid webhook payload'
        });
        return;
      }

      const expectedSignature = crypto
        .createHmac('sha256', this.webhookSecret)
        .update(rawBody)
        .digest('hex');

      if (!crypto.timingSafeEqual(
        Buffer.from(signature),
        Buffer.from(expectedSignature)
      )) {
        logger.warn('Invalid Jenkins webhook signature');
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
      logger.error('Jenkins webhook verification failed', error);
      res.status(401).json({
        error: 'Unauthorized',
        message: 'Webhook verification failed'
      });
      return;
    }
  };
}

export const jenkinsWebhookMiddleware = new JenkinsWebhookMiddleware();