/**
 * External Source Sync Routes
 * Public endpoints for syncing data from external sources
 */

import express, { Router, Request, Response } from 'express';
import { DeskType } from '@xyne/shared';
import { WORKSPACE_LEVEL } from '@/integrations/core/sourceScope';
import { authenticate } from '../core/authenticate';
import { adapterResolver } from '../middleware/adapterResolver';
import { externalSourceCore } from '../core/core';
import { adapterRegistry } from '../core/adapterRegistry';
import { logger } from '../../utils/logger';
import { RawBodyRequest } from '@/types/express';
import { webhookLimiter } from '@/middleware/rateLimiters';
import { authMiddleware } from '@/middleware/auth';
import { ExternalSourceRepository } from '@/database/repositories/externalSourceRepository';
import { emailFetchQueue } from '@/queues/emailFetchQueue';
import { config as appConfig } from '@/config/env';
import { db } from '@/database/client';
import { runAsServiceActor } from '@/database/tenant/context';

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

      // Execute core ingestion: preprocess → transform → sync.
      // Unauthenticated webhook → no HTTP tenant scope. Open one so ingested
      // emails/drafts/assignments get workspaceId stamped. ExternalSource.workspaceId is
      // NOT NULL, so a resolved source always carries its own tenant; we refuse only when
      // no source resolved at all, since there is nothing to scope the ingest to.
      const ingestWorkspaceId: string | null = source?.workspaceId ?? null;
      if (!ingestWorkspaceId) {
        logger.error('[External-Source] ingest with no resolvable workspaceId — refusing to ingest untenanted', {
          sourceName,
          sourceId: source?.id,
          channelId: source?.channelId,
        });
        throw new Error(`External source ingest: no resolvable workspaceId for source ${source?.id ?? sourceName}`);
      }
      const results = await runAsServiceActor('external-source-ingest', ingestWorkspaceId,
        () => externalSourceCore.ingest(adapter, sourceName, req.body, source),
      );

      const duration = Date.now() - startTime;
      logger.info(`Data processed in ${duration}ms`, {
        sourceName,
        resultCount: results.length,
        actions: results.map(r => r.action),
        conversationIds: results.map(r => r.conversationId),
      });

      return res.status(200).json(results);
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

const MAX_REFETCH_RANGE_MS = 365 * 24 * 60 * 60 * 1000;

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
      const { startDate, endDate } = (req.body ?? {}) as {
        startDate?: unknown;
        endDate?: unknown;
      };
      if (typeof startDate !== 'string' || typeof endDate !== 'string') {
        return res.status(400).json({
          success: false,
          error: 'startDate and endDate are required (ISO 8601 strings)',
        });
      }
      const startMs = Date.parse(startDate);
      const endMs = Date.parse(endDate);
      if (Number.isNaN(startMs) || Number.isNaN(endMs)) {
        return res.status(400).json({ success: false, error: 'Invalid ISO 8601 date' });
      }
      if (startMs > endMs) {
        return res.status(400).json({ success: false, error: 'startDate must be <= endDate' });
      }
      if (endMs - startMs > MAX_REFETCH_RANGE_MS) {
        return res.status(400).json({ success: false, error: 'Range exceeds 365 days' });
      }
      let source = await new ExternalSourceRepository().findByChannelId(channelId);
      let targetChannelId: string | undefined;
      let dlEmail: string | undefined;

      if (!source || !source.isActive) {
        const pref = await db.emailChannelPreference.findUnique({
          where: { channelId },
          select: { deskType: true, dlEmail: true, workspaceId: true },
        });
        if (pref?.deskType === DeskType.DL && pref.workspaceId && pref.dlEmail) {
          source = await db.externalSource.findFirst({ where: { workspaceId: pref.workspaceId, ...WORKSPACE_LEVEL, sourceType: { in: ['google', 'microsoft'] }, isActive: true } });
          if (source?.isActive) {
            targetChannelId = channelId;
            dlEmail = pref.dlEmail;
          } else {
            source = null;
          }
        }
      }

      if (!source) {
        return res.status(404).json({ success: false, error: 'No active external source for this channel' });
      }

      const adapter = adapterRegistry.getAdapter(source.name);
      if (!adapter.refetch) {
        return res.status(400).json({ success: false, error: `Fetch not supported for ${source.sourceType}` });
      }

      const requesterUserId = req.user?.id;
      if (!requesterUserId) {
        return res.status(401).json({ success: false, error: 'Unauthenticated' });
      }

      const options = {
        startDate,
        endDate,
        ...(targetChannelId && { targetChannelId }),
        ...(dlEmail && { dlEmail }),
      };

      if (appConfig.enableEmailFetchWorker) {
        if (!emailFetchQueue.isReady) {
          await emailFetchQueue.initialize();
        }
        const job = await emailFetchQueue.getQueue().add('refetch', {
          sourceId: source.id,
          channelId,
          requesterUserId,
          workspaceId: req.user!.workspaceId,
          startDate,
          endDate,
          ...(targetChannelId && { targetChannelId }),
          ...(dlEmail && { dlEmail }),
        });
        logger.info('Fetch enqueued', { jobId: job.id, sourceId: source.id, channelId, targetChannelId, dlEmail });
        return res.status(202).json({ success: true, queued: true, jobId: String(job.id) });
      }

      const result = await adapter.refetch(source, options);
      return res.json({ success: true, ...result });
    } catch (error) {
      const raw = error instanceof Error ? error.message : String(error);
      const needsReauth = /invalid_grant|unauthorized_client|invalid_token/i.test(raw);
      const status = needsReauth ? 403 : 500;
      logger.error('Fetch failed', { error: raw });
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
