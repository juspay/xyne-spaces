/**
 * Search endpoints.
 *
 * These delegate to the existing `searchHandler` / `schemaHandler` rather than
 * reimplementing Vespa querying. That handler is ~800 lines and owns a lot of
 * hard-won behaviour (permission filtering, mail dedupe, grouping, ranking), so
 * forking it for the SDK would be the fastest way to make SDK search quietly
 * disagree with product search.
 *
 * It writes its own Express response, so it is invoked through a capturing
 * adapter: the body is intercepted, then re-emitted in the SDK shape and its
 * failures translated into the SDK error envelope. `/api/vespaSearch` is left
 * completely untouched.
 */

import type { Request, Response } from 'express';
import type { AuthenticatedUser } from '@/types/express';
import { searchQuerySchema, searchSchemaQuerySchema } from '@xyne/spaces-contract';
import { searchHandler } from '@/services/vespaSearch';
import { schemaHandler } from '@/services/vespaSearch/schemaHandler';
import { ApiError } from '../errors';
import type { RouteDefinition, RouteContext } from '../manifest/types';

interface CapturedResponse {
  status: number;
  body: unknown;
}

/**
 * Run a legacy `(req, res)` handler and capture what it would have sent.
 *
 * Only the surface the search handlers actually use is implemented — status,
 * json, send, setHeader — and each returns the stub so the usual chaining works.
 */
async function capture(
  handler: (req: Request, res: Response) => Promise<void> | void,
  req: Request,
  query: Record<string, unknown>,
  user: AuthenticatedUser,
): Promise<CapturedResponse> {
  const captured: CapturedResponse = { status: 200, body: undefined };
  let settled = false;

  const stub = {
    status(code: number) {
      captured.status = code;
      return stub;
    },
    json(payload: unknown) {
      captured.body = payload;
      settled = true;
      return stub;
    },
    send(payload: unknown) {
      captured.body = payload;
      settled = true;
      return stub;
    },
    setHeader() {
      return stub;
    },
    end() {
      settled = true;
      return stub;
    },
  };

  // The handler reads identity off `req.user` and filters by workspace, so the
  // SDK principal has to be presented the same way a session would. Prototype
  // inheritance keeps the real request intact while overriding just these two.
  const proxyReq = Object.create(req) as Request;
  proxyReq.user = user;
  proxyReq.query = query as Request['query'];

  await handler(proxyReq as Request, stub as unknown as Response);

  if (!settled) {
    throw new ApiError('internal', 'Search handler produced no response.');
  }
  return captured;
}

/** Translate the legacy `{success,error}` body into the SDK error envelope. */
function unwrap(captured: CapturedResponse): unknown {
  const body = captured.body as { success?: boolean; data?: unknown; error?: string } | undefined;

  if (captured.status >= 400 || body?.success === false) {
    const message = body?.error ?? 'Search failed.';
    switch (captured.status) {
      case 400:
        throw new ApiError('invalid_request', message);
      case 401:
        throw new ApiError('unauthenticated', message);
      case 403:
        throw new ApiError('forbidden', message);
      case 404:
        throw new ApiError('not_found', message);
      default:
        throw new ApiError('upstream_unavailable', message);
    }
  }

  // Grouped responses put everything under `data`; a couple of the flat paths
  // return `{success, results, total}` at the top level instead.
  if (body && typeof body === 'object' && 'data' in body) return body.data;
  if (body && typeof body === 'object') {
    const { success: _success, ...rest } = body as Record<string, unknown>;
    return rest;
  }
  return body;
}

function principalOf(ctx: RouteContext): AuthenticatedUser {
  const { authData } = ctx.auth;
  return {
    id: authData.sub,
    // Not an OAuth-provider identity in this path; the search handler only reads
    // id / email / workspaceId, and roles come from the verified principal.
    googleId: '',
    email: authData.email,
    name: authData.name,
    displayName: authData.displayName ?? null,
    workspaceId: authData.workspaceId,
    role: authData.role,
    orgRole: authData.orgRole,
    memberId: authData.memberId,
  };
}

export const searchRoutes: readonly RouteDefinition[] = [
  {
    method: 'get',
    path: '/search',
    operationId: 'search',
    summary: 'Search across messages, tickets, files, channels, calls, and users.',
    request: { query: searchQuerySchema },
    async handler(ctx) {
      const query = ctx.query as Record<string, unknown>;

      // The handler requires `q` to be present and rejects an absent one, even
      // though it supports filter-only searches through an explicit flag. Set
      // that flag here so callers can simply omit `q`.
      const q = typeof query['q'] === 'string' ? query['q'] : '';
      const forwarded: Record<string, unknown> = { ...query, q };
      if (!q) forwarded['filterOnly'] = 'true';

      const captured = await capture(searchHandler, ctx.req, forwarded, principalOf(ctx));
      return { status: 200, body: unwrap(captured) };
    },
  },
  {
    method: 'get',
    path: '/search/schema',
    operationId: 'getSearchSchema',
    summary: 'Field definitions for a search index, for building advanced queries.',
    request: { query: searchSchemaQuerySchema },
    async handler(ctx) {
      const captured = await capture(
        schemaHandler,
        ctx.req,
        ctx.query as Record<string, unknown>,
        principalOf(ctx),
      );
      return { status: 200, body: unwrap(captured) };
    },
  },
];
