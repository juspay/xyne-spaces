import { useQuery, useQueryClient } from '@tanstack/react-query';
import { SDLC_ACTIVE_RUN_STATUSES } from '@xyne/shared';
import { apiInstance } from '../../services/clients/apiClient';

const ACTIVE_RUN_STATUSES: ReadonlySet<string> = new Set(SDLC_ACTIVE_RUN_STATUSES);

export type HubWorkflowPhase =
  | 'NOT_CONFIGURED'
  | 'NOT_STARTED'
  | 'RUNNING'
  | 'READY'
  | 'FAILED'
  | 'CANCELLED';

export interface HubWorkflowRun {
  id: string;
  status: string;
  updatedAt?: number | null;
}

export interface HubWorkflowState {
  phase: HubWorkflowPhase;
  workflowId?: string;
  runId?: string;
  updatedAt?: number;
}

export interface HubWorkflow extends HubWorkflowState {
  start: () => Promise<void>;
  cancel: () => Promise<void>;
}

export function hubWorkflowState(input: {
  workflowId?: string | null;
  runs?: readonly HubWorkflowRun[] | null;
}): HubWorkflowState {
  if (!input.workflowId) return { phase: 'NOT_CONFIGURED' };

  // A run Plan skipped completes at once, so an older active run still wins.
  const latest = input.runs?.find(run => ACTIVE_RUN_STATUSES.has(run.status)) ?? input.runs?.[0];
  if (!latest) return { phase: 'NOT_STARTED', workflowId: input.workflowId };

  const phase: HubWorkflowPhase = ACTIVE_RUN_STATUSES.has(latest.status)
    ? 'RUNNING'
    : latest.status === 'COMPLETED' || latest.status === 'SUCCESS' || latest.status === 'SKIPPED'
      ? 'READY'
      : latest.status === 'CANCELLED'
        ? 'CANCELLED'
        : 'FAILED';

  return {
    phase,
    workflowId: input.workflowId,
    runId: latest.id,
    ...(typeof latest.updatedAt === 'number' ? { updatedAt: latest.updatedAt } : {}),
  };
}

export function useHubWorkflow(workflowId: string | null): HubWorkflow {
  const queryClient = useQueryClient();
  const queryKey = ['sdlc-hub-workflow-runs', workflowId];
  const runs = useQuery({
    queryKey,
    queryFn: async () => {
      const response = await apiInstance.get<{
        items: { id: string; status: string; updatedAt?: string }[];
      }>('/workflows-v2/executions', { params: { workflowId, limit: 5 } });
      return response.data.items.map(run => ({
        id: run.id,
        status: run.status,
        updatedAt: run.updatedAt ? Date.parse(run.updatedAt) : null,
      }));
    },
    enabled: Boolean(workflowId),
    refetchInterval: 60_000,
  });
  const state = hubWorkflowState({ workflowId, runs: runs.data ?? null });

  return {
    ...state,
    start: async (): Promise<void> => {
      await apiInstance.post(`/workflows-v2/workflows/${workflowId}/trigger`, {});
      await queryClient.invalidateQueries({ queryKey });
    },
    cancel: async (): Promise<void> => {
      await apiInstance.post(`/workflows-v2/executions/${state.runId}/cancel`);
      await queryClient.invalidateQueries({ queryKey });
    },
  };
}
