import { z } from 'zod';
import { transaction } from '../base';
import { notFound, forbidden } from '@/controllers/dashboardController';
import { db } from '@/database/client';
import { assertDashboardEditAccess, assertNoDashboardNameClash, resolveDashboardAccess } from '@/services/dynamicDashboard/componentWrites';
import { DashboardVisibility, DashboardRole, QueryType, QueryVisualizationType as SharedVisualizationType } from '@xyne/shared';


export function createDashboardTxTx(ctx: { userId: string; workspaceId: string; }, trimmedName: string, data: { name: string; description?: string | undefined; visibility?: DashboardVisibility | undefined; }, components: { visualType: string; position: string; title?: string | undefined; queryJson?: any; config?: string | undefined; }[]) {
  return transaction(['DashboardParticipant', 'DynamicDashboard', 'DynamicDashboardQuery', 'DynamicDashboardQueryMapping'], 'createDashboardTx: dashboard, owner participant, query and mapping rows must commit atomically; tx is not ACL-wrapped', db, async (tx) => {
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
export function removeTx(id: string, ctx: { userId: string; workspaceId: string; }) {
  return transaction(['DashboardParticipant', 'DynamicDashboard', 'DynamicDashboardQuery', 'DynamicDashboardQueryMapping'], 'remove: dashboard plus mappings, queries and participant deletes must commit atomically; tx is not ACL-wrapped', db, async (tx) => {
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
}
export function addParticipantsTx(dashboardId: string, ctx: { userId: string; workspaceId: string; }, parsed: z.SafeParseSuccess<{ participants: { userId: string; role: DashboardRole; }[]; }>) {
  return transaction(['DashboardParticipant', 'DynamicDashboard', 'User'], 'addParticipants: dashboard access check plus participant inserts must commit atomically; tx is not ACL-wrapped', db, async (tx) => {
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
}
export function removeParticipantTx(dashboardId: string, ctx: { userId: string; workspaceId: string; }, targetUserId: string) {
  return transaction(['DashboardParticipant', 'DynamicDashboard'], 'removeParticipant: dashboard access check plus participant delete must commit atomically; tx is not ACL-wrapped', db, async (tx) => {
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
}
export function updateParticipantRoleTx(dashboardId: string, ctx: { userId: string; workspaceId: string; }, targetUserId: string, role: DashboardRole) {
  return transaction(['DashboardParticipant', 'DynamicDashboard'], 'updateParticipantRole: dashboard access check plus participant role update must commit atomically; tx is not ACL-wrapped', db, async (tx) => {
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
}
export function updatePositionsTx(dashboardId: string, ctx: { userId: string; workspaceId: string; }, parsed: z.SafeParseSuccess<{ updates: { id: string; position: string; }[]; }>) {
  return transaction(['DashboardParticipant', 'DynamicDashboard', 'DynamicDashboardQuery', 'DynamicDashboardQueryMapping'], 'updatePositions: tile membership check plus query position updates must commit atomically; tx is not ACL-wrapped', db, async (tx) => {
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
}
export function aiCreateTx(dashboardId: string, userId: string, workspaceId: string) {
  return transaction(['DashboardParticipant', 'DynamicDashboard'], 'aiCreate: dashboard edit-access check must run inside the tx snapshot; tx is not ACL-wrapped', db, (tx) =>
    assertDashboardEditAccess(tx, dashboardId, userId, workspaceId),
  );
}
