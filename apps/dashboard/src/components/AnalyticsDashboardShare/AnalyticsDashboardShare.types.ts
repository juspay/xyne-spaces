import type { DashboardShare } from '@xyne/shared';

export type AnalyticsDashboardRole = 'OWNER' | 'EDITOR' | 'VIEWER';

export interface AnalyticsDashboardShareProps {
  dashboard: { id: string; createdBy: string };
  shares: ReadonlyArray<DashboardShare>;
  role: AnalyticsDashboardRole;
}
