import { z } from 'zod';
import * as XLSX from 'xlsx';
import { AccessType, ProjectType, TicketPriority, TicketStatusV2, UserStatus, WorkspaceRole } from '@xyne/shared';
import { Prisma } from '@prisma/client';
import { DatabaseClient } from '@/database/client';
import { repositories } from '@/database/repositories';
import { AppError } from '@/middleware/errorHandler';
import {
  STANDARD_TICKET_REPORT_COLUMNS,
  redactOpaqueExportIdentifier,
  ticketReportXlsxBuilder,
  TicketExportTicket,
  TicketExportLink,
  TicketExportActivity,
} from '@/services/ticketReportXlsxBuilder';
import { logger } from '@/utils/logger';

const prisma = DatabaseClient.getInstance();

const ticketExportInclude = {
  board: { include: { project: true } },
  project: true,
  channel: true,
  createdByUser: true,
  updatedByUser: true,
  assignedToUser: true,
  tags: true,
} satisfies Prisma.TicketInclude;

type RawExportTicket = Prisma.TicketGetPayload<{ include: typeof ticketExportInclude }>;

function formatFileStamp(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

const MAX_EXPORT_ROWS = 1000;
const MAX_ACTIVITY_ROWS = 5000;
const TICKET_REPORT_RESOURCE_NAME = 'TICKET-REPORTS';
const ESTIMATED_CORE_COLUMNS = 19;
const ESTIMATED_BYTES_PER_CELL = 32;
const STALE_EXPORT_TIMEOUT_MS = 15 * 60 * 1000;

const badRequest = (message: string): AppError => new AppError(message, 400);
const forbidden = (message: string): AppError => new AppError(message, 403);
const notFound = (message: string): AppError => new AppError(message, 404);
const conflict = (message: string): AppError => new AppError(message, 409);

export type TicketExportStatus = 'PENDING' | 'IN_PROGRESS' | 'READY' | 'EXPIRED' | 'FAILED' | 'CANCELED';

const dateRangeSchema = z
  .object({
    from: z.coerce.date().optional(),
    to: z.coerce.date().optional(),
  })
  .refine(range => !range.from || !range.to || range.from <= range.to, {
    message: 'Date range start must be before or equal to end',
  });

export const ticketExportFiltersSchema = z.object({
  projectId: z.string().min(1).optional(),
  sourceChannelId: z.string().min(1).optional(),
  boardIds: z.array(z.string().min(1)).optional(),
  dateRange: dateRangeSchema.optional(),
  statuses: z.array(z.nativeEnum(TicketStatusV2)).optional(),
  priorities: z.array(z.nativeEnum(TicketPriority)).optional(),
  assignees: z.array(z.string().min(1)).optional(),
  tags: z.array(z.string().min(1)).optional(),
  includeArchived: z.boolean().default(false),
  includeLinkedTickets: z.boolean().default(true),
  includeLinkedTicketDetails: z.boolean().default(false),
  includeActivity: z.boolean().default(false),
  timezone: z.string().default('UTC'),
  columnsByBoard: z.record(z.array(z.string().min(1)).min(1)).optional(),
});

export const createTicketExportRequestSchema = z.object({
  workspaceId: z.string().min(1),
  filters: ticketExportFiltersSchema.default({}),
});

export const downloadTicketExportRequestSchema = z.union([
  z.object({ exportId: z.string().min(1) }),
  createTicketExportRequestSchema,
]);

export type CreateTicketExportRequestInput = z.infer<typeof createTicketExportRequestSchema>;
export type DownloadTicketExportRequestInput = z.infer<typeof downloadTicketExportRequestSchema>;
export type TicketExportFilters = z.infer<typeof ticketExportFiltersSchema>;
export type TicketExportPermissionLevel = 'ADMIN' | 'WRITE' | 'READ';

export interface TicketExportEstimate {
  rowCount: number;
  linkedTicketCount: number;
  activityRowCount: number;
  sheetCount: number;
  estimatedCells: number;
  estimatedBytes: number;
}

interface AuthenticatedUser {
  id: string;
  email: string;
  name?: string;
  workspaceId: string;
  role?: WorkspaceRole;
}

interface ExportContext {
  exportRecord: {
    id: string;
    workspaceId: string;
    requestedBy: string;
    filters: string;
    status: TicketExportStatus;
  };
  user: AuthenticatedUser;
  permissionLevel: TicketExportPermissionLevel;
}

export class TicketReportService {
  async requestExport(input: CreateTicketExportRequestInput, user: AuthenticatedUser) {
    const { workspaceId, filters } = input;

    await this.validateExportRequest(input, user);

    const now = new Date();
    const exportRecord = await prisma.ticketExport.create({
      data: {
        workspaceId,
        requestedBy: user.id,
        status: 'PENDING',
        filters: JSON.stringify(filters),
        createdAt: now,
        updatedAt: now,
      },
    });

    return this.sanitizeExportRecord(exportRecord);
  }

  async validateExportRequest(
    input: CreateTicketExportRequestInput,
    user: AuthenticatedUser,
  ): Promise<void> {
    const estimate = await this.estimateExport(input, user);
    if (estimate.rowCount > MAX_EXPORT_ROWS) {
      throw badRequest(
        `Export exceeds maximum limit of ${MAX_EXPORT_ROWS.toLocaleString()} tickets. Please narrow your filters.`,
      );
    }
    if (estimate.rowCount === 0) {
      throw badRequest('No tickets found for the selected filters');
    }
    if (estimate.activityRowCount > MAX_ACTIVITY_ROWS) {
      throw badRequest(
        `Export exceeds maximum limit of ${MAX_ACTIVITY_ROWS.toLocaleString()} activity rows. Please narrow your filters or exclude activity.`,
      );
    }
  }

  async estimateExport(
    input: CreateTicketExportRequestInput,
    user: AuthenticatedUser,
  ): Promise<TicketExportEstimate> {
    const { workspaceId, filters } = input;
    if (workspaceId !== user.workspaceId) {
      throw forbidden('Workspace mismatch');
    }

    const permissionLevel = await this.assertCanCreateExport(user, workspaceId);
    await this.assertWorkspaceExportEnabled(workspaceId);
    await this.assertScopeAllowed(user, permissionLevel, filters.projectId);
    await this.validateFilterScope(workspaceId, filters);
    await this.assertSourceContextAllowed(user, filters);

    const visibleTicketWhere = this.buildVisibleTicketWhere(workspaceId, filters, user.id);
    const [rowCount, ticketGroups] = await Promise.all([
      prisma.ticket.count({ where: visibleTicketWhere }),
      prisma.ticket.groupBy({
        by: ['boardId'],
        where: visibleTicketWhere,
        _count: { _all: true },
      }),
    ]);
    const boardCount = ticketGroups.length;

    let linkedTicketCount = 0;
    let linkedBoardCount = 0;
    let activityRowCount = 0;
    if (rowCount > 0 && rowCount <= MAX_EXPORT_ROWS && filters.includeLinkedTickets) {
      const [outboundLinks, inboundLinks] = await Promise.all([
        prisma.ticketReferenceMapping.findMany({
          where: { sourceTicket: visibleTicketWhere },
          select: { targetTicketId: true },
        }),
        prisma.ticketReferenceMapping.findMany({
          where: { targetTicket: visibleTicketWhere },
          select: { sourceTicketId: true },
        }),
      ]);
      const targetIds = [
        ...new Set([
          ...outboundLinks.map(row => row.targetTicketId),
          ...inboundLinks.map(row => row.sourceTicketId),
        ]),
      ];
      const targetTickets = await prisma.ticket.findMany({
        where: { id: { in: targetIds }, workspaceId },
        select: {
          id: true,
          boardId: true,
          channelId: true,
          channel: { select: { visibility: true } },
        },
      });
      const visibleTargets = await this.applyPrivateChannelVisibility(user.id, targetTickets);
      linkedTicketCount = visibleTargets.length;
      linkedBoardCount = new Set(visibleTargets.map(ticket => ticket.boardId)).size;
    }
    if (rowCount > 0 && rowCount <= MAX_EXPORT_ROWS && filters.includeActivity) {
      activityRowCount = await prisma.ticketActivity.count({
        where: { ticket: visibleTicketWhere },
      });
    }

    const sheetCount =
      1 +
      boardCount +
      (filters.includeLinkedTickets ? 1 : 0) +
      (filters.includeLinkedTicketDetails ? linkedBoardCount : 0) +
      (filters.includeActivity ? 1 : 0);
    const estimatedCells =
      ticketGroups.reduce(
        (total, group) =>
          total +
          group._count._all *
            (filters.columnsByBoard?.[group.boardId]?.length ?? ESTIMATED_CORE_COLUMNS),
        0,
      ) +
      linkedTicketCount * 10 +
      activityRowCount * 11;

    return {
      rowCount,
      linkedTicketCount,
      activityRowCount,
      sheetCount,
      estimatedCells,
      estimatedBytes: estimatedCells * ESTIMATED_BYTES_PER_CELL,
    };
  }

  private async generateExport(
    exportId: string,
    workspaceId: string,
  ): Promise<{ buffer: Buffer; fileName: string }> {
    const exportRecord = await prisma.ticketExport.findFirst({
      where: { id: exportId, workspaceId },
    });
    if (!exportRecord) {
      throw notFound('Export not found');
    }

    const staleBefore = new Date(Date.now() - STALE_EXPORT_TIMEOUT_MS);
    const isStaleInProgress =
      exportRecord.status === 'IN_PROGRESS' && exportRecord.updatedAt < staleBefore;
    if (!['PENDING', 'READY', 'FAILED'].includes(exportRecord.status) && !isStaleInProgress) {
      throw conflict('Export is not available for download');
    }

    const user = await repositories.users.findById(exportRecord.requestedBy);
    if (!user || user.status !== UserStatus.ACTIVE || user.leftAt) {
      throw forbidden('Export requester is no longer an active workspace member');
    }
    if (user.workspaceId !== workspaceId) {
      throw forbidden('Workspace mismatch');
    }

    const claimedExport = await prisma.ticketExport.updateMany({
      where: {
        id: exportId,
        workspaceId,
        OR: [
          { status: { in: ['PENDING', 'READY', 'FAILED'] } },
          { status: 'IN_PROGRESS', updatedAt: { lt: staleBefore } },
        ],
      },
      data: { status: 'IN_PROGRESS', updatedAt: new Date() },
    });
    if (claimedExport.count !== 1) {
      throw conflict('Export is already being generated');
    }

    try {
      const filters = this.normalizeFilters(exportRecord.filters);
      const exportUser: AuthenticatedUser = {
        id: user.id,
        email: user.email,
        workspaceId: user.workspaceId,
        name: user.name ?? undefined,
        role: user.role ? (user.role as WorkspaceRole) : undefined,
      };
      const permissionLevel = await this.assertCanCreateExport(exportUser, exportRecord.workspaceId);
      await this.assertWorkspaceExportEnabled(exportRecord.workspaceId);
      await this.assertScopeAllowed(exportUser, permissionLevel, filters.projectId);
      await this.validateFilterScope(exportRecord.workspaceId, filters);
      await this.assertSourceContextAllowed(exportUser, filters);

      const ctx: ExportContext = {
        exportRecord: exportRecord as ExportContext['exportRecord'],
        user: exportUser,
        permissionLevel,
      };

      const workspace = await prisma.workspace.findUnique({ where: { id: exportRecord.workspaceId } });
      if (!workspace) {
        throw notFound('Workspace not found');
      }

      const tickets = await this.fetchVisibleTickets(ctx, filters);
      if (tickets.length === 0) {
        throw badRequest('No tickets found for the selected filters');
      }
      const ticketsByBoard = this.groupTicketsByBoard(tickets);

      const links: TicketExportLink[] = [];
      let linkedTicketsByBoard: Map<string, { board: TicketExportTicket['board']; tickets: TicketExportTicket[] }> | undefined;

      if (filters.includeLinkedTickets) {
        const { links: foundLinks, linkedTickets } = await this.buildLinkedTicketData(
          ctx,
          tickets,
          filters.includeLinkedTicketDetails,
        );
        links.push(...foundLinks);
        if (filters.includeLinkedTicketDetails && linkedTickets.length > 0) {
          linkedTicketsByBoard = this.groupTicketsByBoard(linkedTickets);
        }
      }

      let activities: TicketExportActivity[] = [];
      if (filters.includeActivity) {
        activities = await this.buildActivityData(ctx, tickets);
      }

      const generatedAt = new Date();
      const workbook = ticketReportXlsxBuilder.buildWorkbook({
        exportId,
        workspaceName: workspace.name,
        projectScope: filters.projectId
          ? tickets.find(ticket => ticket.projectId === filters.projectId)?.project?.name ?? filters.projectId
          : 'Entire workspace',
        generatedAt,
        generatedBy: ctx.user.name || ctx.user.email,
        filters: filters as Record<string, unknown>,
        includeLinks: filters.includeLinkedTickets,
        includeActivity: filters.includeActivity,
        ticketsByBoard,
        links,
        linkedTicketsByBoard,
        activities,
        columnsByBoard: filters.columnsByBoard,
      });

      const buffer = XLSX.write(workbook, { bookType: 'xlsx', type: 'buffer' });
      if (buffer.length === 0) {
        throw new Error('Generated workbook is empty');
      }

      const fileName = `ticket-report-${workspace.name}-${formatFileStamp(new Date())}.xlsx`.replace(/[^a-zA-Z0-9._-]/g, '_');
      await prisma.ticketExport.updateMany({
        where: { id: exportId, workspaceId },
        data: { status: 'READY', updatedAt: new Date() },
      });
      logger.info(`[TicketReportService] Export ${exportId} generated for direct download: ${buffer.length} bytes`);
      return { buffer, fileName };
    } catch (error) {
      await prisma.ticketExport.updateMany({
        where: { id: exportId, workspaceId },
        data: { status: 'FAILED', updatedAt: new Date() },
      });
      throw error;
    }
  }

  async listExports(user: AuthenticatedUser, page = 1, pageSize = 20) {
    await this.assertHasExportResourceAccess(user, 'READ');
    const skip = (Math.max(page, 1) - 1) * Math.min(Math.max(pageSize, 1), 100);
    const take = Math.min(Math.max(pageSize, 1), 100);

    const [items, total] = await Promise.all([
      prisma.ticketExport.findMany({
        where: { workspaceId: user.workspaceId, requestedBy: user.id },
        orderBy: { createdAt: 'desc' },
        skip,
        take,
      }),
      prisma.ticketExport.count({ where: { workspaceId: user.workspaceId, requestedBy: user.id } }),
    ]);

    return {
      items: items.map(r => this.sanitizeExportRecord(r)),
      total,
      page,
      pageSize: take,
    };
  }

  async downloadExport(input: DownloadTicketExportRequestInput, user: AuthenticatedUser) {
    const record =
      'exportId' in input
        ? await prisma.ticketExport.findFirst({
            where: {
              id: input.exportId,
              workspaceId: user.workspaceId,
              requestedBy: user.id,
            },
          })
        : await this.requestExport(input, user);

    if (!record) {
      throw notFound('Export not found');
    }

    const filters = this.normalizeFilters(record.filters);
    await this.assertCanAccessExport(user, record.workspaceId, filters.projectId ?? null);
    return this.generateExport(record.id, record.workspaceId);
  }

  private async assertCanCreateExport(
    user: AuthenticatedUser,
    _workspaceId: string,
  ): Promise<TicketExportPermissionLevel> {
    return this.assertHasExportResourceAccess(user, 'WRITE');
  }

  private async assertCanAccessExport(
    user: AuthenticatedUser,
    _workspaceId: string,
    projectId: string | null,
  ): Promise<void> {
    const permissionLevel = await this.assertHasExportResourceAccess(user, 'READ');
    await this.assertScopeAllowed(user, permissionLevel, projectId ?? undefined);
  }

  private async assertHasExportResourceAccess(
    user: AuthenticatedUser,
    requiredAccess: 'READ' | 'WRITE',
  ): Promise<TicketExportPermissionLevel> {
    const activeMember = await prisma.user.findFirst({
      where: {
        id: user.id,
        workspaceId: user.workspaceId,
        status: UserStatus.ACTIVE,
        leftAt: null,
      },
      select: { id: true },
    });
    if (!activeMember) {
      throw forbidden('Only active workspace members can access ticket exports');
    }

    const resource = await prisma.resource.findUnique({
      where: { name: TICKET_REPORT_RESOURCE_NAME },
      select: { id: true },
    });
    if (!resource) {
      throw new AppError('Export permission resource not configured', 500);
    }

    const [hasAdmin, hasWrite, hasRead] = await Promise.all([
      repositories.resourceAccess.hasAccess(user.id, resource.id, AccessType.ADMIN),
      repositories.resourceAccess.hasAccess(user.id, resource.id, AccessType.WRITE),
      repositories.resourceAccess.hasAccess(user.id, resource.id, AccessType.READ),
    ]);

    if (requiredAccess === 'WRITE' && !hasWrite) {
      throw forbidden('You do not have permission to export tickets');
    }
    if (requiredAccess === 'READ' && !(hasRead || hasWrite)) {
      throw forbidden('You do not have permission to access ticket exports');
    }
    return hasAdmin ? 'ADMIN' : hasWrite ? 'WRITE' : 'READ';
  }

  private async assertWorkspaceExportEnabled(workspaceId: string): Promise<void> {
    const workspace = await prisma.workspace.findUnique({
      where: { id: workspaceId },
      select: { status: true, metadata: true },
    });
    if (!workspace || workspace.status !== 'ACTIVE') {
      throw forbidden('Workspace is not active');
    }
    const metadata = this.asRecord(workspace.metadata);
    if (metadata.ticketExportEnabled === false) {
      throw forbidden('Ticket export is disabled for this workspace');
    }
  }

  private async assertScopeAllowed(
    user: AuthenticatedUser,
    permissionLevel: TicketExportPermissionLevel,
    projectId?: string,
  ): Promise<void> {
    if (permissionLevel === 'ADMIN') return;
    if (!projectId) {
      throw badRequest('Project scope is required for project-level ticket export permission');
    }
    if (!(await this.isProjectMemberOrCreator(user, projectId))) {
      throw forbidden('You do not have ticket export permission for the selected project');
    }
  }

  private async isProjectMemberOrCreator(
    user: AuthenticatedUser,
    projectId: string,
  ): Promise<boolean> {
    const project = await prisma.project.findFirst({
      where: {
        id: projectId,
        workspaceId: user.workspaceId,
        OR: [
          { createdBy: user.id },
          { channels: { some: { participants: { some: { userId: user.id } } } } },
        ],
      },
      select: { id: true },
    });
    return Boolean(project);
  }

  private async validateFilterScope(
    workspaceId: string,
    filters: TicketExportFilters,
  ): Promise<void> {
    if (filters.projectId) {
      const project = await prisma.project.findFirst({
        where: { id: filters.projectId, workspaceId, type: { not: ProjectType.DM } },
        select: { id: true },
      });
      if (!project) throw notFound('Project not found in workspace');
    }
    if (filters.boardIds?.length) {
      const uniqueBoardIds = [...new Set(filters.boardIds)];
      const validBoards = await prisma.board.count({
        where: {
          id: { in: uniqueBoardIds },
          workspaceId,
          ...(filters.projectId ? { projectId: filters.projectId } : {}),
        },
      });
      if (validBoards !== uniqueBoardIds.length) {
        throw badRequest('One or more boards are invalid for the selected scope');
      }
    }
  }

  private async assertSourceContextAllowed(
    user: AuthenticatedUser,
    filters: TicketExportFilters,
  ): Promise<void> {
    if (!filters.sourceChannelId) return;
    if (!filters.projectId) {
      throw badRequest('Channel-origin exports must be restricted to the linked project');
    }

    const channel = await prisma.channel.findFirst({
      where: {
        id: filters.sourceChannelId,
        workspaceId: user.workspaceId,
        projectId: filters.projectId,
        participants: { some: { userId: user.id } },
      },
      select: { id: true },
    });
    if (!channel) {
      throw forbidden(
        'You are no longer a member of this channel or it is not linked to the selected project',
      );
    }
  }

  private normalizeFilters(raw: unknown): TicketExportFilters {
    let value = raw;
    if (typeof raw === 'string') {
      try {
        value = JSON.parse(raw) as unknown;
      } catch {
        value = {};
      }
    }
    const parsed = ticketExportFiltersSchema.safeParse(value);
    return parsed.success ? parsed.data : ticketExportFiltersSchema.parse({});
  }

  private buildTicketWhere(
    workspaceId: string,
    filters: TicketExportFilters,
  ): Prisma.TicketWhereInput {
    const where: Prisma.TicketWhereInput = { workspaceId };

    if (filters.projectId) {
      where.projectId = filters.projectId;
    }
    if (filters.boardIds && filters.boardIds.length > 0) {
      where.boardId = { in: filters.boardIds };
    }
    if (filters.dateRange?.from || filters.dateRange?.to) {
      where.createdAt = {};
      if (filters.dateRange.from) where.createdAt.gte = filters.dateRange.from;
      if (filters.dateRange.to) where.createdAt.lte = filters.dateRange.to;
    }
    if (filters.statuses && filters.statuses.length > 0) {
      where.statusV2 = { in: filters.statuses as TicketStatusV2[] };
    }
    if (filters.priorities && filters.priorities.length > 0) {
      where.priority = { in: filters.priorities as TicketPriority[] };
    }
    if (filters.assignees && filters.assignees.length > 0) {
      where.assignedTo = { in: filters.assignees };
    }
    if (filters.tags && filters.tags.length > 0) {
      where.tags = {
        some: {
          OR: [{ id: { in: filters.tags } }, { name: { in: filters.tags } }],
        },
      };
    }
    if (!filters.includeArchived) {
      where.isArchived = false;
    }

    return where;
  }

  private async fetchVisibleTickets(ctx: ExportContext, filters: TicketExportFilters): Promise<TicketExportTicket[]> {
    const where = this.buildVisibleTicketWhere(ctx.exportRecord.workspaceId, filters, ctx.user.id);

    const tickets = await prisma.ticket.findMany({
      where,
      take: MAX_EXPORT_ROWS + 1,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      include: ticketExportInclude,
    });

    if (tickets.length > MAX_EXPORT_ROWS) {
      throw badRequest(`Export exceeds maximum limit of ${MAX_EXPORT_ROWS.toLocaleString()} tickets`);
    }

    const enriched = await this.enrichCustomFields(tickets, ctx.exportRecord.workspaceId);
    return enriched;
  }

  private buildVisibleTicketWhere(
    workspaceId: string,
    filters: TicketExportFilters,
    userId: string,
  ): Prisma.TicketWhereInput {
    return {
      AND: [
        this.buildTicketWhere(workspaceId, filters),
        {
          OR: [
            { channel: { visibility: { not: 'PRIVATE' } } },
            {
              channel: {
                visibility: 'PRIVATE',
                participants: { some: { userId } },
              },
            },
          ],
        },
      ],
    };
  }

  private async applyPrivateChannelVisibility<
    T extends { channelId: string; channel: { visibility: string } | null },
  >(
    userId: string,
    tickets: T[],
  ): Promise<T[]> {
    const privateChannelIds = new Set<string>();
    for (const t of tickets) {
      if (t.channel?.visibility === 'PRIVATE') {
        privateChannelIds.add(t.channelId);
      }
    }

    if (privateChannelIds.size === 0) {
      return tickets;
    }

    const memberships = await prisma.channelParticipant.findMany({
      where: { channelId: { in: Array.from(privateChannelIds) }, userId },
      select: { channelId: true },
    });
    const allowedChannelIds = new Set(memberships.map(m => m.channelId));

    return tickets.filter(t => t.channel?.visibility !== 'PRIVATE' || allowedChannelIds.has(t.channelId));
  }

  private async enrichCustomFields(
    tickets: RawExportTicket[],
    workspaceId: string,
  ): Promise<TicketExportTicket[]> {
    const ticketIds = tickets.map(t => t.id);
    const fieldValues = ticketIds.length
      ? await prisma.formEntityValues.findMany({
          where: { entityId: { in: ticketIds }, entityType: 'TICKET' },
        })
      : [];

    const fieldIds = [...new Set(fieldValues.map(fv => fv.fieldId))];
    const fieldDefs = fieldIds.length
      ? await prisma.formFields.findMany({
          where: {
            OR: [
              { id: { in: fieldIds } },
              { globalFieldId: { in: fieldIds } },
            ],
          },
          include: { globalField: true },
        })
      : [];
    const fieldById = new Map<
      string,
      { name: string; type: string | null; options: Map<string, string> }
    >();
    for (const fd of fieldDefs) {
      const field = {
        name: fd.globalField?.fieldName ?? fd.fieldName ?? fd.id,
        type: fd.globalField?.fieldType ?? fd.fieldType ?? null,
        options: this.parseFieldOptionMap(
          fd.globalField?.fieldOptions ??
            fd.fieldOptions ??
            fd.globalField?.fieldEnum ??
            fd.fieldEnum,
        ),
      };
      // Legacy values reference form_fields.id, while current values reference
      // global_fields.id through form_fields.globalFieldId. Index both forms so
      // exports remain compatible with tickets created before and after the
      // global-field migration.
      fieldById.set(fd.id, field);
      if (fd.globalFieldId) {
        fieldById.set(fd.globalFieldId, field);
      }
    }

    const userIds = new Set<string>();
    for (const fv of fieldValues) {
      const field = fieldById.get(fv.fieldId);
      if (field?.type !== 'USER') continue;
      this.flattenDisplayValues(fv.actualFieldValue ?? fv.fieldValue).forEach(value =>
        userIds.add(value),
      );
    }
    const [customFieldUsers, groups] = await Promise.all([
      userIds.size
        ? prisma.user.findMany({
            where: { id: { in: [...userIds] }, workspaceId },
            select: { id: true, name: true, displayName: true, email: true },
          })
        : [],
      prisma.userGroup.findMany({
        where: {
          id: {
            in: [...new Set(tickets.map(ticket => ticket.userGroupId).filter(Boolean) as string[])],
          },
          workspaceId,
        },
        select: { id: true, name: true },
      }),
    ]);
    const userNameById = new Map(
      customFieldUsers.map(user => [
        user.id,
        user.displayName || user.name || user.email,
      ]),
    );
    const groupById = new Map(groups.map(group => [group.id, group]));
    const valuesByTicket = new Map<string, Record<string, string | number | Date | null>>();
    for (const fv of fieldValues) {
      const field = fieldById.get(fv.fieldId);
      const name = field?.name ?? 'Unknown custom field';
      if (!name) continue;
      const existing = valuesByTicket.get(fv.entityId) ?? {};
      const raw: unknown = fv.actualFieldValue ?? fv.fieldValue;
      const values = this.flattenDisplayValues(raw).map(value =>
        redactOpaqueExportIdentifier(
          userNameById.get(value) ?? field?.options.get(value) ?? value,
        ),
      );
      existing[name] = values.length === 0 ? null : values.join(', ');
      valuesByTicket.set(fv.entityId, existing);
    }

    return tickets.map(t => ({
      ...t,
      assignee: t.assignedToUser,
      tags: t.tags.map(tt => ({ id: tt.id, name: tt.name })),
      group: t.userGroupId ? groupById.get(t.userGroupId) ?? null : null,
      customFields: valuesByTicket.get(t.id) ?? {},
    })) as TicketExportTicket[];
  }

  private groupTicketsByBoard(tickets: TicketExportTicket[]) {
    const map = new Map<string, { board: TicketExportTicket['board']; tickets: TicketExportTicket[] }>();
    for (const t of tickets) {
      const entry = map.get(t.board.id);
      if (entry) {
        entry.tickets.push(t);
      } else {
        map.set(t.board.id, { board: t.board, tickets: [t] });
      }
    }
    return map;
  }

  private async buildLinkedTicketData(ctx: ExportContext, primaryTickets: TicketExportTicket[], includeDetails: boolean) {
    const sourceTicketIds = primaryTickets.map(t => t.id);
    if (sourceTicketIds.length === 0) {
      return { links: [], linkedTickets: [] };
    }

    const [mappings, subTicketMappings] = await Promise.all([
      prisma.ticketReferenceMapping.findMany({
        where: {
          OR: [
            { sourceTicketId: { in: sourceTicketIds } },
            { targetTicketId: { in: sourceTicketIds } },
          ],
        },
      }),
      prisma.ticketSubTicketMapping.findMany({
        where: { ticketId: { in: sourceTicketIds } },
        include: {
          subTicket: {
            include: {
              mappedTicket: { include: ticketExportInclude },
            },
          },
        },
      }),
    ]);

    const targetTicketIds = [
      ...new Set(
        mappings.flatMap(mapping =>
          sourceTicketIds.includes(mapping.sourceTicketId)
            ? [mapping.targetTicketId]
            : [mapping.sourceTicketId],
        ),
      ),
    ];
    if (targetTicketIds.length === 0) {
      const mappedSubTickets = subTicketMappings
        .map(mapping => mapping.subTicket.mappedTicket)
        .filter((ticket): ticket is RawExportTicket => Boolean(ticket));
      if (mappedSubTickets.length === 0) {
        return { links: [], linkedTickets: [] };
      }
    }

    let targets = await prisma.ticket.findMany({
      where: { id: { in: targetTicketIds }, workspaceId: ctx.exportRecord.workspaceId },
      include: ticketExportInclude,
    });
    targets.push(
      ...subTicketMappings
        .map(mapping => mapping.subTicket.mappedTicket)
        .filter(
          (ticket): ticket is RawExportTicket =>
            Boolean(ticket) && !targets.some(existing => existing.id === ticket?.id),
        ),
    );

    targets = await this.applyPrivateChannelVisibility(ctx.user.id, targets);

    const visibleTargetMap = new Map(targets.map(t => [t.id, t]));
    const primaryMap = new Map(primaryTickets.map(t => [t.id, t]));

    const links: TicketExportLink[] = [];
    for (const m of mappings) {
      const primaryIsSource = primaryMap.has(m.sourceTicketId);
      const source = primaryMap.get(primaryIsSource ? m.sourceTicketId : m.targetTicketId);
      const target = visibleTargetMap.get(primaryIsSource ? m.targetTicketId : m.sourceTicketId);
      if (!target || !source) continue;
      links.push({
        sourceTicketKey: source.xyneId,
        sourceTitle: source.title,
        sourceBoardName: source.board.name,
        relationshipType: m.relationType,
        targetTicketKey: target.xyneId,
        targetTitle: target.title,
        targetBoardName: target.board.name,
        targetProjectName: target.project?.name ?? '',
        targetStatus: target.statusV2 ?? target.status,
        targetAssigneeName: target.assignedToUser?.name ?? target.assignedToUser?.email ?? '',
      });
    }
    for (const mapping of subTicketMappings) {
      const source = primaryMap.get(mapping.ticketId);
      const target = mapping.subTicket.mappedTicket
        ? visibleTargetMap.get(mapping.subTicket.mappedTicket.id)
        : undefined;
      if (!source || !target) continue;
      links.push({
        sourceTicketKey: source.xyneId,
        sourceTitle: source.title,
        sourceBoardName: source.board.name,
        relationshipType: 'SUB_TICKET',
        targetTicketKey: target.xyneId,
        targetTitle: target.title,
        targetBoardName: target.board.name,
        targetProjectName: target.project?.name ?? '',
        targetStatus: target.statusV2 ?? target.status,
        targetAssigneeName: target.assignedToUser?.name ?? target.assignedToUser?.email ?? '',
      });
    }

    let linkedTickets: TicketExportTicket[] = [];
    if (includeDetails) {
      const uniqueTargets = [...visibleTargetMap.values()];
      linkedTickets = await this.enrichCustomFields(
        uniqueTargets,
        ctx.exportRecord.workspaceId,
      );
    }

    return { links, linkedTickets };
  }

  private async buildActivityData(ctx: ExportContext, tickets: TicketExportTicket[]): Promise<TicketExportActivity[]> {
    const ticketIds = tickets.map(t => t.id);
    if (ticketIds.length === 0) return [];

    const activities = await prisma.ticketActivity.findMany({
      where: { ticketId: { in: ticketIds } },
      orderBy: { timestamp: 'desc' },
      take: MAX_ACTIVITY_ROWS + 1,
      include: { updatedByUser: true, ticket: { include: { board: true, project: true } } },
    });

    if (activities.length > MAX_ACTIVITY_ROWS) {
      throw badRequest(`Export exceeds maximum activity limit of ${MAX_ACTIVITY_ROWS.toLocaleString()} rows`);
    }

    const excludedActivityPattern = /(comment|message|attachment|email|workflow)/i;
    const allowedActivities = activities.filter(activity => {
      const value = this.asRecord(activity.value);
      return !excludedActivityPattern.test(String(value.type ?? value.activityType ?? ''));
    });
    const referencedIds = new Set<string>();
    for (const activity of allowedActivities) {
      const value = this.asRecord(activity.value);
      for (const candidate of [
        ...this.flattenDisplayValues(value.oldValue),
        ...this.flattenDisplayValues(value.newValue),
      ]) {
        referencedIds.add(candidate);
      }
    }
    const ids = [...referencedIds];
    const [users, boards, projects, channels, groups, ticketTags, projectTags, stages, referencedTickets, fields] =
      ids.length
        ? await Promise.all([
            prisma.user.findMany({
              where: { id: { in: ids }, workspaceId: ctx.exportRecord.workspaceId },
              select: { id: true, name: true, displayName: true, email: true },
            }),
            prisma.board.findMany({
              where: { id: { in: ids }, workspaceId: ctx.exportRecord.workspaceId },
              select: { id: true, name: true },
            }),
            prisma.project.findMany({
              where: { id: { in: ids }, workspaceId: ctx.exportRecord.workspaceId },
              select: { id: true, name: true },
            }),
            prisma.channel.findMany({
              where: { id: { in: ids }, workspaceId: ctx.exportRecord.workspaceId },
              select: { id: true, name: true },
            }),
            prisma.userGroup.findMany({
              where: { id: { in: ids }, workspaceId: ctx.exportRecord.workspaceId },
              select: { id: true, name: true },
            }),
            prisma.ticketTag.findMany({
              where: { id: { in: ids }, ticket: { workspaceId: ctx.exportRecord.workspaceId } },
              select: { id: true, name: true },
            }),
            prisma.projectTag.findMany({
              where: {
                id: { in: ids },
                projectId: { in: [...new Set(tickets.map(ticket => ticket.projectId))] },
              },
              select: { id: true, name: true },
            }),
            prisma.stage.findMany({
              where: {
                id: { in: ids },
                board: { workspaceId: ctx.exportRecord.workspaceId },
              },
              select: { id: true, name: true },
            }),
            prisma.ticket.findMany({
              where: { id: { in: ids }, workspaceId: ctx.exportRecord.workspaceId },
              select: { id: true, xyneId: true, title: true },
            }),
            prisma.formFields.findMany({
              where: {
                id: { in: ids },
                form: { workspaceId: ctx.exportRecord.workspaceId },
              },
              include: { globalField: true },
            }),
          ])
        : [[], [], [], [], [], [], [], [], [], []];
    const humanNameById = new Map<string, string>();
    users.forEach(user =>
      humanNameById.set(user.id, user.displayName || user.name || user.email),
    );
    for (const entities of [boards, projects, channels, groups, ticketTags, projectTags, stages]) {
      entities.forEach(entity => humanNameById.set(entity.id, entity.name));
    }
    referencedTickets.forEach(ticket =>
      humanNameById.set(ticket.id, `${ticket.xyneId} — ${ticket.title}`),
    );
    fields.forEach(field => {
      const label = field.globalField?.fieldName ?? field.fieldName;
      if (label) humanNameById.set(field.id, label);
      const optionMap = this.parseFieldOptionMap(
        field.globalField?.fieldOptions ??
          field.fieldOptions ??
          field.globalField?.fieldEnum ??
          field.fieldEnum,
      );
      optionMap.forEach((value, id) => humanNameById.set(id, value));
    });

    return allowedActivities.map(a => {
      const value = this.asRecord(a.value);
      const resolveValue = (raw: unknown): string =>
        this.flattenDisplayValues(raw)
          .map(item => humanNameById.get(item) ?? redactOpaqueExportIdentifier(item))
          .join(', ');
      return {
        ticketKey: a.ticket.xyneId,
        ticketTitle: a.ticket.title,
        projectName: a.ticket.project.name,
        boardName: a.ticket.board.name,
        timestamp: a.timestamp,
        actorName: a.updatedByUser?.name ?? a.updatedByUser?.email ?? 'System',
        activityType: String(value.type || a.activityType || ''),
        fieldChanged: value.field
          ? humanNameById.get(String(value.field)) ??
            redactOpaqueExportIdentifier(String(value.field))
          : '',
        oldValue: resolveValue(value.oldValue),
        newValue: resolveValue(value.newValue),
        visibilityResult: 'Included',
      };
    });
  }

  async getScopeOptions(user: AuthenticatedUser) {
    const permissionLevel = await this.assertHasExportResourceAccess(user, 'WRITE');
    await this.assertWorkspaceExportEnabled(user.workspaceId);
    const projectWhere: Prisma.ProjectWhereInput = {
      workspaceId: user.workspaceId,
      type: { not: ProjectType.DM },
      ...(permissionLevel === 'ADMIN'
        ? {}
        : {
            OR: [
              { createdBy: user.id },
              { channels: { some: { participants: { some: { userId: user.id } } } } },
            ],
          }),
    };
    const [projects, users] = await Promise.all([
      prisma.project.findMany({
        where: projectWhere,
        orderBy: { name: 'asc' },
        select: {
          id: true,
          name: true,
          code: true,
          boards: {
            orderBy: { name: 'asc' },
            select: { id: true, name: true, projectId: true },
          },
        },
      }),
      prisma.user.findMany({
        where: { workspaceId: user.workspaceId, status: UserStatus.ACTIVE, leftAt: null },
        orderBy: { name: 'asc' },
        select: { id: true, name: true, displayName: true, email: true },
      }),
    ]);
    const tags = await prisma.projectTag.findMany({
      where: { projectId: { in: projects.map(project => project.id) } },
      orderBy: { name: 'asc' },
      select: { id: true, name: true, projectId: true },
    });
    const boardIds = projects.flatMap(project => project.boards.map(board => board.id));
    const stages = boardIds.length
      ? await prisma.stage.findMany({
          where: { boardId: { in: boardIds } },
          select: { id: true, boardId: true },
        })
      : [];
    const stageBoardById = new Map(stages.map(stage => [stage.id, stage.boardId]));
    const contextIds = [...boardIds, ...stages.map(stage => stage.id)];
    const mappings = contextIds.length
      ? await prisma.formContextMapping.findMany({
          where: {
            contextId: { in: contextIds },
            contextType: { in: ['BOARD', 'STAGE'] },
            entityType: 'TICKET',
          },
          select: { contextId: true, contextType: true, formId: true },
        })
      : [];
    const formFields = mappings.length
      ? await prisma.formFields.findMany({
          where: { formId: { in: [...new Set(mappings.map(mapping => mapping.formId))] } },
          orderBy: [{ sequenceNumber: 'asc' }, { createdAt: 'asc' }],
          include: { globalField: true },
        })
      : [];
    const fieldsByFormId = new Map<string, typeof formFields>();
    for (const field of formFields) {
      const existing = fieldsByFormId.get(field.formId) ?? [];
      existing.push(field);
      fieldsByFormId.set(field.formId, existing);
    }
    const customFieldsByBoardId = new Map<
      string,
      Array<{ key: string; label: string; kind: 'CUSTOM'; fieldType: string }>
    >();
    for (const mapping of mappings) {
      const boardId =
        mapping.contextType === 'BOARD'
          ? mapping.contextId
          : stageBoardById.get(mapping.contextId);
      if (!boardId) continue;
      const existing = customFieldsByBoardId.get(boardId) ?? [];
      const existingKeys = new Set(existing.map(field => field.key));
      for (const field of fieldsByFormId.get(mapping.formId) ?? []) {
        const label = field.globalField?.fieldName ?? field.fieldName;
        const fieldType = field.globalField?.fieldType ?? field.fieldType;
        if (!label || !fieldType) continue;
        const key = `custom:${label}`;
        if (existingKeys.has(key)) continue;
        existing.push({ key, label, kind: 'CUSTOM', fieldType });
        existingKeys.add(key);
      }
      customFieldsByBoardId.set(boardId, existing);
    }
    const standardColumns = STANDARD_TICKET_REPORT_COLUMNS.map(column => ({
      ...column,
      kind: 'STANDARD' as const,
    }));
    return {
      permissionLevel,
      projects: projects.map(project => ({
        ...project,
        boards: project.boards.map(board => ({
          ...board,
          columns: [...standardColumns, ...(customFieldsByBoardId.get(board.id) ?? [])],
        })),
      })),
      users: users.map(option => ({
        id: option.id,
        name: option.displayName || option.name || option.email,
      })),
      tags,
      statuses: Object.values(TicketStatusV2),
      priorities: Object.values(TicketPriority),
    };
  }

  private sanitizeExportRecord(record: Awaited<ReturnType<typeof prisma.ticketExport.create>>) {
    return {
      id: record.id,
      workspaceId: record.workspaceId,
      requestedBy: record.requestedBy,
      status: record.status,
      filters: this.normalizeFilters(record.filters),
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
    };
  }

  private asRecord(value: unknown): Record<string, unknown> {
    return value && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  }

  private flattenDisplayValues(value: unknown): string[] {
    if (value === null || value === undefined || value === '') return [];
    if (Array.isArray(value)) return value.flatMap(item => this.flattenDisplayValues(item));
    if (typeof value === 'object') {
      const record = value as Record<string, unknown>;
      const preferred = record.label ?? record.name ?? record.value ?? record.id;
      return preferred === undefined
        ? [JSON.stringify(record)]
        : this.flattenDisplayValues(preferred);
    }
    if (typeof value === 'string') {
      const trimmed = value.trim();
      if (
        (trimmed.startsWith('[') && trimmed.endsWith(']')) ||
        (trimmed.startsWith('{') && trimmed.endsWith('}'))
      ) {
        try {
          return this.flattenDisplayValues(JSON.parse(trimmed));
        } catch {
          return [value];
        }
      }
    }
    return [String(value)];
  }

  private parseFieldOptionMap(value: unknown): Map<string, string> {
    const options = this.flattenDisplayOptionRecords(value);
    return new Map(options.map(option => [option.id, option.value]));
  }

  private flattenDisplayOptionRecords(value: unknown): Array<{ id: string; value: string }> {
    if (typeof value === 'string') {
      try {
        return this.flattenDisplayOptionRecords(JSON.parse(value));
      } catch {
        return [];
      }
    }
    if (!Array.isArray(value)) return [];
    return value.flatMap(option => {
      if (typeof option === 'string') return [{ id: option, value: option }];
      if (!option || typeof option !== 'object') return [];
      const record = option as Record<string, unknown>;
      const id = record.id ?? record.value;
      const label = record.value ?? record.label ?? record.name ?? record.id;
      return id === undefined || label === undefined
        ? []
        : [{ id: String(id), value: String(label) }];
    });
  }

}

export const ticketReportService = new TicketReportService();
