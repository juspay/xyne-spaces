/**
 * Workflow Service - Handle workflow creation and management
 * Uses React Query for caching and state management
 */

import { apiInstance } from '../clients/apiClient';
import { queryClient } from '../clients/queryClient';

export interface WorkflowBaseFields {
  title: string;
  workflowType: string;
}

export interface CreateWorkflowRequest extends WorkflowBaseFields {
  ticketId?: string;
  conversationId?: string;
  xyneId?: string;
  [key: string]: unknown;
}

export interface RerunFromStartResponse {
  rerunExecutionId: string;
  sourceExecutionId: string;
  originalRequestedExecutionId: string;
  usedRootExecution: boolean;
  message: string;
}

/**
 * Create a new workflow
 */
export const createWorkflow = async (workflowData: CreateWorkflowRequest): Promise<void> => {
  const response = await apiInstance.post<void>('/workflows', workflowData);

  // Invalidate related queries after successful workflow creation
  await queryClient.invalidateQueries({
    queryKey: ['workflows'],
  });

  return response.data;
};

/**
 * Rerun a workflow from start
 */
export const rerunWorkflowFromStart = async (
  executionId: string,
): Promise<RerunFromStartResponse> => {
  const response = await apiInstance.post<RerunFromStartResponse>(
    `/workflows/executions/${executionId}/rerun-from-start`,
  );

  // Invalidate related queries after successful rerun to ensure UI shows latest state
  await queryClient.invalidateQueries({
    queryKey: ['workflow-execution', executionId],
  });
  await queryClient.invalidateQueries({
    queryKey: ['workflow-steps', executionId],
  });
  await queryClient.invalidateQueries({
    predicate: query => query.queryKey[0] === 'combined-steps-light',
  });

  return response.data;
};
