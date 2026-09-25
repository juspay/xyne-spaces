import { transaction } from '../base';
import { db } from '@/database/client';
import { WriteContext, CreateComponentInput, assertDashboardEditAccess, autoPlacePosition, resolveDashboardIdForQuery, UpdateComponentInput, resolveDashboardAccess, notFound, forbidden, assertNoDashboardNameClash } from '@/services/dynamicDashboard/componentWrites';
import { Prisma } from '@prisma/client';
import { parseDashboardConfig, DashboardVisibility, QueryType, QueryVisualizationType } from '@xyne/shared';


export function createDashboardComponentTx(dashboardId: string, ctx: WriteContext, input: CreateComponentInput) {
  return transaction(['DashboardParticipant', 'DynamicDashboard', 'DynamicDashboardQuery', 'DynamicDashboardQueryMapping'], 'createDashboardComponent: dashboard access check, query creation and mapping must commit atomically; tx is not ACL-wrapped', db, async (tx) => {
    await assertDashboardEditAccess(tx, dashboardId, ctx.userId, ctx.workspaceId);
    const position =
      input.position ?? (await autoPlacePosition(tx, dashboardId, input.visualType));
    const query = await tx.dynamicDashboardQuery.create({
      data: {
        title: input.title ?? null,
        queryType: QueryType.external,
        queryJson: input.queryJson as Prisma.InputJsonValue,
        visualType: input.visualType as QueryVisualizationType,
        position,
        config: input.config ?? '{}',
        createdBy: ctx.userId,
        workspaceId: ctx.workspaceId,
      },
    });
    const mapping = await tx.dynamicDashboardQueryMapping.create({
      data: { dashboardId, queryId: query.id, sequence: input.sequence ?? 0, workspaceId: ctx.workspaceId },
    });
    return { query, mapping };
  });
}
export function updateDashboardComponentTx(queryId: string, ctx: WriteContext, input: UpdateComponentInput) {
  return transaction(['DashboardParticipant', 'DynamicDashboard', 'DynamicDashboardQuery', 'DynamicDashboardQueryMapping'], 'updateDashboardComponent: dashboard access check and query update must commit atomically; tx is not ACL-wrapped', db, async (tx) => {
    const dashboardId = await resolveDashboardIdForQuery(tx, queryId);
    await assertDashboardEditAccess(tx, dashboardId, ctx.userId, ctx.workspaceId);
    return tx.dynamicDashboardQuery.update({
      where: { id: queryId },
      data: {
        ...(input.visualType !== undefined && {
          visualType: input.visualType as QueryVisualizationType,
        }),
        ...(input.title !== undefined && { title: input.title }),
        ...(input.queryJson !== undefined && {
          queryJson: input.queryJson as Prisma.InputJsonValue,
        }),
        ...(input.position !== undefined && { position: input.position }),
        ...(input.config !== undefined && { config: input.config }),
      },
    });
  });
}
export function deleteDashboardComponentTx(queryId: string, ctx: WriteContext) {
  return transaction(['DashboardParticipant', 'DynamicDashboard', 'DynamicDashboardQuery', 'DynamicDashboardQueryMapping'], 'deleteDashboardComponent: dashboard access check with mapping and query delete must commit atomically; tx is not ACL-wrapped', db, async (tx) => {
    const dashboardId = await resolveDashboardIdForQuery(tx, queryId);
    await assertDashboardEditAccess(tx, dashboardId, ctx.userId, ctx.workspaceId);
    await tx.dynamicDashboardQueryMapping.deleteMany({ where: { queryId } });
    await tx.dynamicDashboardQuery.delete({ where: { id: queryId } });
  });
}
export function setDashboardMetaTx(dashboardId: string, ctx: WriteContext, name: string | undefined, visibility: DashboardVisibility | undefined, config: string | undefined, description: string | undefined) {
  return transaction(['DashboardParticipant', 'DynamicDashboard'], 'setDashboardMeta: dashboard access check, name-clash check and meta update must commit atomically; tx is not ACL-wrapped', db, async (tx) => {
    const dashboard = await tx.dynamicDashboard.findUnique({ where: { id: dashboardId } });
    if (!dashboard || dashboard.workspaceId !== ctx.workspaceId) {
      throw notFound('Dashboard not found');
    }
    const { isOwner, isEditor } = await resolveDashboardAccess(tx, dashboard, ctx.userId);
    if (!isOwner && !isEditor) {
      throw forbidden('You do not have permission to edit this dashboard');
    }
    if (!isOwner && (name !== undefined || visibility !== undefined)) {
      throw forbidden('Only dashboard owners can rename or change visibility');
    }
    if (name !== undefined) {
      const trimmedName = name.trim();
      if (trimmedName !== dashboard.name) {
        await assertNoDashboardNameClash(tx, dashboard.workspaceId, trimmedName, dashboardId);
      }
    }
    if (config !== undefined) parseDashboardConfig(config);
    return tx.dynamicDashboard.update({
      where: { id: dashboardId },
      data: {
        ...(name !== undefined && { name: name.trim() }),
        ...(description !== undefined && { description: description.trim() }),
        ...(visibility !== undefined && { visibility }),
        ...(config !== undefined && { config }),
      },
    });
  });
}
