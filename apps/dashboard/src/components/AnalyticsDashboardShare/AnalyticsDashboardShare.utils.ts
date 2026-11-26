import { DashboardSharePrincipal, DashboardShareRole, type DashboardShare } from '@xyne/shared';
import type { AnalyticsDashboardRole } from './AnalyticsDashboardShare.types';

/**
 * The viewer's role on a dashboard they can see. Zero only syncs dashboards shared with them, so
 * someone without a share row of their own reached it through a channel or the workspace and
 * can view it.
 */
export function getAnalyticsDashboardRole(
  dashboard: { createdBy: string },
  shares: ReadonlyArray<DashboardShare> | undefined,
  userId: string | undefined,
): AnalyticsDashboardRole {
  if (!userId) return 'VIEWER';
  if (dashboard.createdBy === userId) return 'OWNER';
  const own = ownShare(shares, userId);
  return own?.role === DashboardShareRole.EDITOR ? 'EDITOR' : 'VIEWER';
}

/** The share naming this user directly, if any (what "Leave" removes). */
export function ownShare(
  shares: ReadonlyArray<DashboardShare> | undefined,
  userId: string | undefined,
): DashboardShare | undefined {
  if (!userId) return undefined;
  return shares?.find(
    s => s.principalType === DashboardSharePrincipal.USER && s.principalId === userId,
  );
}

export const canEditDashboard = (role: AnalyticsDashboardRole): boolean =>
  role === 'OWNER' || role === 'EDITOR';

const ORDER: Record<DashboardSharePrincipal, number> = {
  [DashboardSharePrincipal.WORKSPACE]: 0,
  [DashboardSharePrincipal.CHANNEL]: 1,
  [DashboardSharePrincipal.USER]: 2,
};

/** Workspace first, then channels, then people; oldest first within each. */
export function sortShares(shares: ReadonlyArray<DashboardShare>): DashboardShare[] {
  return [...shares].sort(
    (a, b) => ORDER[a.principalType] - ORDER[b.principalType] || a.createdAt - b.createdAt,
  );
}

export const roleLabel = (role: DashboardShareRole): string =>
  role === DashboardShareRole.EDITOR ? 'Can edit' : 'Can view';
