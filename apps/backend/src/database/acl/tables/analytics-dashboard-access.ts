import { PrismaClient } from '@prisma/client'
import { DashboardSharePrincipal, DashboardShareRole } from '@xyne/shared'

/*
 * Who can see and change a legacy analytics dashboard (the `dashboards` table). Mirrors
 * packages/shared/src/zero/acl/core/dashboard-access.ts:
 *   OWNER  - the creator;
 *   EDITOR - a person with an EDITOR share;
 *   VIEWER - a person with a VIEWER share, a current member of a channel it is shared with, or
 *            anyone in the workspace when it has a WORKSPACE share.
 * The `dashboards` model has no Prisma relations, so these are id lookups.
 */

export type AnalyticsDashboardRole = 'OWNER' | 'EDITOR' | 'VIEWER'

const RANK: Record<AnalyticsDashboardRole, number> = { VIEWER: 1, EDITOR: 2, OWNER: 3 }

export function roleAtLeast(role: AnalyticsDashboardRole, min: AnalyticsDashboardRole): boolean {
  return RANK[role] >= RANK[min]
}

type Client = Pick<PrismaClient, 'dashboard' | 'dashboardShare' | 'channelParticipant'>

async function memberChannelIds(client: Client, userId: string, workspaceId: string): Promise<string[]> {
  const rows = await client.channelParticipant.findMany({
    where: { userId, workspaceId },
    select: { channelId: true },
  })
  return rows.map(r => r.channelId)
}

/** Ids of dashboards shared with the user, whatever the route (person, channel, workspace). */
async function sharedWithUserDashboardIds(client: Client, userId: string, workspaceId: string): Promise<string[]> {
  const channelIds = await memberChannelIds(client, userId, workspaceId)
  const rows = await client.dashboardShare.findMany({
    where: {
      workspaceId,
      OR: [
        { principalType: DashboardSharePrincipal.WORKSPACE },
        { principalType: DashboardSharePrincipal.USER, principalId: userId },
        ...(channelIds.length > 0
          ? [{ principalType: DashboardSharePrincipal.CHANNEL, principalId: { in: channelIds } }]
          : []),
      ],
    },
    select: { dashboardId: true },
    distinct: ['dashboardId'],
  })
  return rows.map(r => r.dashboardId)
}

export async function readableDashboardIds(client: Client, userId: string, workspaceId: string): Promise<string[]> {
  const [owned, shared] = await Promise.all([
    client.dashboard.findMany({ where: { workspaceId, createdBy: userId }, select: { id: true } }),
    sharedWithUserDashboardIds(client, userId, workspaceId),
  ])
  return [...new Set([...owned.map(d => d.id), ...shared])]
}

export async function editableDashboardIds(client: Client, userId: string, workspaceId: string): Promise<string[]> {
  const [owned, edits] = await Promise.all([
    client.dashboard.findMany({ where: { workspaceId, createdBy: userId }, select: { id: true } }),
    client.dashboardShare.findMany({
      where: {
        workspaceId,
        principalType: DashboardSharePrincipal.USER,
        principalId: userId,
        role: DashboardShareRole.EDITOR,
      },
      select: { dashboardId: true },
    }),
  ])
  return [...new Set([...owned.map(d => d.id), ...edits.map(s => s.dashboardId)])]
}

/** The user's role on one dashboard, or null when it is not shared with them. */
export async function getAnalyticsDashboardRole(
  client: Client,
  dashboard: { id: string; createdBy: string; workspaceId: string },
  userId: string,
): Promise<AnalyticsDashboardRole | null> {
  if (dashboard.createdBy === userId) return 'OWNER'
  const shares = await client.dashboardShare.findMany({
    where: { dashboardId: dashboard.id, workspaceId: dashboard.workspaceId },
    select: { principalType: true, principalId: true, role: true },
  })
  const direct = shares.find(s => s.principalType === DashboardSharePrincipal.USER && s.principalId === userId)
  if (direct) return direct.role === DashboardShareRole.EDITOR ? 'EDITOR' : 'VIEWER'
  if (shares.some(s => s.principalType === DashboardSharePrincipal.WORKSPACE)) return 'VIEWER'
  const channelIds = shares.filter(s => s.principalType === DashboardSharePrincipal.CHANNEL).map(s => s.principalId)
  if (channelIds.length === 0) return null
  const member = await client.channelParticipant.findFirst({
    where: { userId, channelId: { in: channelIds } },
    select: { id: true },
  })
  return member ? 'VIEWER' : null
}
