import { Prisma } from '@prisma/client';
import {
  defaultSizeFor,
  nextOpenPosition,
  DashboardRole,
  DashboardVisibility } from '@xyne/shared';
import { db } from '@/database/client';
import { AppError } from '@/middleware/errorHandler';
import { createDashboardComponentTx } from '@/bypassAcl/transactions/componentWrites';
import { updateDashboardComponentTx } from '@/bypassAcl/transactions/componentWrites';
import { deleteDashboardComponentTx } from '@/bypassAcl/transactions/componentWrites';
import { setDashboardMetaTx } from '@/bypassAcl/transactions/componentWrites';

// Transactional dashboard/component writes shared by the browser-facing CRUD
// routes (DashboardController) and the AI tool endpoints
// (DashboardClawController). All functions throw AppError with the proper
// HTTP status (403/404/409) — callers translate as needed.

export const notFound = (message: string): AppError => new AppError(message, 404);
export const forbidden = (message: string): AppError => new AppError(message, 403);
const conflict = (message: string): AppError => new AppError(message, 409);

type Tx = Prisma.TransactionClient;
export type QueryRow = Prisma.DynamicDashboardQueryGetPayload<{}>;
export type MappingRow = Prisma.DynamicDashboardQueryMappingGetPayload<{}>;
type DashboardRow = Prisma.DynamicDashboardGetPayload<{}>;

export interface WriteContext {
  userId: string;
  workspaceId: string;
}

// Returns { isOwner, isEditor } for the requesting user on a dashboard.
export async function resolveDashboardAccess(
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

// True when the user may VIEW the dashboard: creator, PUBLIC, or any
// participant. Shared read-ACL for the browser controllers.
export async function userCanReadDashboard(
  dashboard: { id: string; createdBy: string; visibility: DashboardVisibility },
  userId: string,
): Promise<boolean> {
  if (dashboard.createdBy === userId) return true;
  if (dashboard.visibility === DashboardVisibility.PUBLIC) return true;
  const participant = await db.dashboardParticipant.findUnique({
    where: { dashboardId_userId: { dashboardId: dashboard.id, userId } },
  });
  return participant !== null;
}

// Throws unless the user is creator OR an OWNER/EDITOR participant. Used to
// gate tile/component and query writes (port of assertDashboardEditAccess).
export async function assertDashboardEditAccess(
  tx: Tx,
  dashboardId: string,
  userId: string,
  workspaceId: string,
): Promise<void> {
  const dashboard = await tx.dynamicDashboard.findUnique({ where: { id: dashboardId } });
  if (!dashboard || dashboard.workspaceId !== workspaceId) {
    throw notFound('Dashboard not found');
  }
  const { isOwner, isEditor } = await resolveDashboardAccess(tx, dashboard, userId);
  if (!isOwner && !isEditor) {
    throw forbidden('You do not have permission to edit this dashboard');
  }
}

export async function resolveDashboardIdForQuery(tx: Tx, queryId: string): Promise<string> {
  const mapping = await tx.dynamicDashboardQueryMapping.findFirst({ where: { queryId } });
  if (!mapping) {
    throw notFound(`Component ${queryId} is not linked to a dashboard`);
  }
  return mapping.dashboardId;
}

export interface CreateComponentInput {
  visualType: string;
  title?: string | undefined;
  // z.any() in the route schema types this as optional; the DB column is
  // required, so a missing value still fails at the Prisma layer (as before).
  queryJson?: unknown;
  position?: string | undefined;
  config?: string | undefined;
  sequence?: number | undefined;
}

export async function autoPlacePosition(
  tx: Tx,
  dashboardId: string,
  visualType: string,
): Promise<string> {
  const existing = await tx.dynamicDashboardQueryMapping.findMany({
    where: { dashboardId },
    select: { query: { select: { position: true } } },
  });
  const pos = nextOpenPosition(
    existing.map((m) => m.query.position),
    defaultSizeFor(visualType as Parameters<typeof defaultSizeFor>[0]),
  );
  return JSON.stringify(pos);
}

export async function createDashboardComponent(
  dashboardId: string,
  input: CreateComponentInput,
  ctx: WriteContext,
): Promise<{ query: QueryRow; mapping: MappingRow }> {
  return createDashboardComponentTx(dashboardId, ctx, input);
}

export interface UpdateComponentInput {
  visualType?: string | undefined;
  title?: string | undefined;
  queryJson?: unknown;
  position?: string | undefined;
  config?: string | undefined;
}

export async function updateDashboardComponent(
  queryId: string,
  input: UpdateComponentInput,
  ctx: WriteContext,
): Promise<QueryRow> {
  return updateDashboardComponentTx(queryId, ctx, input);
}

export async function deleteDashboardComponent(
  queryId: string,
  ctx: WriteContext,
): Promise<void> {
  await deleteDashboardComponentTx(queryId, ctx);
}

export async function assertNoDashboardNameClash(
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

// Dashboard meta update — the ONE implementation of the meta permission
// rules, shared by the browser PATCH /api/dashboards/:id and the AI's
// set_dashboard_meta tool: editors may change description/config; only
// owners may rename or change visibility; renames must not clash.
export async function setDashboardMeta(
  dashboardId: string,
  meta: {
    name?: string | undefined;
    description?: string | undefined;
    visibility?: DashboardVisibility | undefined;
    config?: string | undefined;
  },
  ctx: WriteContext,
): Promise<DashboardRow> {
  const { name, description, visibility, config } = meta;
  return setDashboardMetaTx(dashboardId, ctx, name, visibility, config, description);
}

