import type { DashboardSharePrincipal, DashboardShareRole } from '@xyne/shared';
import { apiInstance } from '../clients/apiClient';

/*
 * Sharing for Xyne Dashboards (/xyne-dashboards). Shares are read through Zero
 * (dashboard_shares); changes go through these endpoints, which check channels and the
 * analytics-admin rule for sharing with the whole workspace.
 */

export interface ShareInput {
  principalType: DashboardSharePrincipal;
  /** User id or channel id; omitted for the workspace. */
  principalId?: string;
  role: DashboardShareRole;
}

const base = (dashboardId: string): string =>
  `/analytics-dashboards/${encodeURIComponent(dashboardId)}/shares`;

export async function addDashboardShares(dashboardId: string, shares: ShareInput[]): Promise<void> {
  await apiInstance.post(base(dashboardId), { shares });
}

export async function updateDashboardShareRole(
  dashboardId: string,
  shareId: string,
  role: DashboardShareRole,
): Promise<void> {
  await apiInstance.patch(`${base(dashboardId)}/${encodeURIComponent(shareId)}`, { role });
}

export async function removeDashboardShare(dashboardId: string, shareId: string): Promise<void> {
  await apiInstance.delete(`${base(dashboardId)}/${encodeURIComponent(shareId)}`);
}
