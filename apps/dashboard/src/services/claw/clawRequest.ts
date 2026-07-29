// Shared fetch helper for the claw-auth backend. Mirrors the reference
// frontend's `request()` (xyne-claw-auth/frontend/src/lib/api.ts): same
// base-URL resolution, cookie auth, JSON default headers, and a typed error.
//
// The existing read-only services (clawAuthAgentsService, clawMcpService,
// clawSkillsService) inline their own fetch calls; anything with request
// bodies / error surfaces (the create wizard) routes through this instead.

// Same base as the other claw services: same-origin `/claw` by default (the
// dashboard host routes `/claw/*` to claw-auth; local dev uses the Vite proxy
// for `/claw/api/v1`).
export const CLAW_API_BASE = import.meta.env.VITE_CLAW_API_BASE_URL || '/claw';

/** Typed error carrying the HTTP status so callers can branch on it. */
export class ClawApiError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = 'ClawApiError';
    this.status = status;
  }
}

/** Converts a claw request failure to safe, consistent user-facing copy. */
export const clawErrorText = (error: unknown, fallback: string): string => {
  if (error instanceof ClawApiError && error.status === 403) {
    return 'You don’t have permission to do that';
  }
  return error instanceof Error ? error.message : fallback;
};

export interface ClawApiRequestInit extends Omit<RequestInit, 'headers'> {
  userId?: string;
  headers?: Record<string, string>;
}

/**
 * Fetch `path` (relative to `CLAW_API_BASE`) with cookie auth and JSON headers.
 * Throws `ClawApiError` on non-2xx, reading `{ error }` from the body when
 * present. Returns the parsed JSON body as `T`.
 */
export async function clawRequest<T>(path: string, init?: RequestInit): Promise<T> {
  // Central claw transport predates the dashboard's axios-only service rule.
  // eslint-disable-next-line local-rules/no-fetch-use-axios
  const res = await fetch(`${CLAW_API_BASE}${path}`, {
    credentials: 'include',
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...init?.headers,
    },
  });

  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new ClawApiError(res.status, body.error ?? `Request failed: ${res.status}`);
  }

  return res.json() as Promise<T>;
}

/** Calls a standard `/api/v1` endpoint and unwraps its `{ success, data }` envelope. */
export async function clawApiRequest<T>(path: string, init: ClawApiRequestInit = {}): Promise<T> {
  const { userId, headers, ...rest } = init;
  const body = await clawRequest<{ success: boolean; data: T }>(`/api/v1${path}`, {
    ...rest,
    headers: {
      ...(userId ? { 'x-user-id': userId } : {}),
      ...headers,
    },
  });
  return body.data;
}
