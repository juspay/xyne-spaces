import express, { type Request, type Response, type Router } from 'express';
import { createWorkflowRouter, type RouteAccess, type RouteRequest } from '@xyne/workflow-sdk';
import { db } from '@/database/client';
import { logger } from '@/utils/logger';
import { webhookLimiter } from '@/middleware/rateLimiters';
import { uploadConfig } from '@/middleware/upload';
import { ShareableEntityType } from '@xyne/shared';
import { appResourceAccessService } from '@/services/appResourceAccessService';
import { SDLC_AUTHOR_METADATA_KEY, sdlcAuthorOf } from './agents/sdlc-dispatch';
import { persistence, workflowRuntime } from './runtime';
import { attrsOf } from './utils';
import type { XyneCtx } from './types';

/**
 * A workflow or folder name must be a well-formed string.
 *
 * Ported from xyne-search, where a JSON object arrived here as `{"$ne":"test"}` — a
 * NoSQL-injection probe — and crashed the analytics UI on `name.toLowerCase()`. The
 * character set is deliberately conservative: it covers every real name while refusing
 * the shapes that turn a name into a payload.
 */
const NAME_PATTERN = /^[A-Za-z0-9 _()+-]+$/;

/**
 * Route key → the path param naming the workflow it acts on. Mounted behind app auth
 * rather than the session, and absent from {@link PUBLIC_ALLOWED_ROUTES} so nothing else
 * exposes it. Re-check on an SDK bump.
 */
const APP_AUTH_ROUTES = new Map<string, string>([
  ['POST /v2/workflows/:workflowId/trigger/v2', 'workflowId'],
]);

/**
 * The SDK is generic over the caller's ctx and never inspects it. Ours comes from the
 * authenticated session — never from the request body.
 */
const ctxFromRequest = (req: Request): XyneCtx => {
  const user = req.user;
  if (!user?.id || !user?.workspaceId) {
    throw new Error('workflows router: no authenticated principal on the request');
  }
  return { userId: user.id, workspaceId: user.workspaceId };
};

/**
 * Routes that create a resource must carry the tenant it belongs to.
 *
 * Injected here from the session and **overwriting anything the client sent**: the SDK
 * passes `attributes` through to the persistence adapter opaquely, so a browser-supplied
 * value would decide which workspace a workflow lands in. `createdByUserId` is consumed at
 * create to stamp ownership and is not persisted.
 */
const ATTRIBUTE_INJECTED_ROUTES = new Set(['POST /workflows', 'POST /folders', 'POST /credentials']);

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);

/** SDLC steps act as this author, so only the server sets it: whoever last changed the steps. */
const guardSdlcAuthor = async (key: string, request: RouteRequest, ctx: XyneCtx): Promise<void> => {
  const body = request.body;
  if (!isPlainObject(body)) return;

  if (key === 'POST /workflows' || key === 'PUT /workflows/:id') {
    const sent = body['metadata'];
    const metadata = isPlainObject(sent) ? { ...sent } : {};
    delete metadata[SDLC_AUTHOR_METADATA_KEY];
    if (body['config']) metadata[SDLC_AUTHOR_METADATA_KEY] = ctx.userId;
    if (sent !== undefined || body['config']) body['metadata'] = metadata;
    return;
  }

  if (key === 'POST /executions/:execId/rerun' && body['configOverrides']) {
    const execution = await db.workflowExecution.findFirst({
      where: { id: request.params['execId'] ?? '', workspaceId: ctx.workspaceId },
      select: { workflow: { select: { metadata: true } } },
    });
    const author = sdlcAuthorOf(execution?.workflow.metadata);
    if (author && author !== ctx.userId) {
      throw Object.assign(new Error('Only the workflow author can rerun it with changed steps'), {
        statusCode: 403,
      });
    }
  }
};

/**
 * The authorization the SDK skips: the handler discards its `auth` and calls
 * `triggerWebhookV2Public`, which by its own documentation "intentionally bypasses caller
 * authorization". The workflow must be in the caller's workspace AND attached to this app.
 *
 * Both lookups always run, so "no such workflow", "not yours" and "not attached" give the
 * same 404 at the same cost and cannot be told apart.
 */
const installedAppIdOf = (req: Request): string | null => {
  const auth = (req as { auth?: { installedAppId?: unknown } }).auth;
  return typeof auth?.installedAppId === 'string' ? auth.installedAppId : null;
};

