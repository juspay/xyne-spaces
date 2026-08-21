// Declarative model queries for artifact apps, via the read-only query gateway
// (POST /api/query/claw). The gateway validates the AST, applies the caller's
// ACLs plus a workspace backstop, and runs it against the read replica — so the
// rows an app receives are always scoped to whoever is viewing it.

import { apiInstance } from './clients/apiClient';
import type { ArtifactAstSource } from '../components/AIScreen/ReactArtifact/artifactData.constants';

interface AstQueryResponse {
  data: unknown;
}

/** Shape the gateway returns on failure (500). */
interface AstQueryError {
  error?: string;
  message?: string;
}

export async function executeArtifactAstQuery(source: ArtifactAstSource): Promise<unknown> {
  try {
    const { data } = await apiInstance.post<AstQueryResponse>('/query/claw', {
      model: source.model,
      operation: source.operation ?? 'findMany',
      ...(source.where ? { where: source.where } : {}),
      ...(source.orderBy ? { orderBy: source.orderBy } : {}),
      ...(source.take !== undefined ? { take: source.take } : {}),
    });
    return data?.data ?? null;
  } catch (err) {
    // apiInstance attaches the parsed body as `responseData`; surface the
    // gateway's own message rather than a bare "Request failed".
    const body = (err as { responseData?: AstQueryError })?.responseData;
    const message = body?.message ?? body?.error;
    throw new Error(message || (err instanceof Error ? err.message : 'Query failed'));
  }
}
