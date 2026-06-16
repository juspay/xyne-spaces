import { useQuery, useMutation, useQueryClient, keepPreviousData } from '@tanstack/react-query';
import type { DashboardRole } from '@xyne/shared';
import {
  listDashboards,
  getDashboard,
  listParticipants,
  createDashboard,
  createDashboardWithComponents,
  updateDashboard,
  deleteDashboard,
  addParticipants,
  removeParticipant,
  updateParticipantRole,
  createComponent,
  updateComponent,
  updateComponentPositions,
  deleteComponent,
  upsertQuery,
  deleteQuery,
  reorderQueries,
  type DashboardScope,
  type ComponentInput,
} from '../services/DynamicDashboard/dashboardCrudService';

type DashboardQueryType = 'internal' | 'external' | 'all';

// ============================================================================
// Query keys — the single source of truth for dashboard cache keys.
// `lists` is the prefix for every list query; `dashboard(id)` is the prefix for
// a dashboard's detail + participants, so invalidating it refreshes both.
// ============================================================================

export const dashboardKeys = {
  lists: ['dashboards'] as const,
  list: (scope: DashboardScope, limit: number) => ['dashboards', scope, limit] as const,
  dashboard: (id: string) => ['dashboard', id] as const,
  detail: (id: string, queryType: DashboardQueryType) => ['dashboard', id, queryType] as const,
  participants: (id: string) => ['dashboard', id, 'participants'] as const,
};

// ============================================================================
// Read hooks
// ============================================================================

export function useDashboardList(
  scope: DashboardScope,
  limit: number,
  options?: { enabled?: boolean },
) {
  return useQuery({
    queryKey: dashboardKeys.list(scope, limit),
    queryFn: () => listDashboards(scope, { limit }),
    placeholderData: keepPreviousData,
    enabled: options?.enabled ?? true,
  });
}

export function useDashboardDetail(dashboardId: string, queryType: DashboardQueryType = 'all') {
  return useQuery({
    queryKey: dashboardKeys.detail(dashboardId, queryType),
    queryFn: () => getDashboard(dashboardId, queryType),
    enabled: !!dashboardId,
  });
}

export function useDashboardParticipants(dashboardId: string, options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: dashboardKeys.participants(dashboardId),
    queryFn: () => listParticipants(dashboardId),
    enabled: options?.enabled ?? !!dashboardId,
  });
}

// ============================================================================
// Dashboard-level mutations (create / delete invalidate the lists; update
// invalidates the one dashboard's detail + participants).
// ============================================================================

export function useDashboardMutations() {
  const queryClient = useQueryClient();
  const invalidateLists = (): void => {
    void queryClient.invalidateQueries({ queryKey: dashboardKeys.lists });
  };

  const create = useMutation({
    mutationFn: (input: Parameters<typeof createDashboard>[0]) => createDashboard(input),
    onSuccess: invalidateLists,
  });

  const createWithComponents = useMutation({
    mutationFn: (input: Parameters<typeof createDashboardWithComponents>[0]) =>
      createDashboardWithComponents(input),
    onSuccess: invalidateLists,
  });

  const remove = useMutation({
    mutationFn: (id: string) => deleteDashboard(id),
    onSuccess: invalidateLists,
  });

  return { create, createWithComponents, remove };
}

export function useUpdateDashboard(dashboardId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (patch: Parameters<typeof updateDashboard>[1]) =>
      updateDashboard(dashboardId, patch),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: dashboardKeys.dashboard(dashboardId) });
    },
  });
}

// ============================================================================
// Participant mutations
// ============================================================================

export function useParticipantMutations(dashboardId: string) {
  const queryClient = useQueryClient();
  const invalidate = (): void => {
    void queryClient.invalidateQueries({ queryKey: dashboardKeys.dashboard(dashboardId) });
  };

  const add = useMutation({
    mutationFn: (participants: { userId: string; role: DashboardRole }[]) =>
      addParticipants(dashboardId, participants),
    onSuccess: invalidate,
  });

  const remove = useMutation({
    mutationFn: (userId: string) => removeParticipant(dashboardId, userId),
    onSuccess: invalidate,
  });

  const updateRole = useMutation({
    mutationFn: ({ userId, role }: { userId: string; role: DashboardRole }) =>
      updateParticipantRole(dashboardId, userId, role),
    onSuccess: invalidate,
  });

  return { add, remove, updateRole };
}

// ============================================================================
// Tile/component + saved-query mutations (all invalidate the dashboard).
// ============================================================================

export function useComponentMutations(dashboardId: string) {
  const queryClient = useQueryClient();
  const invalidate = (): void => {
    void queryClient.invalidateQueries({ queryKey: dashboardKeys.dashboard(dashboardId) });
  };

  const create = useMutation({
    mutationFn: (input: ComponentInput & { sequence?: number }) =>
      createComponent(dashboardId, input),
    onSuccess: invalidate,
  });

  const update = useMutation({
    mutationFn: ({
      queryId,
      patch,
    }: {
      queryId: string;
      patch: Parameters<typeof updateComponent>[1];
    }) => updateComponent(queryId, patch),
    onSuccess: invalidate,
  });

  const updatePositions = useMutation({
    mutationFn: (updates: { id: string; position: string }[]) =>
      updateComponentPositions(dashboardId, updates),
    onSuccess: invalidate,
  });

  const remove = useMutation({
    mutationFn: (queryId: string) => deleteComponent(queryId),
    onSuccess: invalidate,
  });

  return { create, update, updatePositions, remove };
}

export function useQueryMutations(dashboardId: string) {
  const queryClient = useQueryClient();
  const invalidate = (): void => {
    void queryClient.invalidateQueries({ queryKey: dashboardKeys.dashboard(dashboardId) });
  };

  const upsert = useMutation({
    mutationFn: (input: Parameters<typeof upsertQuery>[0]) => upsertQuery(input),
    onSuccess: invalidate,
  });

  const remove = useMutation({
    mutationFn: (id: string) => deleteQuery(id),
    onSuccess: invalidate,
  });

  const reorder = useMutation({
    mutationFn: (orderedMappingIds: string[]) => reorderQueries(dashboardId, orderedMappingIds),
    onSuccess: invalidate,
  });

  return { upsert, remove, reorder };
}
