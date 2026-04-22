/**
 * External Source Sync Routes
 * Public endpoints for syncing data from external sources
 */

import express, { Router, Request, Response } from 'express';
import { authenticate } from '../core/authenticate';
import { adapterResolver } from '../middleware/adapterResolver';
import { externalSourceCore } from '../core/core';
import { adapterRegistry } from '../core/adapterRegistry';
import { logger } from '../../utils/logger';
import { RawBodyRequest } from '@/types/express';
import { webhookLimiter } from '@/middleware/rateLimiters';
import { authMiddleware } from '@/middleware/auth';
import { ExternalSourceRepository } from '@/database/repositories/externalSourceRepository';

const router = Router();

router.use(
  express.json({
    limit: '5mb',
    verify: (req: RawBodyRequest, _res, buf) => {
      req.rawBody = buf.toString('utf8');
    },
  })
);
router.use(express.urlencoded({ extended: true, limit: '50mb' }));
router.use(webhookLimiter);

/**
 * GET endpoint for webhook verification
 * GET /api/external-source-sync/:sourceName/ingest
 *
 * Returns "OK" without authentication - used by external services to verify endpoint
 * Matches Haskell implementation: webhookGetHandler _ _ = pure "OK"
 */
router.get('/:sourceName/ingest', (_req, res: Response) => {
  return res.status(200).send('OK');
});

/**
 * External source sync endpoint
 * POST /api/external-source-sync/:sourceName/ingest
 *
 * Flow:
 * 1. adapterResolver - Resolve adapter from sourceName
 * 2. authenticate - Authenticate using adapter.authenticate()
 * 3. handler - Orchestrate preprocess → transform → sync
 *
 * Note: express.json() with verify callback is applied at app level
 * This provides both req.body (parsed) and req.rawBody (raw string)
 */
router.post(
  '/:sourceName/ingest',
  adapterResolver, // Resolve adapter, attach to req
  authenticate, // Authenticate using req.adapter
  async (req, res: Response) => {
    const startTime = Date.now();

    try {
      // Type assertion - rawBody is added by express.json() verify callback in app.ts
      const rawBodyReq = req as RawBodyRequest;
      const { sourceName, adapter, source } = rawBodyReq;

      if (!adapter || !sourceName) {
        return res.status(500).json({
          error: 'Adapter or sourceName missing',
        });
      }

      logger.info(`Data received from ${sourceName}`, {
        adapter: adapter.name,
      });

      // Execute core ingestion: preprocess → transform → sync
      const result = await externalSourceCore.ingest(adapter, sourceName, req.body, source);

      const duration = Date.now() - startTime;
      logger.info(`Data processed in ${duration}ms`, {
        sourceName,
        action: result.action,
        conversationId: result.conversationId,
        entityId: result.entityId,
      });

      return res.status(200).json(result);
    } catch (error) {
      const duration = Date.now() - startTime;
      logger.error('Sync error:', {
        error: error instanceof Error ? error.message : 'Unknown error',
        stack: error instanceof Error ? error.stack : undefined,
        duration,
      });

      return res.status(500).json({
        error: 'Internal server error',
        message: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }
);

/**
 * Manual refetch for the external source bound to a channel.
 * POST /api/external-source-sync/:channelId/refetch
 */
router.post(
  '/:channelId/refetch',
  authMiddleware.authenticate,
  async (req: Request, res: Response) => {
    const { channelId } = req.params;
    try {
      const source = await new ExternalSourceRepository().findByChannelId(channelId);
      if (!source || !source.isActive) {
        return res.status(404).json({ success: false, error: 'No active external source for this channel' });
      }

      const adapter = adapterRegistry.getAdapter(source.name);
      if (!adapter.refetch) {
        return res.status(400).json({ success: false, error: `Refetch not supported for ${source.sourceType}` });
      }

      const result = await adapter.refetch(source);
      return res.json({ success: true, ...result });
    } catch (error) {
      const raw = error instanceof Error ? error.message : String(error);
      const needsReauth = /invalid_grant|unauthorized_client|invalid_token/i.test(raw);
      const status = needsReauth ? 403 : 500;
      logger.error('Refetch failed', { error: raw });
      return res.status(status).json({
        success: false,
        error: needsReauth
          ? 'Account requires re-authorization. Please reconnect the source.'
          : raw,
        ...(needsReauth && { needsReauth: true }),
      });
    }
  },
);

export default router;
