/**
 * Direct API operations: everything that is not a Zero catalog query or mutator.
 *
 * These are the gaps in the catalog — server-side sequence allocation, multipart
 * uploads, and Vespa search. Each one already exists as a product controller
 * that the app itself calls, and each owns behaviour it would be reckless to
 * fork: sequence allocation, file storage, permission filtering, mail dedupe,
 * ranking. So none of it is reimplemented here. A route names a controller, and
 * `callController` runs it.
 *
 * Controllers write their own Express response, so they are invoked through a
 * capturing stub: the body is intercepted, then re-emitted in the SDK shape with
 * failures translated into the SDK error envelope. The product routes those
 * controllers also serve are untouched.
 */

import { Router, type Request, type RequestHandler, type Response } from 'express';
import type { ZodTypeAny } from 'zod';
import { ZodError } from 'zod';
import { searchQuerySchema, searchSchemaQuerySchema } from '@xyne/spaces-contract';
import type { AuthenticatedUser } from '@/types/express';
import { ChannelController } from '@/controllers/channelController';
import { ConversationController } from '@/controllers/conversationController';
import { TicketController } from '@/controllers/ticketController';
import { AttachmentController } from '@/controllers/attachmentController';
import { DraftAttachmentController } from '@/controllers/draftAttachmentController';
import { searchHandler } from '@/services/vespaSearch';
import { schemaHandler } from '@/services/vespaSearch/schemaHandler';
import { uploadMultiple } from '@/middleware/upload';
import { ApiError } from './errors';
import { rateLimit } from './middleware/rateLimit';
import type { ErrorCode } from '@xyne/spaces-contract';

const channelController = new ChannelController();
const conversationController = new ConversationController();
const ticketController = new TicketController();
const attachmentController = new AttachmentController();
const draftAttachmentController = new DraftAttachmentController();

/** A product controller: writes its response rather than returning it. */
type Controller = (req: Request, res: Response) => Promise<void> | void;

interface DirectRoute {
  readonly method: 'get' | 'post';
  /** Express path relative to the /api/sdk mount. */
  readonly path: string;
  readonly controller: Controller;
  /** Route-local parsing, such as multipart handling. */
  readonly middleware?: readonly RequestHandler[];
  /** Validates and coerces the query string before the controller sees it. */
  readonly query?: ZodTypeAny;
  /** Adjust the query the controller receives. */
  readonly mapQuery?: (query: Record<string, unknown>) => Record<string, unknown>;
  /** Adjust the body the controller receives. */
  readonly mapBody?: (body: unknown) => unknown;
  /** Unwrap the controller's envelope into the SDK's response shape. */
  readonly unwrap?: (body: unknown) => unknown;
  /** What a 5xx from this controller means. */
  readonly serverErrorCode?: ErrorCode;
}

const ROUTES: readonly DirectRoute[] = [
  {
    method: 'post',
    path: '/channels',
    controller: channelController.createChannel,
  },
  {
    method: 'post',
    path: '/channels/check-duplicate',
    controller: channelController.checkDuplicate,
  },
  {
    method: 'post',
    path: '/tickets',
    middleware: [uploadMultiple],
    controller: ticketController.createTicket,
    // Multipart turns every field into a string; these two arrive as JSON.
    mapBody: (body) => reviveJsonFields(body, ['metadata', 'dynamicFields']),
  },
  {
    method: 'post',
    path: '/channels/:channelId/conversations',
    middleware: [uploadMultiple],
    controller: conversationController.createConversation,
  },
  {
    method: 'post',
    path: '/attachments',
    middleware: [uploadMultiple],
    controller: attachmentController.uploadAttachments.bind(attachmentController),
  },
  {
    method: 'post',
    path: '/draft-attachments',
    middleware: [uploadMultiple],
    controller: draftAttachmentController.uploadDraftAttachment.bind(draftAttachmentController),
  },
  {
    method: 'get',
    path: '/search',
    controller: searchHandler,
    query: searchQuerySchema,
    // The handler rejects an absent `q` even though it supports filter-only
    // searches behind an explicit flag. Set the flag so callers can omit `q`.
    mapQuery: (query) => {
      const q = typeof query['q'] === 'string' ? query['q'] : '';
      return q ? { ...query, q } : { ...query, q, filterOnly: 'true' };
    },
    unwrap: unwrapEnvelope,
    serverErrorCode: 'upstream_unavailable',
  },
  {
    method: 'get',
    path: '/search/schema',
    controller: schemaHandler,
    query: searchSchemaQuerySchema,
    unwrap: unwrapEnvelope,
    serverErrorCode: 'upstream_unavailable',
  },
];

/** Build the router for every direct operation. */
export function createDirectRouter(): Router {
  const router = Router();

  for (const route of ROUTES) {
    router[route.method](
      route.path,
      rateLimit(route.method === 'get' ? 'read' : 'write'),
      ...(route.middleware ?? []),
      async (req: Request, res: Response, next) => {
        try {
          const result = await callController(route, req);
          for (const [name, value] of Object.entries(result.headers)) {
            res.setHeader(name, value);
          }
          if (result.status === 204 || result.body === undefined) {
            res.status(result.status).end();
            return;
          }
          res.status(result.status).json(result.body);
        } catch (err) {
          next(err instanceof ZodError ? ApiError.validation(err) : err);
        }
      },
    );
  }

  return router;
}

