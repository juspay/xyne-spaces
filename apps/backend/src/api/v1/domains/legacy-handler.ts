/** Adapter for reusing battle-tested legacy Express controllers under /api/v1. */

import type { Request, Response } from 'express';
import type { AuthenticatedUser } from '@/types/express';
import { ApiError } from '../errors';
import type { RouteContext, RouteResult } from '../manifest/types';

type LegacyHandler = (req: Request, res: Response) => Promise<void> | void;

interface LegacyRequestOverrides {
  readonly params?: Record<string, string>;
  readonly query?: Record<string, unknown>;
  readonly body?: unknown;
}

interface CapturedResponse {
  status: number;
  body: unknown;
  settled: boolean;
}

export async function callLegacyHandler(
  handler: LegacyHandler,
  ctx: RouteContext,
  overrides: LegacyRequestOverrides = {},
): Promise<RouteResult> {
  const captured: CapturedResponse = { status: 200, body: undefined, settled: false };
  const headers = new Map<string, string>();
  const principal = principalOf(ctx);

  // tenantScopeMiddleware resolves the authenticated user lazily from the real
  // request object. Populate it before the controller performs any database IO;
  // setting it only on the proxy would leave these routes unscoped.
  ctx.req.user = principal;

  const stub = {
    status(code: number) {
      captured.status = code;
      return stub;
    },
    json(payload: unknown) {
      captured.body = payload;
      captured.settled = true;
      return stub;
    },
    send(payload: unknown) {
      captured.body = payload;
      captured.settled = true;
      return stub;
    },
    end() {
      captured.settled = true;
      return stub;
    },
    setHeader(name: string, value: string | number | readonly string[]) {
      headers.set(name, Array.isArray(value) ? value.join(', ') : String(value));
      return stub;
    },
    get headersSent() {
      return captured.settled;
    },
  };

  const proxyReq = Object.create(ctx.req) as Request;
  Object.defineProperties(proxyReq, {
    user: { value: principal, writable: true, configurable: true },
    params: {
      value: overrides.params ?? ctx.params,
      writable: true,
      configurable: true,
    },
    query: {
      value: overrides.query ?? ctx.query,
      writable: true,
      configurable: true,
    },
    body: {
      value: overrides.body ?? ctx.body,
      writable: true,
      configurable: true,
    },
  });

  await handler(proxyReq, stub as unknown as Response);

  if (!captured.settled) {
    throw new ApiError('internal', 'Legacy handler produced no response.');
  }
  if (captured.status >= 400) throw legacyError(captured.status, captured.body);

  return {
    status: captured.status,
    ...(captured.body === undefined ? {} : { body: captured.body }),
    ...(headers.size === 0 ? {} : { headers: Object.fromEntries(headers) }),
  };
}

function principalOf(ctx: RouteContext): AuthenticatedUser {
  const { authData } = ctx.auth;
  return {
    id: authData.sub,
    googleId: '',
    email: authData.email,
    name: authData.name,
    displayName: authData.displayName ?? null,
    workspaceId: authData.workspaceId,
    role: authData.role,
    orgRole: authData.orgRole,
    memberId: authData.memberId,
    isApiKeyUser: false,
    scopes: [...ctx.auth.scopes],
  };
}

function legacyError(status: number, body: unknown): ApiError {
  const payload = body as { error?: unknown; message?: unknown } | undefined;
  const message =
    (typeof payload?.message === 'string' && payload.message) ||
    (typeof payload?.error === 'string' && payload.error) ||
    'Request failed.';

  switch (status) {
    case 400:
      return new ApiError('invalid_request', message);
    case 401:
      return new ApiError('unauthenticated', message);
    case 403:
      return new ApiError('forbidden', message);
    case 404:
      return new ApiError('not_found', message);
    case 409:
      return new ApiError('conflict', message);
    case 422:
      return new ApiError('domain_rule', message);
    case 429:
      return new ApiError('rate_limited', message);
    default:
      return new ApiError('internal', 'Legacy handler failed.', { cause: body });
  }
}
