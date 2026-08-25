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
import { z, type ZodTypeAny } from 'zod';
import { searchQuerySchema, searchSchemaQuerySchema } from '@xyne/spaces-contract';
import type { AuthenticatedUser } from '@/types/express';
import { ChannelController } from '@/controllers/channelController';
import { ConversationController } from '@/controllers/conversationController';
import { TicketController } from '@/controllers/ticketController';
import { AttachmentController } from '@/controllers/attachmentController';
import { DraftAttachmentController } from '@/controllers/draftAttachmentController';
import { searchHandler } from '@/services/vespaSearch';
import { schemaHandler } from '@/services/vespaSearch/schemaHandler';
import {
  getS2SClawRunStatus,
  listS2SClawAgents,
  runS2SClawAgent,
} from '@/services/clawAgentService';
import { uploadMultiple } from '@/middleware/upload';
import { config } from '@/config/env';
import type { SdkAuth } from './auth';
import { SdkApiError } from './errors';
import { handle } from './handler';

const channelController = new ChannelController();
const conversationController = new ConversationController();
const ticketController = new TicketController();
const attachmentController = new AttachmentController();
const draftAttachmentController = new DraftAttachmentController();

/** A product controller: writes its response rather than returning it. */
type Controller = (req: Request, res: Response) => Promise<void> | void;

/** A service function: returns its payload, so nothing needs capturing. */
type Service = (req: Request, auth: SdkAuth) => Promise<unknown>;

interface BaseRoute {
  readonly method: 'get' | 'post';
  /** Express path relative to the /api/sdk mount. */
  readonly path: string;
  /** Route-local parsing, such as multipart handling. */
  readonly middleware?: readonly RequestHandler[];
  /** Validates and coerces the query string before the handler sees it. */
  readonly query?: ZodTypeAny;
  /** Validates and coerces the body before the handler sees it. */
  readonly body?: ZodTypeAny;
  /** Adjust the query the controller receives. */
  readonly mapQuery?: (query: Record<string, unknown>) => Record<string, unknown>;
  /** Adjust the body the controller receives. */
  readonly mapBody?: (body: unknown) => unknown;
  /** Unwrap the controller's envelope into the SDK's response shape. */
  readonly unwrap?: (body: unknown) => unknown;
}

/**
 * A route is backed by one of two things, never both: a product controller that
 * writes an Express response, or a service function that returns a value.
 */
type DirectRoute =
  | (BaseRoute & { readonly controller: Controller; readonly service?: never })
  | (BaseRoute & { readonly service: Service; readonly controller?: never });

/**
 * A Claw run request.
 *
 * `channelId` is the one real bridge between the two services: supplying one
 * makes the agent post its reply into that Spaces thread as well as returning it.
 */
