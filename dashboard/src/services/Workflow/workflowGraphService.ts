/**
 * Workflow Graph Service - Handle workflow graph operations and visualization
 * Uses React Query for caching, fetchQuery for imperative calls, and useMutation for actions
 */

import { useMutation } from '@tanstack/react-query';
import { apiInstance } from '../clients/apiClient';
import { queryClient } from '../clients/queryClient';
import {
  RerunFromStartResponse,
  RestoreWorkflowResponse,
  WorkflowExecutionControlResponse,
  RefineWorkflowRequest,
  RefineWorkflowResponse,
  RefinementHistory,
} from './workflowGraphService.types';

// Import all types from the dedicated types file
export type {
  WorkflowNodeData,
  WorkflowEdgeData,
  ExternalMetadata,
  WorkflowStepData,
  ASTGraphNode,
  ASTGraphEdge,
  ASTGraph,
  CombinedWorkflowData,
  WorkflowNode,
  WorkflowEdge,
  WorkflowGraphNode,
  WorkflowGraphEdge,
  WorkflowGraph,
  WorkflowStep,
  WorkflowStepsResponse,
  CombinedStepsWorkflow,
  WorkflowApiError,
  WorkflowExecutionControlResponse,
  WorkflowExecutionControlError,
  RestoreWorkflowResponse,
  RerunFromStartResponse,
  StepDetailsResponse,
  RefineWorkflowRequest,
  RefineWorkflowResponse,
  RefineWorkflowError,
  RefinementHistory,
} from './workflowGraphService.types';

// useMutation hooks for workflow control actions
export const useWorkflowControl = (): {
  pauseExecution: (executionId: string) => void;
  resumeExecution: (params: { executionId: string; userContext?: string }) => void;
  cancelExecution: (executionId: string) => void;
  restoreExecutionAsync: (params: {
    executionId: string;
    stepId: string;
  }) => Promise<RestoreWorkflowResponse>;
  rerunFromStart: (executionId: string) => void;
  isPausing: boolean;
  isResuming: boolean;
  isContinuing: boolean;
  isCanceling: boolean;
  isRestoring: boolean;
  isRerunning: boolean;
  pauseError: Error | null;
  resumeError: Error | null;
  cancelError: Error | null;
  restoreError: Error | null;
  rerunError: Error | null;
  continueError: Error | null;
  resetPause: () => void;
  resetResume: () => void;
  resetCancel: () => void;
  resetRestore: () => void;
  resetRerun: () => void;
  resetContinue: () => void;
  continueAgenticStep: (params: { executionId: string; stepId: string; message: string }) => void;
  continueAgenticStepAsync: (params: {
    executionId: string;
    stepId: string;
    message: string;
  }) => Promise<RerunFromStartResponse>;
} => {
  const pauseMutation = useMutation({
    mutationFn: async (executionId: string) => {
      const response = await apiInstance.put<WorkflowExecutionControlResponse>(
        `/workflows/executions/${executionId}/pause`,
      );
      return response.data;
    },
    onSuccess: (_data, executionId): void => {
      // Invalidate related queries after successful pause
      void queryClient.invalidateQueries({ queryKey: ['workflow-execution', executionId] });
      void queryClient.invalidateQueries({ queryKey: ['workflow-steps', executionId] });
      void queryClient.invalidateQueries({ queryKey: ['execution-lock-status', executionId] });
      // Invalidate combined-steps-light to update chat panel status
      void queryClient.invalidateQueries({
        predicate: query => query.queryKey[0] === 'combined-steps-light',
      });
    },
  });

  const resumeMutation = useMutation({
    mutationFn: async ({
      executionId,
      userContext,
    }: {
      executionId: string;
      userContext?: string;
    }) => {
      const response = await apiInstance.put<WorkflowExecutionControlResponse>(
        `/workflows/executions/${executionId}/resume`,
        userContext ? { userContext } : {},
      );
      return response.data;
    },
    onSuccess: (_data, { executionId }): void => {
      void queryClient.invalidateQueries({ queryKey: ['workflow-execution', executionId] });
      void queryClient.invalidateQueries({ queryKey: ['workflow-steps', executionId] });
      void queryClient.invalidateQueries({ queryKey: ['execution-lock-status', executionId] });
      // Invalidate combined-steps-light to update chat panel status
      void queryClient.invalidateQueries({
        predicate: query => query.queryKey[0] === 'combined-steps-light',
      });
    },
  });

  const cancelMutation = useMutation({
    mutationFn: async (executionId: string) => {
      const response = await apiInstance.put<WorkflowExecutionControlResponse>(
        `/workflows/executions/${executionId}/cancel`,
      );
      return response.data;
    },
    onSuccess: (_data, executionId): void => {
      void queryClient.invalidateQueries({ queryKey: ['workflow-execution', executionId] });
      void queryClient.invalidateQueries({ queryKey: ['workflow-steps', executionId] });
      void queryClient.invalidateQueries({ queryKey: ['execution-lock-status', executionId] });
      // Invalidate combined-steps-light to update chat panel status
      void queryClient.invalidateQueries({
        predicate: query => query.queryKey[0] === 'combined-steps-light',
      });
    },
  });

  const restoreMutation = useMutation({
    mutationFn: async ({ executionId, stepId }: { executionId: string; stepId: string }) => {
      const response = await apiInstance.post<RestoreWorkflowResponse>(
        `/workflows/executions/${executionId}/restore`,
        { stepId },
      );
      return response.data;
    },
    onSuccess: (_data, { executionId }): void => {
      void queryClient.invalidateQueries({ queryKey: ['workflow-execution', executionId] });
      void queryClient.invalidateQueries({ queryKey: ['workflow-steps', executionId] });
    },
  });

  const rerunFromStartMutation = useMutation({
    mutationFn: async (executionId: string) => {
      const response = await apiInstance.post<RerunFromStartResponse>(
        `/workflows/executions/${executionId}/rerun-from-start`,
      );
      return response.data;
    },
    onSuccess: (_data, executionId): void => {
      void queryClient.invalidateQueries({ queryKey: ['workflow-execution', executionId] });
      void queryClient.invalidateQueries({ queryKey: ['workflow-steps', executionId] });
    },
  });

  const continueAgenticStepMutation = useMutation({
    mutationFn: async ({
      executionId,
      stepId,
      message,
    }: {
      executionId: string;
      stepId: string;
      message: string;
    }) => {
      const response = await apiInstance.post<RerunFromStartResponse>(
        `/workflows/executions/${executionId}/continue`,
        { stepId, message },
      );
      return response.data;
    },
    onSuccess: (_data, { executionId }): void => {
      void queryClient.invalidateQueries({ queryKey: ['workflow-execution', executionId] });
      void queryClient.invalidateQueries({ queryKey: ['workflow-steps', executionId] });
      // Invalidate combined-steps-light to update chat panel with new execution
      void queryClient.invalidateQueries({
        predicate: query => query.queryKey[0] === 'combined-steps-light',
      });
    },
  });

  return {
    pauseExecution: pauseMutation.mutate,
    resumeExecution: resumeMutation.mutate,
    cancelExecution: cancelMutation.mutate,
    restoreExecutionAsync: restoreMutation.mutateAsync,
    rerunFromStart: rerunFromStartMutation.mutate,
    continueAgenticStep: continueAgenticStepMutation.mutate,
    continueAgenticStepAsync: continueAgenticStepMutation.mutateAsync,

    // Loading states
    isPausing: pauseMutation.isPending,
    isResuming: resumeMutation.isPending,
    isCanceling: cancelMutation.isPending,
    isRestoring: restoreMutation.isPending,
    isRerunning: rerunFromStartMutation.isPending,
    isContinuing: continueAgenticStepMutation.isPending,

    // Error states
    pauseError: pauseMutation.error,
    resumeError: resumeMutation.error,
    cancelError: cancelMutation.error,
    restoreError: restoreMutation.error,
    rerunError: rerunFromStartMutation.error,
    continueError: continueAgenticStepMutation.error,

    // Reset methods
    resetPause: pauseMutation.reset,
    resetResume: resumeMutation.reset,
    resetCancel: cancelMutation.reset,
    resetRestore: restoreMutation.reset,
    resetRerun: rerunFromStartMutation.reset,
    resetContinue: continueAgenticStepMutation.reset,
  };
};

