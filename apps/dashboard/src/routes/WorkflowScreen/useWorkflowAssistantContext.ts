import { useEffect, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { toWorkflowDetail, wfKeys } from '@xyne/workflow-ui';
import { workflowClient } from '../../lib/workflowClient';
import { xyneAIActor, type WorkflowInfo } from '../../machines/xyneAIMachine';
import { workflowScopeFromPath } from './useWorkflowRouting';

export const useWorkflowAssistantContext = (
  path: string,
  stepId?: string | null,
): WorkflowInfo | null => {
  const scope = useMemo(() => workflowScopeFromPath(path), [path]);
  const workflowId = scope.workflowId ?? null;
  const executionId = scope.executionId ?? null;

  const { data: detail } = useQuery({
    queryKey: wfKeys.workflow(workflowId ?? ''),
    enabled: workflowId !== null,
    staleTime: Infinity,
    queryFn: async () => {
      if (workflowId === null) return null;
      return toWorkflowDetail(workflowId, await workflowClient.workflows.get(workflowId));
    },
  });

  const { data: run = null } = useQuery<WorkflowInfo | null>({
    queryKey: ['askai-run-scope', executionId],
    enabled: executionId !== null,
    staleTime: Infinity,
    queryFn: async (): Promise<WorkflowInfo | null> => {
      if (executionId === null) return null;
      const detailForRun = await workflowClient.executions.get(executionId);
      return {
        workflowId: detailForRun.workflowId,
        title: detailForRun.name ?? null,
        executionId,
      };
    },
  });

  const current = useMemo((): WorkflowInfo | null => {
    const base: WorkflowInfo | null =
      executionId !== null
        ? (run ?? { executionId })
        : workflowId !== null
          ? { workflowId, title: detail?.name ?? null }
          : null;
    if (!base) return null;
    return { ...base, ...(stepId ? { stepId } : {}) };
  }, [detail, run, workflowId, executionId, stepId]);

  useEffect(() => {
    xyneAIActor.send({ type: 'SET_WORKFLOW_CONTEXT', workflowInfo: current });
  }, [current]);

  useEffect(() => {
    return () => {
      xyneAIActor.send({ type: 'SET_WORKFLOW_CONTEXT', workflowInfo: null });
    };
  }, []);

  return current;
};
