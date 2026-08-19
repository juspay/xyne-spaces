import { Request, Response } from 'express';
import { X509Certificate } from 'node:crypto';
import { v4 as uuidv4 } from 'uuid';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import {
  DashboardAiCreateRequestSchema,
  QueryVisualizationType as SharedVisualizationType,
  DashboardRole,
  DashboardVisibility, QueryType } from '@xyne/shared';
import { config } from '@/config/env';
import { db } from '@/database/client';
import { logger } from '@/utils/logger';
import { AppError } from '@/middleware/errorHandler';
import { AgentsConfig } from '@/agents/config';
import { runClawAgentStream, cancelClawAgentRun, type ClawRunRequest } from '@/services/clawAgentService';
import { buildDashboardContext } from '@/services/dynamicDashboard/promptRender';
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
import {
  assertDashboardEditAccess,
  assertNoDashboardNameClash,
  createDashboardComponent,
  deleteDashboardComponent,
  resolveDashboardAccess,
  setDashboardMeta,
  updateDashboardComponent,
  userCanReadDashboard,
} from '@/services/dynamicDashboard/componentWrites';

const notFound = (message: string): AppError => new AppError(message, 404);
const forbidden = (message: string): AppError => new AppError(message, 403);

const STATUS_LABEL: Record<number, string> = {
  400: 'BadRequest',
  403: 'Forbidden',
  404: 'NotFound',
  409: 'Conflict',
};

const ms = (d: Date): number => d.getTime();

type DashboardRow = Prisma.DynamicDashboardGetPayload<{}>;
type ParticipantRow = Prisma.DashboardParticipantGetPayload<{}>;
type QueryRow = Prisma.DynamicDashboardQueryGetPayload<{}>;
type MappingRow = Prisma.DynamicDashboardQueryMappingGetPayload<{}>;

const toDashboard = (d: DashboardRow) => ({
  id: d.id,
  workspaceId: d.workspaceId,
  name: d.name,
  description: d.description ?? undefined,
  createdBy: d.createdBy,
  visibility: d.visibility,
  config: d.config,
  createdAt: ms(d.createdAt),
  updatedAt: ms(d.updatedAt),
});

const toParticipant = (p: ParticipantRow) => ({
  id: p.id,
  dashboardId: p.dashboardId,
  userId: p.userId,
  role: p.role,
  joinedAt: ms(p.joinedAt),
  updatedAt: ms(p.updatedAt),
});

const toQuery = (q: QueryRow) => ({
  id: q.id,
  title: q.title ?? undefined,
  queryType: q.queryType,
  queryJson: q.queryJson,
  visualType: q.visualType ?? undefined,
  position: q.position,
  config: q.config,
  createdBy: q.createdBy,
  createdAt: ms(q.createdAt),
  updatedAt: ms(q.updatedAt),
});

const toMapping = (m: MappingRow) => ({
  id: m.id,
  dashboardId: m.dashboardId,
  queryId: m.queryId,
  sequence: m.sequence,
  createdAt: ms(m.createdAt),
  updatedAt: ms(m.updatedAt),
});

// ---- Request body schemas ----
const createBody = z.object({
  name: z.string().min(1).max(120),
  description: z.string().max(500).optional(),
  visibility: z.nativeEnum(DashboardVisibility).optional(),
});

const componentInput = z.object({
  visualType: z.string(),
  title: z.string().optional(),
  queryJson: z.any(),
  position: z.string(),
  config: z.string().optional(),
});

const createWithComponentsBody = createBody.extend({
  components: z.array(componentInput).default([]),
});

const updateBody = z.object({
  name: z.string().min(1).max(120).optional(),
  description: z.string().max(500).optional(),
  visibility: z.nativeEnum(DashboardVisibility).optional(),
  config: z.string().optional(),
});

const addParticipantsBody = z.object({
  participants: z.array(
    z.object({ userId: z.string(), role: z.nativeEnum(DashboardRole) }),
  ),
});

