import { useState, useCallback } from 'react';
import { toast } from 'sonner';
import { apiInstance } from '../services/clients/apiClient';

interface GeneratePRDResult {
  success: boolean;
  canvasUrl?: string;
  error?: string;
}

interface GeneratePRDResponse {
  success: boolean;
  message?: string;
  canvasUrl?: string;
  error?: string;
}

interface UseGeneratePRDReturn {
  generatePRD: (callId: string, messageId?: string) => Promise<GeneratePRDResult>;
  isLoading: boolean;
  error: string | null;
}

/**
 * Hook for generating PRD from call transcript
 * Calls POST /api/calls/:callId/generate-prd
 */
export function useGeneratePRD(): UseGeneratePRDReturn {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const generatePRD = useCallback(
    async (callId: string, messageId?: string): Promise<GeneratePRDResult> => {
      setIsLoading(true);
      setError(null);

      try {
        const response = await apiInstance.post<GeneratePRDResponse>(
          `/calls/${callId}/generate-prd`,
          { messageId },
        );

        const data = response.data;

        if (!data.success) {
          const errorMessage = data.error || 'Failed to generate PRD';
          setError(errorMessage);
          toast.error('PRD Generation Failed', {
            description: errorMessage,
          });
          return { success: false, error: errorMessage };
        }

        toast.success('PRD Generated', {
          description: 'Product Requirements Document has been created and posted.',
        });

        return data.canvasUrl ? { success: true, canvasUrl: data.canvasUrl } : { success: true };
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : 'Failed to generate PRD';
        setError(errorMessage);
        toast.error('PRD Generation Failed', {
          description: errorMessage,
        });
        return { success: false, error: errorMessage };
      } finally {
        setIsLoading(false);
      }
    },
    [],
  );

  return { generatePRD, isLoading, error };
}