const assertTriggerableWorkflow = async (
  req: Request,
  ctx: XyneCtx,
  param: string,
): Promise<void> => {
  const workflowId = req.params[param];
  const installedAppId = installedAppIdOf(req);
  const [workflow, attached] = await Promise.all([
    workflowId ? persistence.getWorkflow(workflowId) : Promise.resolve(null),
    workflowId && installedAppId
      ? appResourceAccessService.isAttached({
          workspaceId: ctx.workspaceId,
          installedAppId,
          entityType: ShareableEntityType.WORKFLOW,
          entityId: workflowId,
        })
      : Promise.resolve(false),
  ]);

  const ownedByCaller =
    workflow !== null && attrsOf(workflow.attributes)?.workspaceId === ctx.workspaceId;

  if (ownedByCaller && !attached) {
    // A bare 404 and the wrapper only logs at 5xx, so this is the only trace an admin gets.
    logger.warn(
      `[workflows] install ${String(installedAppId)} is not attached to workflow ${String(workflowId)}`,
    );
  }

  if (!ownedByCaller || !attached) {
    throw Object.assign(new Error('Workflow not found'), { statusCode: 404 });
  }
};

const buildRouteRequest = (req: Request, rawBodyRoute: boolean): RouteRequest => {
  const body: unknown = req.body;

  if (body && typeof body === 'object' && !Array.isArray(body) && 'name' in body) {
    const rawName = (body as Record<string, unknown>)['name'];
    if (rawName !== undefined && rawName !== null) {
      if (typeof rawName !== 'string' || !NAME_PATTERN.test(rawName)) {
        throw Object.assign(
          new Error('`name` may contain only letters, digits, spaces, and _ ( ) + -'),
          { statusCode: 400 },
        );
      }
    }
  }

  // Multer puts parsed files on req.files; the SDK's upload routes read them from here.
  const multerFiles = Array.isArray(req.files) ? req.files : [];
  const files = multerFiles.map((f) => ({
    fieldName: f.fieldname,
    name: f.originalname,
    mimeType: f.mimetype,
    bytes: new Uint8Array(f.buffer),
  }));

  const rawBody = Buffer.isBuffer(body)
    ? new Uint8Array(body)
    : rawBodyRoute
      ? new Uint8Array()
      : undefined;

  return {
    params: req.params as Record<string, string>,
    query: req.query as Record<string, string | string[] | undefined>,
    body,
    headers: req.headers as Record<string, string | string[] | undefined>,
    ...(files.length > 0 ? { files } : {}),
    ...(rawBody ? { rawBody } : {}),
  };
};

const sendRouteResponse = async (
  res: Response,
  response: Awaited<ReturnType<ReturnType<typeof createWorkflowRouter>[number]['handler']>>,
  routePath: string,
  downloadName: string,
): Promise<void> => {
  if (response.headers) {
    for (const [k, v] of Object.entries(response.headers)) res.setHeader(k, v);
  }

  // SSE — the execution event stream.
  if (response.stream) {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();
    for await (const chunk of response.stream) res.write(chunk);
    res.end();
    return;
  }

  // Redirect (a signed attachment URL, if a storage adapter ever provides one).
  const location = response.headers?.['Location'];
  if (response.status >= 300 && response.status < 400 && location) {
    res.redirect(response.status, location);
    return;
  }

  // Binary — attachment bytes streamed through `storage.read`.
  if (response.body instanceof Uint8Array) {
    // Defence in depth. The SDK already sets these on /attachments, but this route emits
    // raw user-uploaded bytes: an uploaded HTML or SVG must never render in the app
    // origin. Re-asserting here means it holds even against an SDK version that stops.
    if (routePath === '/attachments') {
      res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(downloadName)}"`);
      res.setHeader('X-Content-Type-Options', 'nosniff');
    }
    res.status(response.status).end(Buffer.from(response.body));
    return;
  }

  const contentType = Object.entries(response.headers ?? {}).find(
    ([name]) => name.toLowerCase() === 'content-type',
  )?.[1];
  if (typeof response.body === 'string' && contentType?.toLowerCase().startsWith('text/plain')) {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.status(response.status).send(response.body);
    return;
  }

  res.status(response.status).json(response.body);
};

