import { apiInstance } from './clients/apiClient';

interface FallbackQueryRequest {
  queries: { name: string; args?: unknown }[];
}

interface FallbackQueryResponse {
  results: Array<{
    name: string;
    data: unknown;
  }>;
}

export async function executeFallbackQueries(
  queries: { name: string; args?: unknown }[],
): Promise<FallbackQueryResponse> {
  const response = await apiInstance.post<FallbackQueryResponse>('/zero/query-fallback', {
    queries,
  } as FallbackQueryRequest);

  return response.data;
}

export async function executeFallbackQuery(name: string, args: unknown): Promise<unknown> {
  const response = await executeFallbackQueries([{ name, args }]);
  const result = response.results.find(r => r.name === name);

  if (!result) {
    throw new Error(`Query result not found for: ${name}`);
  }

  return result.data ?? null;
}
