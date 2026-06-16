import { Request, Response } from 'express';
import { z } from 'zod';
import {
  DashboardRole,
  DashboardVisibility,
  FormEntityType,
  Prisma,
  QueryVisualizationType,
} from '@prisma/client';
import { parseDashboardConfig } from '@xyne/shared';
import { db } from '@/database/client';
import { logger } from '@/utils/logger';
import { AppError } from '@/middleware/errorHandler';

const notFound = (message: string): AppError => new AppError(message, 404);
const forbidden = (message: string): AppError => new AppError(message, 403);
const conflict = (message: string): AppError => new AppError(message, 409);

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
  entityType: q.entityType ?? undefined,
  targetEntity: q.targetEntity ?? undefined,
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

const queryUpsertBody = z.object({
  id: z.string().optional(),
  title: z.string(),
  queryJson: z.any(),
  entityType: z.string().optional(),
  targetEntity: z.string().optional(),
  visualType: z.string().optional(),
  dashboardId: z.string().optional(),
  // queryType: when omitted on a new row defaults to 'internal' (QueryBuilder).
  queryType: z.enum(['internal', 'external']).optional(),
});

const reorderBody = z.object({ orderedMappingIds: z.array(z.string()) });

type Tx = Prisma.TransactionClient;

export class DashboardCrudController {
  // ---- context / response helpers (mirror DynamicDashboardController) ----
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

  // ---- shared permission helpers (ports of the ACL/mutator checks) ----
  private async userCanReadDashboard(
    dashboard: { createdBy: string; visibility: DashboardVisibility; id: string },
    userId: string,
  ): Promise<boolean> {
    if (dashboard.createdBy === userId) return true;
    if (dashboard.visibility === DashboardVisibility.PUBLIC) return true;
    const participant = await db.dashboardParticipant.findUnique({
      where: { dashboardId_userId: { dashboardId: dashboard.id, userId } },
    });
    return participant !== null;
  }

  // Returns { isOwner, isEditor } for the requesting user on a dashboard.
  private async resolveAccess(
    tx: Tx,
    dashboard: { createdBy: string; id: string },
    userId: string,
  ): Promise<{ isOwner: boolean; isEditor: boolean }> {
    const participant = await tx.dashboardParticipant.findUnique({
      where: { dashboardId_userId: { dashboardId: dashboard.id, userId } },
    });
    const isOwner =
      dashboard.createdBy === userId || participant?.role === DashboardRole.OWNER;
    const isEditor = participant?.role === DashboardRole.EDITOR;
    return { isOwner, isEditor };
  }

  // Throws unless the user is creator OR an OWNER/EDITOR participant. Used to
  // gate tile/component and query writes (port of assertDashboardEditAccess).
  private async assertEditAccess(
    tx: Tx,
    dashboardId: string,
    userId: string,
    workspaceId: string,
  ): Promise<void> {
    const dashboard = await tx.dynamicDashboard.findUnique({ where: { id: dashboardId } });
    if (!dashboard || dashboard.workspaceId !== workspaceId) {
      throw notFound('Dashboard not found');
    }
    const { isOwner, isEditor } = await this.resolveAccess(tx, dashboard, userId);
    if (!isOwner && !isEditor) {
      throw forbidden('You do not have permission to edit this dashboard');
    }
  }