const updateRoleBody = z.object({ role: z.nativeEnum(DashboardRole) });

const componentCreateBody = z.object({
  visualType: z.string(),
  title: z.string().optional(),
  queryJson: z.any(),
  position: z.string(),
  config: z.string().optional(),
  sequence: z.number().optional(),
});

const componentUpdateBody = z.object({
  visualType: z.string().optional(),
  title: z.string().optional(),
  queryJson: z.any().optional(),
  position: z.string().optional(),
  config: z.string().optional(),
});

const positionsBody = z.object({
  updates: z.array(z.object({ id: z.string(), position: z.string() })),
});

// ---- Data source schemas ----
function isParseableCertificate(pem: string): boolean {
  try {
    new X509Certificate(pem);
    return true;
  } catch {
    return false;
  }
}

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
    ca: z
      .string()
      .max(32_768)
      .refine(
        (s) => !/-----BEGIN [A-Z ]*PRIVATE KEY-----/.test(s),
        'This looks like a private key. Upload the CA certificate (server-ca.pem), not the key.',
      )
      .refine(
        isParseableCertificate,
        'Not a valid PEM certificate. Upload the CA file, e.g. server-ca.pem.',
      )
      .optional(),
  }),
  includedTables: z.array(includedTableSchema).max(10000).optional(),
});

const discoverTablesBodySchema = createDataSourceBodySchema.pick({
  sourceType: true,
  connectionConfig: true,
});

export class DashboardController {
  private readonly dataSourceService = new DataSourceService();

  // ---- context / response helpers ----
  private requireAuth(
    req: Request,
    res: Response,
  ): { userId: string; workspaceId: string } | null {
    const userId = req.user?.id;
    const workspaceId = req.user?.workspaceId;
    if (!userId || !workspaceId) {
      res.status(401).json({ error: 'Unauthorized' });
      return null;
    }
    return { userId, workspaceId };
  }

  private badRequest(res: Response, parsed: z.SafeParseError<unknown>): void {
    res.status(400).json({
      error: 'ValidationError',
      message: 'Request body failed validation.',
      details: parsed.error.flatten(),
    });
  }

