import type {
  DashboardVisibility,
  DashboardRole,
  FormEntityType,
  QueryVisualizationType,
} from '../zero/schema';

export type DynamicDashboard = {
  id: string;
  workspaceId: string;
  name: string;
  description?: string;
  createdBy: string;
  visibility: DashboardVisibility;
  config: string;
  createdAt: number;
  updatedAt: number;
};

export type DashboardParticipant = {
  id: string;
  dashboardId: string;
  userId: string;
  role: DashboardRole;
  joinedAt: number;
  updatedAt: number;
};

export type DynamicDashboardQuery = {
  id: string;
  title?: string;
  queryType: string; // 'internal' | 'external'
  queryJson: unknown;
  entityType?: FormEntityType;
  targetEntity?: string;
  visualType?: QueryVisualizationType;
  position: string;
  config: string;
  createdBy: string;
  createdAt: number;
  updatedAt: number;
};

export type DynamicDashboardQueryMapping = {
  id: string;
  dashboardId: string;
  queryId: string;
  sequence: number;
  createdAt: number;
  updatedAt: number;
};
