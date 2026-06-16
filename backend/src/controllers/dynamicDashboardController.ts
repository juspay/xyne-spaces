import { Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { z } from 'zod';
import { DashboardRole, DashboardVisibility } from '@prisma/client';
import {
  DashboardAiCreateRequestSchema,
  QueryVisualizationType,
  type DashboardAiEvent,
} from '@xyne/shared';
import { config } from '@/config/env';
import { db } from '@/database/client';
import { logger } from '@/utils/logger';
import { AgentsConfig } from '@/agents/config';
import { dashboardAiStream } from '@/agents/dashboard-ai';
import {
  DataSourceService,
  DataSourceConnectionError,
  type CreateDataSourceInput,
  type SourceType,
} from '@/services/dynamicDashboard/dataSource/DataSourceService';
import { SsrfBlockedError } from '@/utils/ssrfGuard';
import {
  executeQueryPlan,
  QueryExecError,
} from '@/services/dynamicDashboard/queryEngine';

type DashboardAiSseEvent = DashboardAiEvent | { type: 'ping' };

const includedTableSchema = z.object({
  schemaName: z.string().min(1).max(255),
  tableName: z.string().min(1).max(255),
});

const createDataSourceBodySchema = z.object({
  name: z.string().min(1).max(120),
  description: z.string().max(500).optional(),
  sourceType: z.enum(['postgres', 'clickhouse']),
  connectionConfig: z.object({
    host: z.string().min(1).max(255),
    port: z.number().int().min(1).max(65535),
    user: z.string().min(1).max(255),
    password: z.string().min(1).max(1024),
    database: z.string().min(1).max(255),
    ssl: z.boolean().default(true),
  }),
  includedTables: z.array(includedTableSchema).max(2000).optional(),
});

const discoverTablesBodySchema = createDataSourceBodySchema.pick({
  sourceType: true,
  connectionConfig: true,
});

export class DynamicDashboardController {
  private readonly dataSourceService = new DataSourceService();

  aiCreate = async (req: Request, res: Response): Promise<void> => {
    const ctx = this.requireAuth(req, res);
    if (!ctx) return;
    const { userId, workspaceId } = ctx;

    const parsed = DashboardAiCreateRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        error: 'BadRequest',
        message: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '),
      });
      return;
    }
    const { prompt, dataSourceId, currentPlan, sessionId, lastError } = parsed.data;

    const dataSource = await this.dataSourceService.findWorkspace(dataSourceId, workspaceId);
    if (!dataSource) {
      res.status(404).json({ error: 'NotFound', message: 'Data source not found' });
      return;
    }

    if (!config.litellm.apiKey || !config.litellm.baseUrl) {
      res.status(503).json({
        error: 'ServiceUnavailable',
        message: 'AI dashboard composer is not configured on this deployment.',
      });
      return;
    }

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.setHeader('Content-Encoding', 'none');
    if (res.socket) res.socket.setNoDelay(true);
    res.flushHeaders();

    const flush = (): void => {
      if (typeof (res as unknown as { flush?: () => void }).flush === 'function') {
        (res as unknown as { flush: () => void }).flush();
      }
    };
    const send = (event: DashboardAiSseEvent): void => {
      if (res.writableEnded) return;
      res.write(`data: ${JSON.stringify(event)}\n\n`);
      flush();
    };

    const pingInterval = setInterval(() => {
      if (!res.writableEnded) {
        res.write(`data: ${JSON.stringify({ type: 'ping' })}\n\n`);
        flush();
      }
    }, config.dashboard.aiSsePingIntervalMs);

    const abort = new AbortController();
    const onClientClose = (): void => abort.abort(new Error('Client disconnected'));
    req.on('close', onClientClose);

    const resolvedSessionId = sessionId ?? uuidv4();
    send({ type: 'start', sessionId: resolvedSessionId });

    try {
      await dashboardAiStream({
        prompt,
        dataSourceId,
        workspaceId,
        currentPlan,
        lastError,
        sendEvent: send,
        abortSignal: abort.signal,
      });
      send({ type: 'end' });
    } catch (e) {
      const wasAbort = abort.signal.aborted;
      logger.error('[DashboardAI] stream error', {
        error: e instanceof Error ? e.message : String(e),
        dataSourceId,
        userId,
        workspaceId,
        wasAbort,
      });
      send({
        type: 'error',
        message: wasAbort
          ? (abort.signal.reason instanceof Error
              ? abort.signal.reason.message
              : 'Request aborted')
          : 'An error occurred while generating the dashboard. Please try again.',
        recoverable: !wasAbort,
      });
      send({ type: 'end' });
    } finally {
      clearInterval(pingInterval);
      req.off('close', onClientClose);
      if (!res.writableEnded) res.end();
    }
  };

  queryGetComponentData = async (req: Request, res: Response): Promise<void> => {
    const ctx = this.requireAuth(req, res);
    if (!ctx) return;
    const { userId, workspaceId } = ctx;

    const componentId = req.params['id'];
    if (!componentId) {
      res.status(400).json({ error: 'BadRequest', message: 'componentId is required' });
      return;
    }

    const component = await db.dynamicDashboardQuery.findUnique({ where: { id: componentId } });
    if (!component) {
      res.status(404).json({ error: 'NotFound', message: 'Component not found' });
      return;
    }

    const mapping = await db.dynamicDashboardQueryMapping.findFirst({ where: { queryId: componentId } });
    const dashboard = mapping
      ? await db.dynamicDashboard.findUnique({ where: { id: mapping.dashboardId } })
      : null;
    if (!dashboard || dashboard.workspaceId !== workspaceId) {
      if (!dashboard) {
        logger.warn('[DashboardQuery] orphan query (no dashboard mapping)', { componentId });
      }
      res.status(404).json({ error: 'NotFound', message: 'Component not found' });
      return;
    }

    if (!(await this.userCanReadDashboard(dashboard, userId))) {
      res.status(404).json({ error: 'NotFound', message: 'Component not found' });
      return;
    }

    const plan: unknown = component.queryJson;
    const componentType = (component.visualType ?? undefined) as QueryVisualizationType | undefined;
    const bypassCache =
      req.query['bypassCache'] === '1' || req.query['bypassCache'] === 'true';

    try {
      const result = await executeQueryPlan(plan, { workspaceId, componentType, bypassCache });
      res.json({
        componentId,
        visualType: component.visualType,
        data: result.data,
        rows: result.rows,
        rowCount: result.rowCount,
        executedAt: new Date().toISOString(),
      });
    } catch (e) {
      this.respondWithExecError(res, e);
    }
  };

  queryPreview = async (req: Request, res: Response): Promise<void> => {
    const ctx = this.requireAuth(req, res);
    if (!ctx) return;
    const { workspaceId } = ctx;

    let plan: unknown;
    let visualType: QueryVisualizationType | undefined;
    let bypassCache = false;
    if (req.body && typeof req.body === 'object' && 'plan' in req.body) {
      plan = (req.body as { plan: unknown }).plan;
      const rawType = (req.body as { visualType?: unknown }).visualType;
      if (rawType !== undefined) {
        if (
          typeof rawType !== 'string' ||
          !(Object.values(QueryVisualizationType) as string[]).includes(rawType)
        ) {
          res.status(400).json({
            error: 'BadRequest',
            message: `Invalid visualType: ${String(rawType)}`,
          });
          return;
        }
        visualType = rawType as QueryVisualizationType;
      }
      bypassCache = (req.body as { bypassCache?: unknown }).bypassCache === true;
    } else {
      plan = req.body;
    }

    try {
      const result = await executeQueryPlan(plan, { workspaceId, componentType: visualType, bypassCache });
      res.json({
        visualType,
        data: result.data,
        rows: result.rows,
        rowCount: result.rowCount,
        executedAt: new Date().toISOString(),
      });
    } catch (e) {
      this.respondWithExecError(res, e);
    }
  };

  dataSourcesList = async (req: Request, res: Response): Promise<void> => {
    const workspaceId = this.requireWorkspace(req, res);
    if (!workspaceId) return;
    try {
      const dataSources = await this.dataSourceService.list(workspaceId);
      res.json({ dataSources });
    } catch (err) {
      logger.error('[DataSource] list failed:', err);
      res.status(500).json({ error: 'InternalServerError' });
    }
  };

  dataSourcesGetConfig = async (_req: Request, res: Response): Promise<void> => {
    res.json({ ingestTableLimit: config.dataSource.ingestTableLimit });
  };

  dataSourcesCreate = async (req: Request, res: Response): Promise<void> => {
    const ctx = this.requireAuth(req, res, 'Missing user or workspace context.');
    if (!ctx) return;
    const { userId, workspaceId } = ctx;

    const parsed = createDataSourceBodySchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        error: 'ValidationError',
        message: 'Request body failed validation.',
        details: parsed.error.flatten(),
      });
      return;
    }

    const agentsConfig = await AgentsConfig.fetch().catch(() => AgentsConfig.defaults());
    const ingestLimit = agentsConfig.dataSourceIngestTableLimit;
    if (parsed.data.includedTables && parsed.data.includedTables.length > ingestLimit) {
      res.status(400).json({
        error: 'ValidationError',
        message: `Too many tables selected: requested ${parsed.data.includedTables.length}, max is ${ingestLimit}.`,
        limit: ingestLimit,
      });
      return;
    }

    const input: CreateDataSourceInput = {
      workspaceId,
      name: parsed.data.name,
      description: parsed.data.description,
      sourceType: parsed.data.sourceType,
      connectionConfig: parsed.data.connectionConfig,
      createdBy: userId,
    };

    try {
      const { dataSource } = await this.dataSourceService.create(input);
      const queued = await this.dataSourceService.enqueueIngestion(
        dataSource.id,
        parsed.data.includedTables,
      );
      if (!queued) {
        res.status(503).json({
          error: 'ServiceUnavailable',
          message:
            'Data source was created but ingestion could not be queued. Retry from the admin panel once the queue recovers.',
          id: dataSource.id,
        });
        return;
      }
      res.status(202).json({
        id: dataSource.id,
        status: dataSource.ingestionStatus,
        name: dataSource.name,
        sourceType: dataSource.sourceType,
        createdAt: dataSource.createdAt,
      });
    } catch (err) {
      if (err instanceof DataSourceConnectionError) {
        res.status(400).json({ error: 'DataSourceConnectionError', message: err.message });
        return;
      }
      logger.error('[DataSource] create failed:', err);
      res.status(500).json({
        error: 'InternalServerError',
        message: 'Failed to create data source.',
      });
    }
  };

  dataSourcesGetById = async (req: Request, res: Response): Promise<void> => {
    const workspaceId = this.requireWorkspace(req, res);
    if (!workspaceId) return;
    const id = this.requireId(req, res);
    if (!id) return;
    try {
      const detail = await this.dataSourceService.getDetail(id, workspaceId);
      if (!detail) {
        res.status(404).json({ error: 'NotFound' });
        return;
      }
      res.json(detail);
    } catch (err) {
      logger.error('[DataSource] getById failed:', err);
      res.status(500).json({ error: 'InternalServerError' });
    }
  };

  dataSourcesGetSchema = async (req: Request, res: Response): Promise<void> => {
    const workspaceId = this.requireWorkspace(req, res);
    if (!workspaceId) return;
    const id = this.requireId(req, res);
    if (!id) return;
    try {
      const schema = await this.dataSourceService.getSchema(id, workspaceId);
      if (!schema) {
        res.status(404).json({ error: 'NotFound' });
        return;
      }
      res.json(schema);
    } catch (err) {
      logger.error('[DataSource] getSchema failed:', err);
      res.status(500).json({ error: 'InternalServerError' });
    }
  };

  dataSourcesTest = async (req: Request, res: Response): Promise<void> => {
    const workspaceId = this.requireWorkspace(req, res);
    if (!workspaceId) return;
    const parsed = discoverTablesBodySchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'ValidationError', details: parsed.error.flatten() });
      return;
    }
    try {
      const probe = await this.dataSourceService.testConnection(
        parsed.data.sourceType as SourceType,
        parsed.data.connectionConfig,
      );
      if (probe.ok) {
        res.json({ ok: true, version: probe.version });
      } else {
        res.status(400).json({ ok: false, error: probe.error ?? 'connection failed' });
      }
    } catch (err) {
      if (err instanceof SsrfBlockedError) {
        res.status(400).json({ ok: false, error: err.message });
        return;
      }
      logger.error('[DataSource] testConnection failed:', err);
      res.status(500).json({ ok: false, error: 'Internal error while testing connection.' });
    }
  };

  dataSourcesDiscoverTables = async (req: Request, res: Response): Promise<void> => {
    const workspaceId = this.requireWorkspace(req, res);
    if (!workspaceId) return;
    const parsed = discoverTablesBodySchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'ValidationError', details: parsed.error.flatten() });
      return;
    }
    try {
      const tables = await this.dataSourceService.discoverTables(
        parsed.data.sourceType as SourceType,
        parsed.data.connectionConfig,
      );
      res.json({ tables });
    } catch (err) {
      if (err instanceof SsrfBlockedError) {
        res.status(400).json({ error: 'SsrfBlockedError', message: err.message });
        return;
      }
      logger.error('[DataSource] discoverTables failed:', err);
      res.status(400).json({
        error: 'DiscoveryError',
        message:
          err instanceof Error
            ? err.message
            : 'Could not list tables for the supplied connection.',
      });
    }
  };

  dataSourcesRemove = async (req: Request, res: Response): Promise<void> => {
    const ctx = this.requireAuth(req, res);
    if (!ctx) return;
    const id = this.requireId(req, res);
    if (!id) return;
    try {
      const ok = await this.dataSourceService.remove(id, ctx.workspaceId, ctx.userId);
      if (!ok) {
        res.status(404).json({ error: 'NotFound' });
        return;
      }
      res.status(204).end();
    } catch (err) {
      logger.error('[DataSource] remove failed:', err);
      res.status(500).json({ error: 'InternalServerError' });
    }
  };

  dataSourcesRefresh = async (req: Request, res: Response): Promise<void> => {
    const ctx = this.requireAuth(req, res);
    if (!ctx) return;
    const id = this.requireId(req, res);
    if (!id) return;
    try {
      const { found, includedTables } = await this.dataSourceService.requestRefresh(
        id,
        ctx.workspaceId,
        ctx.userId,
      );
      if (!found) {
        res.status(404).json({ error: 'NotFound' });
        return;
      }
      const queued = await this.dataSourceService.enqueueIngestion(id, includedTables);
      if (!queued) {
        res.status(503).json({
          error: 'ServiceUnavailable',
          message: 'Refresh accepted but ingestion could not be queued. Retry once the queue recovers.',
          id,
        });
        return;
      }
      res.status(202).json({ id, status: 'pending' });
    } catch (err) {
      logger.error('[DataSource] refresh failed:', err);
      res.status(500).json({ error: 'InternalServerError' });
    }
  };

  private requireAuth(
    req: Request,
    res: Response,
    message?: string,
  ): { userId: string; workspaceId: string } | null {
    const userId = req.user?.id;
    const workspaceId = req.user?.workspaceId;
    if (!userId || !workspaceId) {
      const body: { error: string; message?: string } = { error: 'Unauthorized' };
      if (message) body.message = message;
      res.status(401).json(body);
      return null;
    }
    return { userId, workspaceId };
  }

  private requireWorkspace(req: Request, res: Response): string | null {
    const workspaceId = req.user?.workspaceId;
    if (!workspaceId) {
      res.status(401).json({ error: 'Unauthorized' });
      return null;
    }
    return workspaceId;
  }

  private requireId(req: Request, res: Response): string | null {
    const id = req.params.id;
    if (!id) {
      res.status(400).json({ error: 'BadRequest', message: 'Missing id.' });
      return null;
    }
    return id;
  }

  private async userCanReadDashboard(
    dashboard: { createdBy: string; visibility: DashboardVisibility; id: string },
    userId: string,
  ): Promise<boolean> {
    if (dashboard.createdBy === userId) return true;
    if (dashboard.visibility === DashboardVisibility.PUBLIC) return true;
    const participant = await db.dashboardParticipant.findUnique({
      where: { dashboardId_userId: { dashboardId: dashboard.id, userId } },
    });
    return (
      participant !== null &&
      participant.role !== undefined &&
      Object.values(DashboardRole).includes(participant.role)
    );
  }

  private respondWithExecError(res: Response, e: unknown): void {
    if (e instanceof QueryExecError) {
      switch (e.kind) {
        case 'not_found':
          res.status(404).json({ error: 'NotFound', message: e.message });
          return;
        case 'unauthorized':
          res.status(403).json({ error: 'Forbidden', message: e.message });
          return;
        case 'invalid_plan':
          res.status(400).json({ error: 'BadRequest', message: e.message });
          return;
        case 'shape_mismatch':
          res.status(422).json({
            error: 'ShapeMismatch',
            message: e.message,
            details: e.details,
          });
          return;
        case 'execution_failed':
          res.status(500).json({
            error: 'InternalServerError',
            message: e.message,
            details: e.details,
          });
          return;
      }
    }
    logger.error('[DashboardQuery] unexpected error', { error: e });
    res.status(500).json({ error: 'InternalServerError' });
  }
}