interface ControllerResult {
  readonly status: number;
  readonly body: unknown;
  readonly headers: Record<string, string>;
}

/**
 * Run a product controller as the authenticated API-key caller.
 *
 * The controller is handed a request that looks like a session request: the
 * principal is presented on `req.user`, which is where both the controllers and
 * `tenantScopeMiddleware` read identity from. That is why the principal is set
 * on the *real* request as well as the proxy — tenant scoping resolves the user
 * lazily off the original object, so setting it only on the proxy would leave
 * these routes unscoped.
 */
export async function callController(
  route: DirectRoute,
  req: Request,
): Promise<ControllerResult> {
  const auth = req.sdkAuth;
  if (!auth) throw new ApiError('unauthenticated', 'Missing authenticated principal.');

  const principal = principalOf(auth.authData);
  req.user = principal;

  const query = route.query
    ? (route.query.parse(req.query) as Record<string, unknown>)
    : (req.query as Record<string, unknown>);

  const proxyReq = Object.create(req) as Request;
  Object.defineProperties(proxyReq, {
    user: { value: principal, writable: true, configurable: true },
    params: { value: req.params, writable: true, configurable: true },
    query: {
      value: route.mapQuery ? route.mapQuery(query) : query,
      writable: true,
      configurable: true,
    },
    body: {
      value: route.mapBody ? route.mapBody(req.body) : req.body,
      writable: true,
      configurable: true,
    },
  });

  let status = 200;
  let body: unknown;
  let settled = false;
  const headers = new Map<string, string>();

  const stub = {
    status(code: number) {
      status = code;
      return stub;
    },
    json(payload: unknown) {
      body = payload;
      settled = true;
      return stub;
    },
    send(payload: unknown) {
      body = payload;
      settled = true;
      return stub;
    },
    end() {
      settled = true;
      return stub;
    },
    setHeader(name: string, value: string | number | readonly string[]) {
      headers.set(name, Array.isArray(value) ? value.join(', ') : String(value));
      return stub;
    },
    get headersSent() {
      return settled;
    },
  };

  await route.controller(proxyReq, stub as unknown as Response);

  if (!settled) {
    throw new ApiError('internal', 'The handler produced no response.');
  }
  if (status >= 400) throw controllerError(status, body, route.serverErrorCode);

  return {
    status,
    body: route.unwrap ? route.unwrap(body) : body,
    headers: Object.fromEntries(headers),
  };
}

/**
 * Translate a legacy `{ success, data, error }` envelope into a bare payload.
 *
 * Some paths report failure with HTTP 200 and `success: false`, so this raises
 * rather than returning a body the caller would read as a result.
 */
function unwrapEnvelope(raw: unknown): unknown {
  const body = raw as { success?: boolean; data?: unknown; error?: string } | undefined;
  if (body?.success === false) {
    throw new ApiError('upstream_unavailable', body.error ?? 'The request failed.');
  }
  if (body && typeof body === 'object' && 'data' in body) return body.data;
  if (body && typeof body === 'object') {
    const { success: _success, ...rest } = body as Record<string, unknown>;
    return rest;
  }
  return body;
}

function principalOf(authData: {
  sub: string;
  email: string;
  name: string;
  displayName?: string | null;
  workspaceId: string;
  role: string;
  orgRole: string;
  memberId: string;
}): AuthenticatedUser {
  return {
    id: authData.sub,
    // Not an OAuth-provider identity on this path. Controllers read id, email,
    // and workspaceId; roles come from the verified principal.
    googleId: '',
    email: authData.email,
    name: authData.name,
    displayName: authData.displayName ?? null,
    workspaceId: authData.workspaceId,
    role: authData.role,
    orgRole: authData.orgRole,
    memberId: authData.memberId,
    // Not the `isApiKeyUser` these controllers mean. That flag marks a key minted
    // by `apiKeyService` — the environment key and scoped service keys — and two
    // branches read it to skip the ACL check outright for an admin-role holder
    // (middleware/acl.ts, middleware/auth.ts). An SDK key is a user acting as
    // themselves and must get exactly a session's reach, so it stays false.
    isApiKeyUser: false,
  };
}

function controllerError(status: number, body: unknown, serverErrorCode?: ErrorCode): ApiError {
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
      return serverErrorCode
        ? new ApiError(serverErrorCode, message)
        : new ApiError('internal', 'The handler failed.', { cause: body });
  }
}

/** Parse fields that multipart delivered as JSON strings. */
function reviveJsonFields(body: unknown, fields: readonly string[]): unknown {
  if (!body || typeof body !== 'object') return body;
  const revived = { ...(body as Record<string, unknown>) };
  for (const field of fields) {
    const value = revived[field];
    if (typeof value !== 'string') continue;
    try {
      revived[field] = JSON.parse(value);
    } catch {
      // The controller owns validation and the eventual error response.
    }
  }
  return revived;
}
