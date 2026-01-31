import { useState, useCallback } from 'react';
import { toast } from 'sonner';
import { apiInstance } from '../services/clients/apiClient';

interface GenerateDetailedSummaryResult {
  success: boolean;
  error?: string;
}

interface GenerateDetailedSummaryResponse {
  success: boolean;
  message?: string;
  error?: string;
}

interface UseGenerateDetailedSummaryReturn {
  generateDetailedSummary: (
    callId: string,
    messageId?: string,
  ) => Promise<GenerateDetailedSummaryResult>;
  isLoading: boolean;
  error: string | null;
}

/**
 * Hook for generating detailed summary from call transcript
 * Calls POST /api/calls/:callId/generate-detailed-summary
 */
export function useGenerateDetailedSummary(): UseGenerateDetailedSummaryReturn {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const generateDetailedSummary = useCallback(
    async (callId: string, messageId?: string): Promise<GenerateDetailedSummaryResult> => {
      setIsLoading(true);
      setError(null);

      try {
        const response = await apiInstance.post<GenerateDetailedSummaryResponse>(
          `/calls/${callId}/generate-detailed-summary`,
          { messageId },
        );

        const data = response.data;

        if (!data.success) {
          const errorMessage = data.error || 'Failed to generate detailed summary';
          setError(errorMessage);
          toast.error('Detailed Summary Generation Failed', {
            description: errorMessage,
          });
          return { success: false, error: errorMessage };
        }

        toast.success('Detailed Summary Generated', {
          description: 'Comprehensive summary has been created and posted.',
        });

        return { success: true };
      } catch (err) {
        const errorMessage =
          err instanceof Error ? err.message : 'Failed to generate detailed summary';
        setError(errorMessage);
        toast.error('Detailed Summary Generation Failed', {
          description: errorMessage,
        });
        return { success: false, error: errorMessage };
      } finally {
        setIsLoading(false);
      }
    },
    [],
  );

  return { generateDetailedSummary, isLoading, error };
}