const clawRunBody = z.object({
  agent: z.string().min(1),
  task: z.string().min(1),
  conversationId: z.string().min(1).optional(),
  channelId: z.string().min(1).optional(),
  context: z.string().optional(),
});

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
  },
  {
    method: 'get',
    path: '/search/schema',
    controller: schemaHandler,
    query: searchSchemaQuerySchema,
    unwrap: unwrapEnvelope,
  },

  /**
   * Who the presented key acts as.
   *
   * The middleware has already resolved this, so it is a read of the request
   * rather than a lookup. A key's own claims do not include `role` or
   * `orgRole` — those are read fresh from the database on every request,
   * deliberately, so this is the only way a caller gets the full picture. It
   * also spares an SDK client from decoding a JWT itself, which this SDK has
   * no crypto dependency to do safely. Several operations also take the
   * acting user's id as an argument, which this is how a caller learns.
   */
  {
    method: 'get',
    path: '/me',
    service: async (_req, auth) => {
      const { authData } = auth;
      return {
        id: authData.sub,
        email: authData.email,
        name: authData.name,
        displayName: authData.displayName ?? null,
        workspaceId: authData.workspaceId,
        orgId: authData.orgId,
        memberId: authData.memberId,
        role: authData.role,
        orgRole: authData.orgRole,
        keyExpiresAt: auth.keyExpiresAt.toISOString(),
      };
    },
  },

  /*
   * Claw runs through Spaces rather than being reached directly.
   *
   * `clawAgentService` already speaks to claw-auth with the deployment's own
   * service credential, so a caller needs no second login and Claw needs no
   * knowledge of API keys. The S2S variants are the ones that take an explicit
   * identity — `userId`, `userName`, `userEmail`, and the three `spaces*` fields
   * map one-to-one onto `AuthData` — and return a session id that can be polled.
   * The non-S2S `runClawAgent` is the app-mention path: it requires a channel and
   * conversation to post into and returns only whether it dispatched, so a result
   * cannot be read back.
   */
  {
    method: 'get',
    path: '/claw/agents',
    service: async () => listS2SClawAgents(),
  },
  {
    method: 'post',
    path: '/claw/runs',
    body: clawRunBody,
    service: async (req, auth) => {
      const input = clawRunBody.parse(req.body);
      const { authData } = auth;
      const result = await runS2SClawAgent({
        agentSlug: input.agent,
        task: input.task,
        userId: authData.sub,
        userName: authData.displayName || authData.name || authData.email,
        userEmail: authData.email,
        spacesWorkspaceId: authData.workspaceId,
        spacesOrgId: authData.orgId,
        spacesOrgMemberId: authData.memberId,
        workspaceId: authData.workspaceId,
        // Required by the webhook contract. The run is polled through
        // `/claw/runs/:sessionId` rather than delivered here, but claw-auth
        // rejects a run without somewhere to call back to.
        callbackUrl: config.xyneClaw.callbackUrl,
        ...(input.conversationId ? { conversationId: input.conversationId } : {}),
        ...(input.channelId ? { channelId: input.channelId } : {}),
        ...(input.context ? { context: input.context } : {}),
      });
      return { sessionId: result.sessionId };
    },
  },
  {
    method: 'get',
    path: '/claw/runs/:sessionId',
    service: async (req, auth) => {
      const sessionId = req.params['sessionId'];
      if (!sessionId) throw new SdkApiError('validation_failed', 'sessionId is required.');
      const status = await getS2SClawRunStatus(sessionId, auth.authData.sub);
      if (!status) throw SdkApiError.notFound('Claw run');
      return status;
    },
  },
];

/** Build the router for every direct operation. */
export function createDirectRouter(): Router {
  const router = Router();

  for (const route of ROUTES) {
    router[route.method](
      route.path,
      ...(route.middleware ?? []),
      handle(async (req: Request, res: Response) => {
        if (route.service) {
          const auth = req.sdkAuth;
          if (!auth) throw new SdkApiError('unauthenticated', 'Missing authenticated principal.');
          if (route.query) route.query.parse(req.query);
          if (route.body) route.body.parse(req.body);
          try {
            res.status(200).json(await route.service(req, auth));
          } catch (err) {
            throw err instanceof SdkApiError
              ? err
              : new SdkApiError('internal', serviceMessage(err), { cause: err });
          }
          return;
        }

        const result = await callController(route, req);
        for (const [name, value] of Object.entries(result.headers)) {
          res.setHeader(name, value);
        }
        if (result.status === 204 || result.body === undefined) {
          res.status(result.status).end();
          return;
        }
        res.status(result.status).json(result.body);
      }),
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
  route: DirectRoute & { controller: Controller },
  req: Request,
): Promise<ControllerResult> {
  const auth = req.sdkAuth;
  if (!auth) throw new SdkApiError('unauthenticated', 'Missing authenticated principal.');

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
    throw new SdkApiError('internal', 'The handler produced no response.');
  }
  if (status >= 400) throw controllerError(status, body);

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
    throw new SdkApiError('internal', body.error ?? 'The request failed.');
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

function controllerError(status: number, body: unknown): SdkApiError {
  const payload = body as { error?: unknown; message?: unknown } | undefined;
  const message =
    (typeof payload?.message === 'string' && payload.message) ||
    (typeof payload?.error === 'string' && payload.error) ||
    'Request failed.';

  switch (status) {
    case 400:
    case 409:
    case 422:
      return new SdkApiError('validation_failed', message);
    case 401:
      return new SdkApiError('unauthenticated', message);
    case 403:
      return new SdkApiError('forbidden', message);
    case 404:
      return new SdkApiError('not_found', message);
    default:
      return new SdkApiError('internal', 'The handler failed.', { cause: body });
  }
}

/**
 * A service failure message.
 *
 * `clawAgentService` throws plain `Error`s whose text names the upstream and the
 * status, which is worth keeping — but only the message, never the cause, since
 * the cause can carry the deployment's service credential.
 */
function serviceMessage(err: unknown): string {
  return err instanceof Error ? err.message : 'The upstream service failed.';
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
