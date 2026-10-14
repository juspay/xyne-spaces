import { API_ORIGIN } from '@/src/config';
import { isMtlsRequestError, mtlsRequestJson } from '@/src/services/MtlsApiService';
import { getActiveWorkspaceId } from '@/src/utils/activeWorkspace';

/**
 * Shared claw-auth transport for mobile.
 *
 * Dashboard hits same-origin `/claw/api/v1…` with cookies. Mobile uses mTLS to
 * `${API_ORIGIN}/claw/api/v1…` and sends the cookie jar (Spaces session) so
 * claw-auth `requireAuth` can resolve identity via Spaces `/api/auth/me`.
 */

export class ClawApiError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = 'ClawApiError';
    this.status = status;
  }
}

export type ClawApiRequestInit = {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';
  body?: unknown;
  userId?: string;
  headers?: Record<string, string>;
};

const CLAW_API_V1_BASE = `${API_ORIGIN}/claw/api/v1`;

function parseClawErrorBody(responseBody: string): string | undefined {
  try {
    const parsed = JSON.parse(responseBody) as { error?: unknown };
    return typeof parsed.error === 'string' && parsed.error.trim()
      ? parsed.error.trim()
      : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Call a claw-auth `/api/v1` endpoint and unwrap `{ success, data }`.
 * `path` is relative (e.g. `/servers`).
 */
export async function clawApiRequest<T>(path: string, init: ClawApiRequestInit = {}): Promise<T> {
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  const url = `${CLAW_API_V1_BASE}${normalizedPath}`;
  const workspaceId = getActiveWorkspaceId();

  const headers: Record<string, string> = {
    ...(init.headers ?? {}),
  };
  if (init.userId) {
    headers['x-user-id'] = init.userId;
  }
  if (workspaceId) {
    headers['x-workspace-id'] = workspaceId;
  }

  try {
    const envelope = await mtlsRequestJson<{ success: boolean; data: T }>(url, {
      method: init.method ?? 'GET',
      headers,
      ...(init.body !== undefined ? { body: init.body as never } : {}),
    });
    return envelope.data;
  } catch (error) {
    if (isMtlsRequestError(error)) {
      throw new ClawApiError(
        error.statusCode,
        parseClawErrorBody(error.responseBody) ?? error.message,
      );
    }
    throw error;
  }
}