  // Business/permission failures are thrown as AppError with an explicit
  // status code; everything else is an unexpected 500. Prisma's unique-
  // constraint violation (the DB backstop behind assertNoNameClash) maps to 409.
  private respondWithError(res: Response, e: unknown, tag: string): void {
    if (e instanceof AppError) {
      res.status(e.statusCode).json({
        error: STATUS_LABEL[e.statusCode] ?? 'Error',
        message: e.message,
      });
      return;
    }
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
      res.status(409).json({
        error: 'Conflict',
        message: 'A dashboard with these values already exists in this workspace.',
      });
      return;
    }
    logger.error(`[DashboardCrud] ${tag} failed:`, e);
    res.status(500).json({ error: 'InternalServerError', message: 'Request failed' });
  }

  // Creates the dashboard + OWNER participant (+ optional components) in one
  // transaction — shared by create and createWithComponents.
  private createDashboardTx(
    ctx: { userId: string; workspaceId: string },
    data: { name: string; description?: string | undefined; visibility?: DashboardVisibility | undefined },
    components: z.infer<typeof componentInput>[],
  ): Promise<DashboardRow> {
    const trimmedName = data.name.trim();
    return db.$transaction(async (tx) => {
      await assertNoDashboardNameClash(tx, ctx.workspaceId, trimmedName);
      const created = await tx.dynamicDashboard.create({
        data: {
          workspaceId: ctx.workspaceId,
          name: trimmedName,
          description: data.description?.trim(),
          createdBy: ctx.userId,
          visibility: data.visibility ?? DashboardVisibility.PRIVATE,
          config: '{}',
        },
      });
      await tx.dashboardParticipant.create({
        data: {
          workspaceId: ctx.workspaceId,
          dashboardId: created.id,
          userId: ctx.userId,
          role: DashboardRole.OWNER,
        },
      });
      for (let i = 0; i < components.length; i++) {
        const c = components[i]!;
        const query = await tx.dynamicDashboardQuery.create({
          data: {
            workspaceId: ctx.workspaceId,
            title: c.title ?? null,
            queryType: QueryType.external,
            queryJson: c.queryJson,
            visualType: c.visualType as SharedVisualizationType,
            position: c.position,
            config: c.config ?? '{}',
            createdBy: ctx.userId,
          },
        });
        await tx.dynamicDashboardQueryMapping.create({
          data: { workspaceId: ctx.workspaceId, dashboardId: created.id, queryId: query.id, sequence: i },
        });
      }
      return created;
    });
  }

  // =====================================================================
  // READS
  // =====================================================================

  // GET /api/dashboards?scope=mine|shared|all&limit=&offset=
  list = async (req: Request, res: Response): Promise<void> => {
    const ctx = this.requireAuth(req, res);
    if (!ctx) return;
    const scope = (req.query.scope as string) ?? 'all';
    const limit = Math.min(Number(req.query.limit) || 50, 200);
    const offset = Math.max(Number(req.query.offset) || 0, 0);

    // Only list dashboards the requester can read (port of the old
    // DashboardsACL.canSelect): creator, PUBLIC, or a participant. Without
    // this, scope='all' would leak other users' PRIVATE dashboards.
    const readable: Prisma.DynamicDashboardWhereInput = {
      OR: [
        { createdBy: ctx.userId },
        { visibility: DashboardVisibility.PUBLIC },
        { participants: { some: { userId: ctx.userId } } },
      ],
    };
    const where: Prisma.DynamicDashboardWhereInput = {
      workspaceId: ctx.workspaceId,
      AND: [readable],
    };
    if (scope === 'mine') where.createdBy = ctx.userId;
    else if (scope === 'shared') where.createdBy = { not: ctx.userId };

    try {
      const [rows, total] = await Promise.all([
        db.dynamicDashboard.findMany({
          where,
          orderBy: { updatedAt: 'desc' },
          take: limit,
          skip: offset,
        }),
        db.dynamicDashboard.count({ where }),
      ]);
      res.json({
        dashboards: rows.map(toDashboard),
        total,
        hasMore: offset + rows.length < total,
      });
    } catch (e) {
      this.respondWithError(res, e, 'list');
    }
  };

  // GET /api/dashboards/:id?queryType=internal|external|all
  getById = async (req: Request, res: Response): Promise<void> => {
    const ctx = this.requireAuth(req, res);
    if (!ctx) return;
    const id = req.params.id!;
    const queryType = (req.query.queryType as string) ?? 'all';
    try {
      const dashboard = await db.dynamicDashboard.findUnique({ where: { id } });
      if (!dashboard || dashboard.workspaceId !== ctx.workspaceId) {
        res.status(404).json({ error: 'NotFound', message: 'Dashboard not found' });
        return;
      }
      if (!(await userCanReadDashboard(dashboard as Parameters<typeof userCanReadDashboard>[0], ctx.userId))) {
        res.status(404).json({ error: 'NotFound', message: 'Dashboard not found' });
        return;
      }
      const [participants, mappings] = await Promise.all([
        db.dashboardParticipant.findMany({ where: { dashboardId: id } }),
        db.dynamicDashboardQueryMapping.findMany({
          where: { dashboardId: id },
          orderBy: { sequence: 'asc' },
          include: { query: true },
        }),
      ]);
      const tiles = mappings
        .filter((m) =>
          queryType === 'all' ? true : m.query.queryType === queryType,
        )
        .map((m) => ({ mapping: toMapping(m), query: toQuery(m.query) }));
      res.json({
        dashboard: toDashboard(dashboard),
        participants: participants.map(toParticipant),
        tiles,
      });
    } catch (e) {
      this.respondWithError(res, e, 'getById');
    }
  };

  // GET /api/dashboards/:id/participants
  listParticipants = async (req: Request, res: Response): Promise<void> => {
    const ctx = this.requireAuth(req, res);
    if (!ctx) return;
    const id = req.params.id!;
    try {
      const dashboard = await db.dynamicDashboard.findUnique({ where: { id } });
      if (!dashboard || dashboard.workspaceId !== ctx.workspaceId) {
        res.status(404).json({ error: 'NotFound', message: 'Dashboard not found' });
        return;
      }
      if (!(await userCanReadDashboard(dashboard as Parameters<typeof userCanReadDashboard>[0], ctx.userId))) {
        res.status(404).json({ error: 'NotFound', message: 'Dashboard not found' });
        return;
      }
      const participants = await db.dashboardParticipant.findMany({
        where: { dashboardId: id },
        orderBy: { joinedAt: 'asc' },
      });
      res.json({ participants: participants.map(toParticipant) });
    } catch (e) {
      this.respondWithError(res, e, 'listParticipants');
    }
  };

  // =====================================================================
  // DASHBOARD WRITES
  // =====================================================================

  // POST /api/dashboards  — creates the dashboard + OWNER participant.
  create = async (req: Request, res: Response): Promise<void> => {
    const ctx = this.requireAuth(req, res);
    if (!ctx) return;
    const parsed = createBody.safeParse(req.body);
    if (!parsed.success) return this.badRequest(res, parsed);
    try {
      const dashboard = await this.createDashboardTx(ctx, parsed.data, []);
      res.status(201).json({ dashboard: toDashboard(dashboard) });
    } catch (e) {
      this.respondWithError(res, e, 'create');
    }
  };

  // POST /api/dashboards/with-components
  createWithComponents = async (req: Request, res: Response): Promise<void> => {
    const ctx = this.requireAuth(req, res);
    if (!ctx) return;
    const parsed = createWithComponentsBody.safeParse(req.body);
    if (!parsed.success) return this.badRequest(res, parsed);
    try {
      const dashboard = await this.createDashboardTx(ctx, parsed.data, parsed.data.components);
      res.status(201).json({ dashboard: toDashboard(dashboard) });
    } catch (e) {
      this.respondWithError(res, e, 'createWithComponents');
    }
  };

  // PATCH /api/dashboards/:id — permission rules live in setDashboardMeta
  // (shared with the AI's set_dashboard_meta tool).
  update = async (req: Request, res: Response): Promise<void> => {
    const ctx = this.requireAuth(req, res);
    if (!ctx) return;
    const id = req.params.id!;
    const parsed = updateBody.safeParse(req.body);
    if (!parsed.success) return this.badRequest(res, parsed);
    try {
      const updated = await setDashboardMeta(id, parsed.data, ctx);
      res.json({ dashboard: toDashboard(updated) });
    } catch (e) {
      this.respondWithError(res, e, 'update');
    }
  };

  // DELETE /api/dashboards/:id  (owner-only cascade)
  remove = async (req: Request, res: Response): Promise<void> => {
    const ctx = this.requireAuth(req, res);
    if (!ctx) return;
    const id = req.params.id!;
    try {
      await db.$transaction(async (tx) => {
        const dashboard = await tx.dynamicDashboard.findUnique({ where: { id } });
        if (!dashboard || dashboard.workspaceId !== ctx.workspaceId) {
          throw notFound('Dashboard not found');
        }
        const { isOwner } = await resolveDashboardAccess(tx, dashboard, ctx.userId);
        if (!isOwner) {
          throw forbidden('Only dashboard owners can delete the dashboard');
        }
        // App-side cascade (relationMode = "prisma" — no DB FKs).
        const mappings = await tx.dynamicDashboardQueryMapping.findMany({
          where: { dashboardId: id },
        });
        await tx.dynamicDashboardQueryMapping.deleteMany({ where: { dashboardId: id } });
        await tx.dynamicDashboardQuery.deleteMany({
          where: { id: { in: mappings.map((m) => m.queryId) } },
        });
        await tx.dashboardParticipant.deleteMany({ where: { dashboardId: id } });
        await tx.dynamicDashboard.delete({ where: { id } });
      });
      res.json({ success: true });
    } catch (e) {
      this.respondWithError(res, e, 'remove');
    }
  };

  // =====================================================================
  // PARTICIPANTS
  // =====================================================================

  // POST /api/dashboards/:id/participants
  addParticipants = async (req: Request, res: Response): Promise<void> => {
    const ctx = this.requireAuth(req, res);
    if (!ctx) return;
    const dashboardId = req.params.id!;
    const parsed = addParticipantsBody.safeParse(req.body);
    if (!parsed.success) return this.badRequest(res, parsed);
    try {
      await db.$transaction(async (tx) => {
        const dashboard = await tx.dynamicDashboard.findUnique({ where: { id: dashboardId } });
        if (!dashboard || dashboard.workspaceId !== ctx.workspaceId) {
          throw notFound("Dashboard doesn't exist");
        }
        const { isOwner, isEditor } = await resolveDashboardAccess(tx, dashboard, ctx.userId);
        if (!isOwner && !isEditor) {
          throw forbidden('Only dashboard owners or editors can add participants');
        }
        if (isEditor && parsed.data.participants.some((p) => p.role === DashboardRole.OWNER)) {
          throw forbidden('Editors cannot grant owner role');
        }
        for (const p of parsed.data.participants) {
          const user = await tx.user.findUnique({ where: { id: p.userId } });
          if (!user) continue;
          const existing = await tx.dashboardParticipant.findUnique({
            where: { dashboardId_userId: { dashboardId, userId: p.userId } },
          });
          if (existing) continue;
          await tx.dashboardParticipant.create({
            data: { workspaceId: ctx.workspaceId, dashboardId, userId: p.userId, role: p.role },
          });
        }
      });
      const participants = await db.dashboardParticipant.findMany({
        where: { dashboardId },
        orderBy: { joinedAt: 'asc' },
      });
      res.json({ participants: participants.map(toParticipant) });
    } catch (e) {
      this.respondWithError(res, e, 'addParticipants');
    }
  };

  // DELETE /api/dashboards/:id/participants/:userId
  removeParticipant = async (req: Request, res: Response): Promise<void> => {
    const ctx = this.requireAuth(req, res);
    if (!ctx) return;
    const dashboardId = req.params.id!;
    const targetUserId = req.params.userId!;
    try {
      await db.$transaction(async (tx) => {
        const dashboard = await tx.dynamicDashboard.findUnique({ where: { id: dashboardId } });
        if (!dashboard || dashboard.workspaceId !== ctx.workspaceId) {
          throw notFound("Dashboard doesn't exist");
        }
        const { isOwner, isEditor } = await resolveDashboardAccess(tx, dashboard, ctx.userId);
        if (!isOwner && !isEditor) {
          throw forbidden('Only dashboard owners or editors can remove participants');
        }
        const target = await tx.dashboardParticipant.findUnique({
          where: { dashboardId_userId: { dashboardId, userId: targetUserId } },
        });
        if (!target) throw notFound('User is not a participant');
        if (targetUserId === ctx.userId && dashboard.createdBy === ctx.userId) {
          throw forbidden('Dashboard creator cannot be removed');
        }
        if (isEditor && target.role === DashboardRole.OWNER) {
          throw forbidden('Editors cannot remove owners');
        }
        await tx.dashboardParticipant.delete({ where: { id: target.id } });
      });
      res.json({ success: true });
    } catch (e) {
      this.respondWithError(res, e, 'removeParticipant');
    }
  };

  // PATCH /api/dashboards/:id/participants/:userId
  updateParticipantRole = async (req: Request, res: Response): Promise<void> => {
    const ctx = this.requireAuth(req, res);
    if (!ctx) return;
    const dashboardId = req.params.id!;
    const targetUserId = req.params.userId!;
    const parsed = updateRoleBody.safeParse(req.body);
    if (!parsed.success) return this.badRequest(res, parsed);
    const { role } = parsed.data;
    try {
      const updated = await db.$transaction(async (tx) => {
        const dashboard = await tx.dynamicDashboard.findUnique({ where: { id: dashboardId } });
        if (!dashboard || dashboard.workspaceId !== ctx.workspaceId) {
          throw notFound("Dashboard doesn't exist");
        }
        const { isOwner, isEditor } = await resolveDashboardAccess(tx, dashboard, ctx.userId);
        if (!isOwner && !isEditor) {
          throw forbidden('Only dashboard owners or editors can update participant roles');
        }
        const target = await tx.dashboardParticipant.findUnique({
          where: { dashboardId_userId: { dashboardId, userId: targetUserId } },
        });
        if (!target) throw notFound('User is not a participant');
        if (isEditor && role === DashboardRole.OWNER) {
          throw forbidden('Editors cannot grant owner role');
        }
        if (isEditor && target.role === DashboardRole.OWNER) {
          throw forbidden('Editors cannot modify owner roles');
        }
        if (targetUserId === dashboard.createdBy) {
          throw forbidden("Cannot change dashboard creator's role");
        }
        return tx.dashboardParticipant.update({
          where: { id: target.id },
          data: { role },
        });
      });
      res.json({ participant: toParticipant(updated) });
    } catch (e) {
      this.respondWithError(res, e, 'updateParticipantRole');
    }
  };

  // =====================================================================
  // TILES / COMPONENTS  (external queries linked via mapping)
  // =====================================================================

  // POST /api/dashboards/:id/components
  createComponent = async (req: Request, res: Response): Promise<void> => {
    const ctx = this.requireAuth(req, res);
    if (!ctx) return;
    const dashboardId = req.params.id!;
    const parsed = componentCreateBody.safeParse(req.body);
    if (!parsed.success) return this.badRequest(res, parsed);
    const c = parsed.data;
    try {
      const result = await createDashboardComponent(dashboardId, c, ctx);
      res.status(201).json({
        query: toQuery(result.query),
        mapping: toMapping(result.mapping),
      });
    } catch (e) {
      this.respondWithError(res, e, 'createComponent');
    }
  };

  // PATCH /api/dashboards/components/:queryId
  updateComponent = async (req: Request, res: Response): Promise<void> => {
    const ctx = this.requireAuth(req, res);
    if (!ctx) return;
    const queryId = req.params.queryId!;
    const parsed = componentUpdateBody.safeParse(req.body);
    if (!parsed.success) return this.badRequest(res, parsed);
    const c = parsed.data;
    try {
      const updated = await updateDashboardComponent(queryId, c, ctx);
      res.json({ query: toQuery(updated) });
    } catch (e) {
      this.respondWithError(res, e, 'updateComponent');
    }
  };

  // PATCH /api/dashboards/:id/components/positions  (batch drag/resize)
  updatePositions = async (req: Request, res: Response): Promise<void> => {
    const ctx = this.requireAuth(req, res);
    if (!ctx) return;
    const dashboardId = req.params.id!;
    const parsed = positionsBody.safeParse(req.body);
    if (!parsed.success) return this.badRequest(res, parsed);
    try {
      await db.$transaction(async (tx) => {
        await assertDashboardEditAccess(tx, dashboardId, ctx.userId, ctx.workspaceId);
        // All updated tiles must belong to this dashboard.
        const ids = parsed.data.updates.map((u) => u.id);
        const mappings = await tx.dynamicDashboardQueryMapping.findMany({
          where: { dashboardId, queryId: { in: ids } },
        });
        const allowed = new Set(mappings.map((m) => m.queryId));
        for (const u of parsed.data.updates) {
          if (!allowed.has(u.id)) {
            throw forbidden('Tile does not belong to this dashboard');
          }
          await tx.dynamicDashboardQuery.update({
            where: { id: u.id },
            data: { position: u.position },
          });
        }
      });
      res.json({ success: true });
    } catch (e) {
      this.respondWithError(res, e, 'updatePositions');
    }
  };

  // DELETE /api/dashboards/components/:queryId
  deleteComponent = async (req: Request, res: Response): Promise<void> => {
    const ctx = this.requireAuth(req, res);
    if (!ctx) return;
    const queryId = req.params.queryId!;
    try {
      await deleteDashboardComponent(queryId, ctx);
      res.json({ success: true });
    } catch (e) {
      this.respondWithError(res, e, 'deleteComponent');
    }
  };

  // =====================================================================
  // AI CHAT (SSE proxy to the dashboard-ai Claw agent)
  // =====================================================================

  aiCreate = async (req: Request, res: Response): Promise<void> => {
    const ctx = this.requireAuth(req, res);
    if (!ctx) return;
    const { userId, workspaceId } = ctx;
    const user = req.user!;

    const parsed = DashboardAiCreateRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        error: 'BadRequest',
        message: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '),
      });
      return;
    }
    const { prompt, dataSourceId, currentPlan, sessionId, lastError, dashboardId, focusedComponentId, newThread } =
      parsed.data;
    if (!dashboardId) {
      res.status(400).json({ error: 'BadRequest', message: 'dashboardId is required for the dashboard AI chat' });
      return;
    }

    const dataSource = await this.dataSourceService.findWorkspace(dataSourceId, workspaceId);
    if (!dataSource) {
      res.status(404).json({ error: 'NotFound', message: 'Data source not found' });
      return;
    }

    try {
      await db.$transaction((tx) =>
        assertDashboardEditAccess(tx, dashboardId, userId, workspaceId),
      );
    } catch (e) {
      if (e instanceof AppError) {
        res.status(e.statusCode).json({ error: 'Forbidden', message: e.message });
        return;
      }
      throw e;
    }

    const cacConfig = await AgentsConfig.fetch().catch(() => AgentsConfig.defaults());
    const [tables, relationships] = await Promise.all([
      db.dataSourceTable.findMany({
        where: { dataSourceId },
        include: { columns: true },
        orderBy: [{ schemaName: 'asc' }, { tableName: 'asc' }],
        take: cacConfig.dataSourceIngestTableLimit,
      }),
      db.dataSourceRelationship.findMany({
        where: { dataSourceId },
        include: {
          fromColumn: { include: { table: true } },
          toColumn: { include: { table: true } },
        },
      }),
    ]);

    const dashboardContext = buildDashboardContext({
      dataSourceName: dataSource.name,
      sourceType: dataSource.sourceType,
      tables,
      relationships,
      currentPlan,
      focusedComponentId,
    });

    const errorBlock = lastError
      ? `Previous attempt failed at execution. Error:\n${lastError.slice(0, 500)}\n\nPlease correct the queryPlan and retry (re-check table/column names and join types with get_table_schema).\n\n`
      : '';

    const effectiveSessionId = newThread
      ? `dashboard-${dashboardId}-${uuidv4().slice(0, 8)}`
      : (sessionId ?? `dashboard-${dashboardId}`);

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.setHeader('Content-Encoding', 'none');
    if (res.socket) res.socket.setNoDelay(true);
    res.flushHeaders();

    const pingInterval = setInterval(() => {
      if (!res.writableEnded) {
        res.write(`data: ${JSON.stringify({ type: 'ping' })}\n\n`);
        if (typeof (res as { flush?: () => void }).flush === 'function') {
          (res as unknown as { flush: () => void }).flush();
        }
      }
    }, config.dashboard.aiSsePingIntervalMs);

    // Tear down the upstream claw-auth fetch the moment the dashboard's SSE
    // connection drops — same safety net as xyneAIControllerV2.
    const upstreamAbort = new AbortController();
    const onClientClose = (): void => {
      if (!upstreamAbort.signal.aborted) upstreamAbort.abort();
    };
    res.on('close', onClientClose);

    const runReq: ClawRunRequest = {
      userId,
      spacesWorkspaceId: req.user?.workspaceId,
      userName: user.name ?? user.displayName ?? 'Unknown',
      userEmail: user.email ?? '',
      query: `${errorBlock}${prompt}`,
      agentSlug: 'dashboard-ai',
      provider: 'spaces',
      conversationId: effectiveSessionId,
      channelId: '',
      sessionId: effectiveSessionId,
      dataSourceId,
      draftId: dashboardId,
      ...(focusedComponentId ? { focusedComponentId } : {}),
      dashboardContext,
      webSearchEnabled: false,
      deepResearchEnabled: false,
      createCanvasEnabled: false,
    };

    try {
      const result = await runClawAgentStream(req, res, runReq, {
        signal: upstreamAbort.signal,
      });
      if (result.error) {
        res.write(
          `data: ${JSON.stringify({ type: 'error', message: result.error, recoverable: false })}\n\n`,
        );
      }
    } catch (streamError) {
      const message = streamError instanceof Error ? streamError.message : String(streamError);
      logger.error('[DashboardAI] stream failed', {
        userId,
        dashboardId,
        dataSourceId,
        error: message,
      });
      if (!res.writableEnded) {
        res.write(
          `data: ${JSON.stringify({ type: 'error', message, recoverable: false })}\n\n`,
        );
      }
    } finally {
      res.off('close', onClientClose);
      clearInterval(pingInterval);
    }

    if (!res.writableEnded) {
      res.write(`data: ${JSON.stringify({ type: 'end' })}\n\n`);
      res.end();
    }
  };


  aiCancel = async (req: Request, res: Response): Promise<void> => {
    const ctx = this.requireAuth(req, res);
    if (!ctx) return;
    const runId = req.params['runId'];
    if (!runId) {
      res.status(400).json({ error: 'BadRequest', message: 'runId is required' });
      return;
    }
    const result = await cancelClawAgentRun(
      req,
      ctx.userId,
      runId,
      req.user?.workspaceId,
    );
    if (!result.success) {
      res.status(502).json({ success: false, error: result.error ?? 'Cancel failed' });
      return;
    }
    res.json({ success: true, runId, status: result.status });
  };

  // =====================================================================
  // QUERY EXECUTION (component data + preview)
  // =====================================================================

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

    if (!(await userCanReadDashboard(dashboard as Parameters<typeof userCanReadDashboard>[0], userId))) {
      res.status(404).json({ error: 'NotFound', message: 'Component not found' });
      return;
    }

    const plan: unknown = component.queryJson;
    const componentType = (component.visualType ?? undefined) as SharedVisualizationType | undefined;
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
    let visualType: SharedVisualizationType | undefined;
    let bypassCache = false;
    if (req.body && typeof req.body === 'object' && 'plan' in req.body) {
      plan = (req.body as { plan: unknown }).plan;
      const rawType = (req.body as { visualType?: unknown }).visualType;
      if (rawType !== undefined) {
        if (
          typeof rawType !== 'string' ||
          !(Object.values(SharedVisualizationType) as string[]).includes(rawType)
        ) {
          res.status(400).json({
            error: 'BadRequest',
            message: `Invalid visualType: ${String(rawType)}`,
          });
          return;
        }
        visualType = rawType as SharedVisualizationType;
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
        debug: result.debug,
        executedAt: new Date().toISOString(),
      });
    } catch (e) {
      this.respondWithExecError(res, e);
    }
  };

  // =====================================================================
  // DATA SOURCES
  // =====================================================================

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
    const ctx = this.requireAuth(req, res);
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
          // Return a generic message; the detail is logged server-side in QueryExecutor.
          res.status(500).json({
            error: 'InternalServerError',
            message: 'Query execution failed.',
          });
          return;
      }
    }
    logger.error('[DashboardQuery] unexpected error', { error: e });
    res.status(500).json({ error: 'InternalServerError' });
  }
}
