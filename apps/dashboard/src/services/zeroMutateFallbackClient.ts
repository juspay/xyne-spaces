import { apiInstance } from './clients/apiClient';

interface FallbackMutateRequest {
  name: string;
  args: unknown;
}

interface FallbackMutateResponse {
  success: boolean;
  error?: string;
  message?: string;
}

export async function executeFallbackMutate(
  name: string,
  args: unknown,
): Promise<FallbackMutateResponse> {
  const response = await apiInstance.post<FallbackMutateResponse>('/zero/push-fallback', {
    name,
    args,
  } as FallbackMutateRequest);

  if (!response.data.success) {
    throw new Error(response.data.message || response.data.error || 'Mutation failed');
  }

  return response.data;
}
