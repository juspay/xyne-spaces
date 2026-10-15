import { apiRequest } from '@/src/services/apiClient';
import { getActiveWorkspaceId } from '@/src/utils/activeWorkspace';
import type { MtlsRequestOptions } from '@/src/services/MtlsApiService';

export function feedPath(workspaceId: string, suffix: string): string {
  return `/feed/workspaces/${encodeURIComponent(workspaceId)}${suffix}`;
}
export async function feedRequest<T>(
  workspaceId: string,
  suffix: string,
  options: MtlsRequestOptions = {},
): Promise<T> {
  if (getActiveWorkspaceId() !== workspaceId)
    throw new Error('Workspace changed. Please reopen Feed.');
  try {
    return await apiRequest<T>(feedPath(workspaceId, suffix), {
      ...options,
      headers: { ...options.headers, ['X-Workspace-Id']: workspaceId },
    });
  } catch (error) {
    if (
      error &&
      typeof error === 'object' &&
      'responseBody' in error &&
      typeof error.responseBody === 'string'
    ) {
      let body: { error?: string } | undefined;
      try {
        body = JSON.parse(error.responseBody) as { error?: string };
      } catch {
        /* Keep transport error. */
      }
      if (body?.error) throw new Error(body.error);
    }
    throw error;
  }
}
export function feedError(error: unknown): string {
  return error instanceof Error ? error.message : 'Something went wrong. Please try again.';
}
