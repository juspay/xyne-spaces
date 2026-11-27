import { decryptTransitFields } from '@xyne/shared';
import { mtlsRequestJson } from './MtlsApiService';
import { buildAuthenticatedHeaders } from './authToken';
import { getActiveKeyring } from './encryption/activeKeyring';

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
  const response = await mtlsRequestJson<FallbackQueryResponse>('/zero/query-fallback', {
    method: 'POST',
    headers,
    body: JSON.stringify(payload),
  });
  // Fields the backend encrypted for this device's transit key, as in apiRequest.
  const keyring = getActiveKeyring();
  return keyring
    ? ((await decryptTransitFields(response, keyring)) as FallbackQueryResponse)
    : response;
}

export async function executeFallbackQuery(name: string, args: unknown): Promise<unknown> {
  const response = await executeFallbackQueries([{ name, args }]);
  const result = response.results.find(r => r.name === name);
  if (!result) {
    throw new Error(`Query result not found for: ${name}`);
  }
  return result.data ?? null;
}
