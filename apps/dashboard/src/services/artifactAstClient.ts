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

/**
 * The gateway's schema requires `orderBy` to be an ARRAY; a bare object is
 * rejected with a 400 before the query ever runs.
 *
 * Agents write the idiomatic Prisma single-object form (`{ createdAt: 'desc' }`)
 * because that is what the ORM accepts everywhere else, and the artifact
 * validator has always allowed either — so a generated app would 400 on a source
 * that looked correct. Normalising here rather than tightening the validator is
 * deliberate: payloads are persisted, so apps saved before this fix must keep
 * working. The two forms are equivalent to the gateway.
 */
function normalizeOrderBy(
  orderBy: ArtifactAstSource['orderBy'],
): Array<Record<string, unknown>> | undefined {
  if (!orderBy) return undefined;
  const list = Array.isArray(orderBy) ? orderBy : [orderBy];
  return list.length > 0 ? list : undefined;
}

export async function executeArtifactAstQuery(source: ArtifactAstSource): Promise<unknown> {
  const orderBy = normalizeOrderBy(source.orderBy);
  try {
    const { data } = await apiInstance.post<AstQueryResponse>('/query/claw', {
      model: source.model,
      operation: source.operation ?? 'findMany',
      ...(source.where ? { where: source.where } : {}),
      ...(orderBy ? { orderBy } : {}),
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