const PUBLIC_ALLOWED_ROUTES = new Set([
  'POST /webhooks/:workflowId',
  'GET /webhooks/:workflowId',
]);

const CLAW_ALLOWED_ROUTES = new Set([
  'GET /schema/steps',
  'GET /schema/steps/:type',
  'GET /schema/triggers',
  'GET /schema/triggers/:type',
  'GET /schema/operators',
  'POST /schema/available-context',
  'GET /capabilities',
  // Authoring.
  'GET /workflows',
  'GET /workflows/counts',
  'GET /workflows/:id',
  'POST /workflows',
  'PUT /workflows/:id',
  'POST /workflows/validate',
  'POST /workflows/:id/deactivate',
  'GET /folders',
  'GET /folders/:id',
  'POST /folders',
  'POST /workflows/:id/trigger',
  'GET /executions',
  'GET /executions/pending-approvals',
  'GET /executions/:execId',
  'GET /executions/:execId/steps/:stepName/events',
  'POST /executions/:execId/rerun',
  'POST /executions/:execId/cancel',
  'GET /analytics/summary',
  'GET /analytics/top-errors',
]);

const needsSession = (access: RouteAccess): boolean => {
  switch (access) {
    case 'session':
      return true;
    case 'provider':
      return false;
  }
};

const mount = (
  router: Router,
  authenticated: boolean,
  allow?: ReadonlySet<string>,
  guards: readonly express.RequestHandler[] = [],
): void => {
  const routes = createWorkflowRouter<XyneCtx>(workflowRuntime, {
    authenticate: () => {
      throw Object.assign(new Error('Unauthorized'), { statusCode: 401 });
    },
  });

  for (const route of routes) {
    if (needsSession(route.access) !== authenticated) continue;

    const method = route.method.toLowerCase() as 'get' | 'post' | 'put' | 'delete';
    const key = `${route.method} ${route.path}`;
    const workflowIdParam = APP_AUTH_ROUTES.get(key);

    if (allow && !allow.has(key)) continue;

    const middleware: express.RequestHandler[] = route.multipart
      ? [uploadConfig.any()]
      : route.rawBody
        ? [express.raw({ type: () => true, limit: '10mb' })]
        : [express.json({ limit: '10mb' })];

    router[method](route.path, ...guards, ...middleware, (req: Request, res: Response) => {
      void (async () => {
        try {
          const ctx = authenticated || workflowIdParam ? ctxFromRequest(req) : null;
          if (ctx && workflowIdParam) await assertTriggerableWorkflow(req, ctx, workflowIdParam);

          const routeRequest = buildRouteRequest(req, route.rawBody === true);

          if (ctx && ATTRIBUTE_INJECTED_ROUTES.has(key)) {
            const body = (routeRequest.body ?? {}) as Record<string, unknown>;
            body['attributes'] = { workspaceId: ctx.workspaceId, createdByUserId: ctx.userId };
            (routeRequest as { body: unknown }).body = body;
          }
          if (ctx) await guardSdlcAuthor(key, routeRequest, ctx);

          const response = await route.handler(routeRequest, ctx);
          const name = typeof req.query['name'] === 'string' ? req.query['name'] : 'download';
          await sendRouteResponse(res, response, route.path, name);
        } catch (err) {
          const status = (err as { statusCode?: number }).statusCode ?? 500;
          const message = err instanceof Error ? err.message : 'Internal error';
          if (status >= 500) {
            logger.error(`[workflows] ${key} failed`, err);
          }
          if (!res.headersSent) res.status(status).json({ error: message });
        }
      })();
    });
  }
};

export const workflowsRouter: Router = express.Router();
mount(workflowsRouter, true);

export const workflowsPublicRouter: Router = express.Router();
mount(workflowsPublicRouter, false, PUBLIC_ALLOWED_ROUTES, [webhookLimiter]);
export const workflowsClawRouter: Router = express.Router();
mount(workflowsClawRouter, true, CLAW_ALLOWED_ROUTES);

/** Registers only {@link APP_AUTH_ROUTES}; mounted under `/api/apps/workflows` behind `authenticateApp`. */
export const workflowsAppRouter: Router = express.Router();
mount(workflowsAppRouter, false, new Set(APP_AUTH_ROUTES.keys()));
