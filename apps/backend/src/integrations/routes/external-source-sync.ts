/**
 * External Source Sync Routes
 * Public endpoints for syncing data from external sources
 */

import express, { Router, Request, Response } from 'express';
import crypto from 'crypto';
import { DeskType, isDeskChannelType } from '@xyne/shared';
import { WORKSPACE_LEVEL } from '@/integrations/core/sourceScope';
import { extractEmailAddress } from '@/utils/email';
import { MAILBOX_SOURCE_TYPES } from '@/database/repositories/externalSourceRepository';
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
import { resolveAppDeskInstalledAppId } from '@/integrations/core/deskSources';

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
 * Sources bound to a channel, for the dashboard fetch UI.
 * GET /api/external-source-sync/:channelId/sources
 */
router.get(
  '/:channelId/sources',
  authMiddleware.authenticate,
  async (req: Request, res: Response) => {
    const { channelId } = req.params;
    try {
      const userId = req.user?.id;
      const workspaceId = req.user?.workspaceId;
      if (!userId || !workspaceId) {
        return res.status(401).json({ success: false, error: 'Unauthenticated' });
      }

      const channel = await db.channel.findUnique({
        where: { id: channelId },
        select: { workspaceId: true, type: true },
      });
      if (!channel || channel.workspaceId !== workspaceId) {
        return res.status(404).json({ success: false, error: 'Channel not found' });
      }
      if (!isDeskChannelType(channel.type)) {
        return res.status(400).json({ success: false, error: 'Channel is not a desk channel' });
      }

      const repo = new ExternalSourceRepository();
      // Email first, then apps oldest-first; both active-only.
      const [emailSources, appSources] = await Promise.all([
        repo.listChannelEmailSources(channelId, { activeOnly: true }),
        repo.listChannelAppSources(channelId, { activeOnly: true }),
      ]);

      const installedAppIds = appSources
        .map(resolveAppDeskInstalledAppId)
        .filter((id): id is string => !!id);
      const installs = installedAppIds.length
        ? await db.installedApps.findMany({
            where: { id: { in: installedAppIds } },
            select: { id: true, app: { select: { name: true } } },
          })
        : [];
      const appNameByInstallId = new Map(installs.map(i => [i.id, i.app.name] as const));

      const appRows = appSources.map(source => {
        const installedAppId = resolveAppDeskInstalledAppId(source);
        return {
          sourceId: source.id,
          sourceType: 'app-desk' as const,
          displayName:
            (installedAppId && appNameByInstallId.get(installedAppId)) ??
            installedAppId ??
            source.displayName,
          ...(installedAppId && { installedAppId }),
          isActive: source.isActive,
        };
      });
      const emailRows = emailSources.map(source => ({
        sourceId: source.id,
        sourceType: source.sourceType,
        displayName: extractEmailAddress(source.displayName) ?? source.displayName,
        isActive: source.isActive,
      }));

      return res.status(200).json({ sources: [...emailRows, ...appRows] });
    } catch (error) {
      logger.error('List channel sources failed', {
        channelId,
        error: error instanceof Error ? error.message : String(error),
      });
      return res.status(500).json({ success: false, error: 'Internal server error' });
    }
  },
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
      const { startDate, endDate, sourceId: requestedSourceId } = (req.body ?? {}) as {
        startDate?: unknown;
        endDate?: unknown;
        sourceId?: unknown;
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
      if (requestedSourceId !== undefined && typeof requestedSourceId !== 'string') {
        return res.status(400).json({ success: false, error: 'sourceId must be a string' });
      }

      // Identical in-flight refetches share a Bull jobId (sha1 of the window)
      // so Bull drops the duplicate add.
      const refetchJobIdFor = (sourceId: string) =>
        `refetch-${sourceId}-${crypto.createHash('sha1').update(`${startDate}|${endDate}`).digest('hex')}`;

      // Target resolution: either the explicitly requested source, or the
      // mailbox (with DL fallback) plus every active app binding on the desk.
      interface FetchTarget {
        source: import('@prisma/client').ExternalSource;
        installedAppId: string | null;
        jobData: {
          targetChannelId?: string;
          dlEmail?: string;
        };
      }
      const targets: FetchTarget[] = [];

      if (requestedSourceId) {
        const requested = await new ExternalSourceRepository().findById(requestedSourceId);
        if (!requested || requested.channelId !== channelId || !requested.isActive) {
          return res.status(404).json({ success: false, error: 'No active external source for this channel' });
        }
        targets.push({
          source: requested,
          installedAppId: resolveAppDeskInstalledAppId(requested),
          jobData: {},
        });
      } else {
        const repo = new ExternalSourceRepository();
        let mailbox = await repo.findChannelSource(channelId, {
          sourceTypes: [...MAILBOX_SOURCE_TYPES],
        });
        let targetChannelId: string | undefined;
        let dlEmail: string | undefined;

        if (!mailbox || !mailbox.isActive) {
          const pref = await db.emailChannelPreference.findUnique({
            where: { channelId },
            select: { deskType: true, dlEmail: true, workspaceId: true },
          });
          if (pref?.deskType === DeskType.DL && pref.workspaceId && pref.dlEmail) {
            mailbox = await db.externalSource.findFirst({
              where: {
                workspaceId: pref.workspaceId,
                ...WORKSPACE_LEVEL,
                sourceType: { in: ['google', 'microsoft'] },
                isActive: true,
              },
            });
            if (mailbox?.isActive) {
              targetChannelId = channelId;
              dlEmail = pref.dlEmail;
            } else {
              mailbox = null;
            }
          }
        }

        if (mailbox) {
          targets.push({
            source: mailbox,
            installedAppId: null,
            jobData: {
              ...(targetChannelId && { targetChannelId }),
              ...(dlEmail && { dlEmail }),
            },
          });
        }
        for (const appSource of await repo.listChannelAppSources(channelId, { activeOnly: true })) {
          targets.push({
            source: appSource,
            installedAppId: resolveAppDeskInstalledAppId(appSource),
            jobData: {},
          });
        }
      }

      if (targets.length === 0) {
        return res.status(404).json({ success: false, error: 'No active external source for this channel' });
      }

      for (const { source } of targets) {
        const adapter = adapterRegistry.getAdapter(source.sourceType);
        if (!adapter.refetch) {
          return res.status(400).json({ success: false, error: `Fetch not supported for ${source.sourceType}` });
        }
      }

      const requesterUserId = req.user?.id;
      if (!requesterUserId) {
        return res.status(401).json({ success: false, error: 'Unauthenticated' });
      }

      if (!appConfig.enableEmailFetchWorker) {
        // The app export is paginated over up to 500 sequential requests —
        // far beyond one HTTP response's lifetime, so it requires the worker.
        const mailboxTarget = targets.find(t => t.source.sourceType !== 'app-desk');
        if (!mailboxTarget) {
          return res.status(409).json({
            success: false,
            error: 'App desk history fetch requires ENABLE_EMAIL_FETCH_WORKER=true',
          });
        }
        if (mailboxTarget !== targets[0] || targets.length > 1) {
          logger.info('Worker disabled — skipping app targets, fetching mailbox inline', {
            channelId,
            skippedSources: targets.filter(t => t !== mailboxTarget).map(t => t.source.id),
          });
        }
        const adapter = adapterRegistry.getAdapter(mailboxTarget.source.sourceType);
        const result = await adapter.refetch!(mailboxTarget.source, {
          startDate,
          endDate,
          ...mailboxTarget.jobData,
        });
        return res.json({ success: true, ...result });
      }

      if (!emailFetchQueue.isReady) {
        await emailFetchQueue.initialize();
      }
      // Fan-out over the concurrency-1 'refetch' processor: history pulls are
      // human-triggered, and a second queue buys a new failure domain for no
      // real urgency win. removeOnComplete/removeOnFail keep the stable jobId
      // dead-letter key from wedging that source+range permanently.
      const jobs: Array<{ sourceId: string; installedAppId: string | null; jobId: string }> = [];
      for (const { source, installedAppId, jobData } of targets) {
        const job = await emailFetchQueue.getQueue().add(
          'refetch',
          {
            sourceId: source.id,
            channelId,
            requesterUserId,
            workspaceId: req.user!.workspaceId,
            startDate,
            endDate,
            ...jobData,
          },
          { jobId: refetchJobIdFor(source.id), removeOnComplete: true, removeOnFail: true },
        );
        logger.info('Fetch enqueued', { jobId: job.id, sourceId: source.id, channelId });
        jobs.push({ sourceId: source.id, installedAppId, jobId: String(job.id) });
      }
      return res.status(202).json({
        success: true,
        queued: true,
        jobs,
      });
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
