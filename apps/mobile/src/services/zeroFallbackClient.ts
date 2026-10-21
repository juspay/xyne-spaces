import { mtlsRequestJson } from './MtlsApiService';
import { buildAuthenticatedHeaders } from './authToken';

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
  const headers = await buildAuthenticatedHeaders();
  const payload: FallbackQueryRequest = { queries };
  return mtlsRequestJson<FallbackQueryResponse>('/zero/query-fallback', {
    method: 'POST',
    headers,
    body: JSON.stringify(payload),
  });
}

export async function executeFallbackQuery(name: string, args: unknown): Promise<unknown> {
  const response = await executeFallbackQueries([{ name, args }]);
  const result = response.results.find(r => r.name === name);
  if (!result) {
    throw new Error(`Query result not found for: ${name}`);
  }
  return result.data ?? null;
}
