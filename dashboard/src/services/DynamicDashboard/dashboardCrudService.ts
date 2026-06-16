import type {
  DynamicDashboard as Dashboard,
  DashboardParticipant,
  DynamicDashboardQueryMapping as DashboardQueryMapping,
  DashboardRole,
  DashboardVisibility,
  DynamicDashboardQuery as Query,
} from '@xyne/shared';
import { apiInstance } from '../clients/apiClient';

export interface DashboardTile {
  mapping: DashboardQueryMapping;
  query: Query;
}

export interface DashboardDetail {
  dashboard: Dashboard;
  participants: DashboardParticipant[];
  tiles: DashboardTile[];
}

export type DashboardScope = 'mine' | 'shared' | 'all';

export interface DashboardListResult {
  dashboards: Dashboard[];
  total: number;
  hasMore: boolean;
}

export async function listDashboards(
  scope: DashboardScope = 'all',
  opts: { limit?: number; offset?: number } = {},
): Promise<DashboardListResult> {
  const { data } = await apiInstance.get<DashboardListResult>('/dashboards', {
    params: { scope, limit: opts.limit, offset: opts.offset },
  });
  return data;
}

export async function getDashboard(
  id: string,
  queryType: 'internal' | 'external' | 'all' = 'all',
): Promise<DashboardDetail> {
  const { data } = await apiInstance.get<DashboardDetail>(`/dashboards/${id}`, {
    params: { queryType },
  });
  return data;
}

export async function listParticipants(dashboardId: string): Promise<DashboardParticipant[]> {
  const { data } = await apiInstance.get<{ participants: DashboardParticipant[] }>(
    `/dashboards/${dashboardId}/participants`,
  );
  return data.participants;
}

export async function createDashboard(input: {
  name: string;
  description?: string | undefined;
  visibility?: DashboardVisibility | undefined;
}): Promise<Dashboard> {
  const { data } = await apiInstance.post<{ dashboard: Dashboard }>('/dashboards', input);
  return data.dashboard;
}

export interface ComponentInput {
  visualType: string;
  title?: string | undefined;
  queryJson: unknown;
  position: string;
  config?: string | undefined;
}

export async function createDashboardWithComponents(input: {
  name: string;
  description?: string | undefined;
  visibility?: DashboardVisibility | undefined;
  components: ComponentInput[];
}): Promise<Dashboard> {
  const { data } = await apiInstance.post<{ dashboard: Dashboard }>(
    '/dashboards/with-components',
    input,
  );
  return data.dashboard;
}

export async function updateDashboard(
  id: string,
  patch: {
    name?: string | undefined;
    description?: string | undefined;
    visibility?: DashboardVisibility | undefined;
    config?: string | undefined;
  },
): Promise<Dashboard> {
  const { data } = await apiInstance.patch<{ dashboard: Dashboard }>(`/dashboards/${id}`, patch);
  return data.dashboard;
}

export async function deleteDashboard(id: string): Promise<void> {
  await apiInstance.delete(`/dashboards/${id}`);
}

// ---- participants ----
export async function addParticipants(
  dashboardId: string,
  participants: { userId: string; role: DashboardRole }[],
): Promise<DashboardParticipant[]> {
  const { data } = await apiInstance.post<{ participants: DashboardParticipant[] }>(
    `/dashboards/${dashboardId}/participants`,
    { participants },
  );
  return data.participants;
}

export async function removeParticipant(dashboardId: string, userId: string): Promise<void> {
  await apiInstance.delete(`/dashboards/${dashboardId}/participants/${userId}`);
}

export async function updateParticipantRole(
  dashboardId: string,
  userId: string,
  role: DashboardRole,
): Promise<DashboardParticipant> {
  const { data } = await apiInstance.patch<{ participant: DashboardParticipant }>(
    `/dashboards/${dashboardId}/participants/${userId}`,
    { role },
  );
  return data.participant;
}

// ---- tiles / components ----
export async function createComponent(
  dashboardId: string,
  input: ComponentInput & { sequence?: number },
): Promise<DashboardTile> {
  const { data } = await apiInstance.post<DashboardTile>(
    `/dashboards/${dashboardId}/components`,
    input,
  );
  return data;
}

export async function updateComponent(
  queryId: string,
  patch: {
    visualType?: string | undefined;
    title?: string | undefined;
    queryJson?: unknown;
    position?: string | undefined;
    config?: string | undefined;
  },
): Promise<Query> {
  const { data } = await apiInstance.patch<{ query: Query }>(
    `/dashboards/components/${queryId}`,
    patch,
  );
  return data.query;
}

export async function updateComponentPositions(
  dashboardId: string,
  updates: { id: string; position: string }[],
): Promise<void> {
  await apiInstance.patch(`/dashboards/${dashboardId}/components/positions`, {
    updates,
  });
}

export async function deleteComponent(queryId: string): Promise<void> {
  await apiInstance.delete(`/dashboards/components/${queryId}`);
}

// ---- saved queries (QueryBuilder) ----
export async function upsertQuery(input: {
  id?: string | undefined;
  title: string;
  queryJson: unknown;
  entityType?: string | undefined;
  targetEntity?: string | undefined;
  visualType?: string | undefined;
  dashboardId?: string | undefined;
  queryType?: 'internal' | 'external' | undefined;
}): Promise<Query> {
  const { data } = await apiInstance.post<{ query: Query }>('/dashboards/queries', input);
  return data.query;
}

export async function deleteQuery(id: string): Promise<void> {
  await apiInstance.delete(`/dashboards/queries/${id}`);
}

export async function reorderQueries(
  dashboardId: string,
  orderedMappingIds: string[],
): Promise<void> {
  await apiInstance.patch(`/dashboards/${dashboardId}/queries/reorder`, {
    orderedMappingIds,
  });
}