// useMutation hook for workflow approval
export const useWorkflowApproval = (): {
  approveStep: (params: {
    workflowExecutionId: string;
    workflowStepId: string;
    approvedBy?: string;
    comments?: string;
  }) => void;
  isApproving: boolean;
  approvalError: Error | null;
  resetApproval: () => void;
} => {
  const approveMutation = useMutation({
    mutationFn: async ({
      workflowExecutionId,
      workflowStepId,
      approvedBy,
      comments,
    }: {
      workflowExecutionId: string;
      workflowStepId: string;
      approvedBy?: string;
      comments?: string;
    }) => {
      const approvalResponse = {
        approved: true,
        status: 'approved',
        approvedBy: approvedBy,
        comments: comments || '',
      };

      await apiInstance.post('/external-step-response', {
        workflowExecutionId,
        workflowStepId,
        rawResponse: JSON.stringify(approvalResponse),
      });
    },
    onSuccess: (_data, { workflowExecutionId }): void => {
      // Invalidate workflow execution cache after approval
      void queryClient.invalidateQueries({ queryKey: ['workflow-execution', workflowExecutionId] });
      void queryClient.invalidateQueries({ queryKey: ['workflow-steps', workflowExecutionId] });
    },
  });

  return {
    approveStep: approveMutation.mutate,
    isApproving: approveMutation.isPending,
    approvalError: approveMutation.error,
    resetApproval: approveMutation.reset,
  };
};

// useMutation hook for workflow refinement
export const useWorkflowRefinement = (): {
  refineWorkflow: (params: { executionId: string; request: RefineWorkflowRequest }) => void;
  getRefinementHistory: (executionId: string) => Promise<RefinementHistory>;
  isRefining: boolean;
  refineError: Error | null;
  refineData: RefineWorkflowResponse | undefined;
  resetRefine: () => void;
} => {
  const refineMutation = useMutation({
    mutationFn: async ({
      executionId,
      request,
    }: {
      executionId: string;
      request: RefineWorkflowRequest;
    }) => {
      const response = await apiInstance.post<RefineWorkflowResponse>(
        `/workflows/executions/${executionId}/refine`,
        request,
      );
      return response.data;
    },
    onSuccess: (_data, { executionId }): void => {
      // Invalidate related queries after successful refinement
      void queryClient.invalidateQueries({ queryKey: ['workflow-execution', executionId] });
      void queryClient.invalidateQueries({ queryKey: ['workflow-steps', executionId] });
      void queryClient.invalidateQueries({ queryKey: ['refinement-history', executionId] });
    },
  });

  const getRefinementHistory = async (executionId: string): Promise<RefinementHistory> => {
    const response = await apiInstance.get<RefinementHistory>(
      `/workflows/executions/${executionId}/refinements`,
    );
    return response.data;
  };

  return {
    refineWorkflow: refineMutation.mutate,
    getRefinementHistory,
    isRefining: refineMutation.isPending,
    refineError: refineMutation.error,
    refineData: refineMutation.data,
    resetRefine: refineMutation.reset,
  };
};