  private async resolveDashboardIdForQuery(tx: Tx, queryId: string): Promise<string> {
    const mapping = await tx.dynamicDashboardQueryMapping.findFirst({ where: { queryId } });
    if (!mapping) {
      throw notFound(`Component ${queryId} is not linked to a dashboard`);
    }
    return mapping.dashboardId;
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
      if (!(await this.userCanReadDashboard(dashboard, ctx.userId))) {
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
      if (!(await this.userCanReadDashboard(dashboard, ctx.userId))) {
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
    const { name, description, visibility } = parsed.data;
    const trimmedName = name.trim();
    try {
      const dashboard = await db.$transaction(async (tx) => {
        await this.assertNoNameClash(tx, ctx.workspaceId, trimmedName);
        const created = await tx.dynamicDashboard.create({
          data: {
            workspaceId: ctx.workspaceId,
            name: trimmedName,
            description: description?.trim(),
            createdBy: ctx.userId,
            visibility: visibility ?? DashboardVisibility.PRIVATE,
            config: '{}',
          },
        });
        await tx.dashboardParticipant.create({
          data: {
            dashboardId: created.id,
            userId: ctx.userId,
            role: DashboardRole.OWNER,
          },
        });
        return created;
      });
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
    const { name, description, visibility, components } = parsed.data;
    const trimmedName = name.trim();
    try {
      const dashboard = await db.$transaction(async (tx) => {
        await this.assertNoNameClash(tx, ctx.workspaceId, trimmedName);
        const created = await tx.dynamicDashboard.create({
          data: {
            workspaceId: ctx.workspaceId,
            name: trimmedName,
            description: description?.trim(),
            createdBy: ctx.userId,
            visibility: visibility ?? DashboardVisibility.PRIVATE,
            config: '{}',
          },
        });
        await tx.dashboardParticipant.create({
          data: {
            dashboardId: created.id,
            userId: ctx.userId,
            role: DashboardRole.OWNER,
          },
        });
        for (let i = 0; i < components.length; i++) {
          const c = components[i]!;
          const query = await tx.dynamicDashboardQuery.create({
            data: {
              title: c.title ?? null,
              queryType: 'external',
              queryJson: c.queryJson,
              visualType: c.visualType as QueryVisualizationType,
              position: c.position,
              config: c.config ?? '{}',
              createdBy: ctx.userId,
            },
          });
          await tx.dynamicDashboardQueryMapping.create({
            data: { dashboardId: created.id, queryId: query.id, sequence: i },
          });
        }
        return created;
      });
      res.status(201).json({ dashboard: toDashboard(dashboard) });
    } catch (e) {
      this.respondWithError(res, e, 'createWithComponents');
    }
  };

  // PATCH /api/dashboards/:id
  update = async (req: Request, res: Response): Promise<void> => {
    const ctx = this.requireAuth(req, res);
    if (!ctx) return;
    const id = req.params.id!;
    const parsed = updateBody.safeParse(req.body);
    if (!parsed.success) return this.badRequest(res, parsed);
    const { name, description, visibility, config } = parsed.data;
    try {
      const updated = await db.$transaction(async (tx) => {
        const dashboard = await tx.dynamicDashboard.findUnique({ where: { id } });
        if (!dashboard || dashboard.workspaceId !== ctx.workspaceId) {
          throw notFound('Dashboard not found');
        }
        const { isOwner, isEditor } = await this.resolveAccess(tx, dashboard, ctx.userId);
        if (!isOwner && !isEditor) {
          throw forbidden('You do not have permission to edit this dashboard');
        }
        if (!isOwner && (name !== undefined || visibility !== undefined)) {
          throw forbidden('Only dashboard owners can rename or change visibility');
        }
        if (name !== undefined) {
          const trimmedName = name.trim();
          if (trimmedName !== dashboard.name) {
            await this.assertNoNameClash(tx, dashboard.workspaceId, trimmedName, id);
          }
        }
        if (config !== undefined) parseDashboardConfig(config);
        return tx.dynamicDashboard.update({
          where: { id },
          data: {
            ...(name !== undefined && { name: name.trim() }),
            ...(description !== undefined && { description: description?.trim() }),
            ...(visibility !== undefined && { visibility }),
            ...(config !== undefined && { config }),
          },
        });
      });
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
        const { isOwner } = await this.resolveAccess(tx, dashboard, ctx.userId);
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
        const { isOwner, isEditor } = await this.resolveAccess(tx, dashboard, ctx.userId);
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
            data: { dashboardId, userId: p.userId, role: p.role },
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
        const { isOwner, isEditor } = await this.resolveAccess(tx, dashboard, ctx.userId);
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
        const { isOwner, isEditor } = await this.resolveAccess(tx, dashboard, ctx.userId);
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
      const result = await db.$transaction(async (tx) => {
        await this.assertEditAccess(tx, dashboardId, ctx.userId, ctx.workspaceId);
        const query = await tx.dynamicDashboardQuery.create({
          data: {
            title: c.title ?? null,
            queryType: 'external',
            queryJson: c.queryJson,
            visualType: c.visualType as QueryVisualizationType,
            position: c.position,
            config: c.config ?? '{}',
            createdBy: ctx.userId,
          },
        });
        const mapping = await tx.dynamicDashboardQueryMapping.create({
          data: { dashboardId, queryId: query.id, sequence: c.sequence ?? 0 },
        });
        return { query, mapping };
      });
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
      const updated = await db.$transaction(async (tx) => {
        const dashboardId = await this.resolveDashboardIdForQuery(tx, queryId);
        await this.assertEditAccess(tx, dashboardId, ctx.userId, ctx.workspaceId);
        return tx.dynamicDashboardQuery.update({
          where: { id: queryId },
          data: {
            ...(c.visualType !== undefined && { visualType: c.visualType as QueryVisualizationType }),
            ...(c.title !== undefined && { title: c.title }),
            ...(c.queryJson !== undefined && { queryJson: c.queryJson }),
            ...(c.position !== undefined && { position: c.position }),
            ...(c.config !== undefined && { config: c.config }),
          },
        });
      });
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
        await this.assertEditAccess(tx, dashboardId, ctx.userId, ctx.workspaceId);
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
      await db.$transaction(async (tx) => {
        const dashboardId = await this.resolveDashboardIdForQuery(tx, queryId);
        await this.assertEditAccess(tx, dashboardId, ctx.userId, ctx.workspaceId);
        await tx.dynamicDashboardQueryMapping.deleteMany({ where: { queryId } });
        await tx.dynamicDashboardQuery.delete({ where: { id: queryId } });
      });
      res.json({ success: true });
    } catch (e) {
      this.respondWithError(res, e, 'deleteComponent');
    }
  };

  // =====================================================================
  // QUERIES (QueryBuilder saved queries + optional dashboard mapping)
  // =====================================================================

  // POST /api/dashboards/queries  (upsert)
  upsertQuery = async (req: Request, res: Response): Promise<void> => {
    const ctx = this.requireAuth(req, res);
    if (!ctx) return;
    const parsed = queryUpsertBody.safeParse(req.body);
    if (!parsed.success) return this.badRequest(res, parsed);
    const {
      id, title, queryJson, entityType, targetEntity, visualType, dashboardId, queryType,
    } = parsed.data;
    try {
      const result = await db.$transaction(async (tx) => {
        const existing = id
          ? await tx.dynamicDashboardQuery.findUnique({ where: { id } })
          : null;
        // Gate edits to an existing query (port of queries-acl
        // requireEditAccessIfMapped): if it's a dashboard tile, require edit
        // access on that dashboard; otherwise only the creator may edit it.
        if (existing) {
          const existingMapping = await tx.dynamicDashboardQueryMapping.findFirst({
            where: { queryId: existing.id },
          });
          if (existingMapping) {
            await this.assertEditAccess(
              tx, existingMapping.dashboardId, ctx.userId, ctx.workspaceId,
            );
          } else if (existing.createdBy !== ctx.userId) {
            throw forbidden('You do not have permission to edit this query');
          }
        }
        const query = existing
          ? await tx.dynamicDashboardQuery.update({
              where: { id: existing.id },
              data: {
                title: title.trim(),
                queryJson,
                entityType: (entityType as FormEntityType) ?? null,
                targetEntity: targetEntity ?? null,
                visualType: visualType ? (visualType as QueryVisualizationType) : null,
              },
            })
          : await tx.dynamicDashboardQuery.create({
              data: {
                ...(id && { id }),
                title: title.trim(),
                queryType: queryType ?? 'internal',
                queryJson,
                entityType: (entityType as FormEntityType) ?? null,
                targetEntity: targetEntity ?? null,
                visualType: visualType ? (visualType as QueryVisualizationType) : null,
                position: '{}',
                config: '{}',
                createdBy: ctx.userId,
              },
            });
        if (dashboardId) {
          await this.assertEditAccess(tx, dashboardId, ctx.userId, ctx.workspaceId);
          const duplicate = await tx.dynamicDashboardQueryMapping.findFirst({
            where: { dashboardId, queryId: query.id },
          });
          if (!duplicate) {
            const count = await tx.dynamicDashboardQueryMapping.count({ where: { dashboardId } });
            await tx.dynamicDashboardQueryMapping.create({
              data: { dashboardId, queryId: query.id, sequence: count },
            });
          }
        }
        return query;
      });
      res.json({ query: toQuery(result) });
    } catch (e) {
      this.respondWithError(res, e, 'upsertQuery');
    }
  };

  // DELETE /api/dashboards/queries/:id  (deletes query + mappings, resequences)
  deleteQuery = async (req: Request, res: Response): Promise<void> => {
    const ctx = this.requireAuth(req, res);
    if (!ctx) return;
    const queryId = req.params.id!;
    try {
      await db.$transaction(async (tx) => {
        const query = await tx.dynamicDashboardQuery.findUnique({ where: { id: queryId } });
        if (!query) throw notFound('Query not found');
        // If mapped to a dashboard, require edit access; resequence after.
        const mapping = await tx.dynamicDashboardQueryMapping.findFirst({
          where: { queryId },
        });
        if (mapping) {
          await this.assertEditAccess(tx, mapping.dashboardId, ctx.userId, ctx.workspaceId);
        } else if (query.createdBy !== ctx.userId) {
          throw forbidden('You do not have permission to delete this query');
        }
        await tx.dynamicDashboardQueryMapping.deleteMany({ where: { queryId } });
        await tx.dynamicDashboardQuery.delete({ where: { id: queryId } });
        if (mapping) {
          const remaining = await tx.dynamicDashboardQueryMapping.findMany({
            where: { dashboardId: mapping.dashboardId },
            orderBy: { sequence: 'asc' },
          });
          for (let i = 0; i < remaining.length; i++) {
            await tx.dynamicDashboardQueryMapping.update({
              where: { id: remaining[i]!.id },
              data: { sequence: i },
            });
          }
        }
      });
      res.json({ success: true });
    } catch (e) {
      this.respondWithError(res, e, 'deleteQuery');
    }
  };

  // PATCH /api/dashboards/:id/queries/reorder
  reorderQueries = async (req: Request, res: Response): Promise<void> => {
    const ctx = this.requireAuth(req, res);
    if (!ctx) return;
    const dashboardId = req.params.id!;
    const parsed = reorderBody.safeParse(req.body);
    if (!parsed.success) return this.badRequest(res, parsed);
    try {
      await db.$transaction(async (tx) => {
        await this.assertEditAccess(tx, dashboardId, ctx.userId, ctx.workspaceId);
        const { orderedMappingIds } = parsed.data;
        // Every mapping must belong to this dashboard — otherwise a user with
        // edit access here could renumber another dashboard's tiles by id.
        const owned = await tx.dynamicDashboardQueryMapping.findMany({
          where: { dashboardId, id: { in: orderedMappingIds } },
          select: { id: true },
        });
        if (owned.length !== orderedMappingIds.length) {
          throw forbidden('One or more mappings do not belong to this dashboard');
        }
        for (let i = 0; i < orderedMappingIds.length; i++) {
          await tx.dynamicDashboardQueryMapping.update({
            where: { id: orderedMappingIds[i]! },
            data: { sequence: i },
          });
        }
      });
      res.json({ success: true });
    } catch (e) {
      this.respondWithError(res, e, 'reorderQueries');
    }
  };

  private async assertNoNameClash(
    tx: Tx,
    workspaceId: string,
    name: string,
    excludeId?: string,
  ): Promise<void> {
    const clash = await tx.dynamicDashboard.findFirst({ where: { workspaceId, name } });
    if (clash && clash.id !== excludeId) {
      throw conflict(`A dashboard named "${name}" already exists in this workspace.`);
    }
  }
}
