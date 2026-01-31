import { useMutation, useQueryClient, type UseMutateAsyncFunction } from '@tanstack/react-query';
import { apiInstance } from '../clients/apiClient';

interface SubmitApprovalParams {
  workflowStepId: string;
  response: Record<string, unknown>;
}

interface UseApprovalSubmitReturn {
  submitResponse: UseMutateAsyncFunction<void, Error, SubmitApprovalParams, unknown>;
  isSubmitting: boolean;
  error: Error | null;
  reset: () => void;
}

export const useApprovalSubmit = (): UseApprovalSubmitReturn => {
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: async ({ workflowStepId, response }: SubmitApprovalParams): Promise<void> => {
      const approvalResponse = {
        approved: true,
        status: 'approved',
        ...response,
      };

      await apiInstance.post('/external-step-response', {
        workflowStepId,
        rawResponse: JSON.stringify(approvalResponse),
      });
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['pending-human-intervention'] });
      void queryClient.invalidateQueries({ queryKey: ['workflow-execution'] });
      void queryClient.invalidateQueries({ queryKey: ['workflow-steps'] });
    },
  });

  return {
    submitResponse: mutation.mutateAsync,
    isSubmitting: mutation.isPending,
    error: mutation.error,
    reset: mutation.reset,
  };
};
