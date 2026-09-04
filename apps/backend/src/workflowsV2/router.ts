/**
 * Express adapter for the `@xyne/workflow-sdk` HTTP surface.
 *
 * `createWorkflowRouter` returns plain `RouteDefinition[]` — `{ method, path, handler }`
 * with no framework coupling. This file is the glue: Express request → `RouteRequest`,
 * `RouteResponse` → Express response, in both directions, including SSE, binary and
 * redirects.
 *
 * Two routers come out, and which route lands on which is decided HERE rather than by
 * the SDK's own `authenticated` flag:
 *  - `workflowsTriggerRouter` — the app-token trigger route. Mounted BEFORE the session
 *    middleware, because an app JWT is signed with the app's secret and `authenticate`
 *    cannot verify one.
 *  - `workflowsRouter` — everything else, mounted behind the session.
 *
 * Nothing is exposed anonymously. See {@link APP_AUTH_ROUTES}.
 */
import express, { type Request, type Response, type Router } from 'express';
import { createWorkflowRouter, type RouteRequest } from '@xyne/workflow-sdk';
import { logger } from '@/utils/logger';
import { uploadConfig } from '@/middleware/upload';
import { authenticateApp } from '@/apps/middelware/authenticator';
import { webhookLimiter } from '@/middleware/rateLimiters';
import { requirePermission } from '@/middleware/requirePermission';
import { ShareableEntityType } from '@xyne/shared';
import { appResourceAccessService } from '@/services/appResourceAccessService';
import { persistence, workflowRuntime } from './runtime';
import { attrsOf } from './utils';
import type { XyneCtx } from './types';

/**
 * Route key → the path param naming the workflow it acts on. The only routes not behind
 * the session: anything the SDK marks `authenticated: false` and absent here is mounted
 * behind it anyway, so a new SDK public route fails closed. Re-check on an SDK bump.
 */
const APP_AUTH_ROUTES = new Map<string, string>([
  ['POST /v2/workflows/:workflowId/trigger/v2', 'workflowId'],
]);

const routeKey = (method: string, path: string): string => `${method} ${path}`;

/**
 * Both are `available_app_permissions` rows — `scripts/seed-app-permissions.ts` seeds them
 * locally, the 20260903000000 migration everywhere else, since nothing runs that on deploy.
 */
const scopeForMethod = (method: string): string =>
  method.toUpperCase() === 'GET' ? 'workflows:read' : 'workflows:write';

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

const buildRouteRequest = (req: Request): RouteRequest => {
  const body: unknown = req.body;

  // Ported from xyne-search, where `{"$ne":"test"}` arrived as a name and crashed the UI on
  // `name.toLowerCase()`. Only the type is wrong there — the value itself is inert, and is
  // stored as JSON and rendered by React.
  if (body && typeof body === 'object' && !Array.isArray(body) && 'name' in body) {
    const rawName = (body as Record<string, unknown>)['name'];
    if (rawName !== undefined && rawName !== null && typeof rawName !== 'string') {
      throw Object.assign(new Error('`name` must be a string'), { statusCode: 400 });
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

  return {
    params: req.params as Record<string, string>,
    query: req.query as Record<string, string | string[] | undefined>,
    body,
    headers: req.headers as Record<string, string | string[] | undefined>,
    ...(files.length > 0 ? { files } : {}),
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

  res.status(response.status).json(response.body);
};

export const workflowRouteDefinitions = (): ReturnType<typeof createWorkflowRouter<XyneCtx>> =>
  createWorkflowRouter<XyneCtx>(workflowRuntime, {
    // Never reached: every route is mounted behind Express middleware that establishes the
    // principal, so the SDK is never asked to authenticate one itself.
    authenticate: () => {
      throw Object.assign(new Error('Unauthorized'), { statusCode: 401 });
    },
  });

const mount = (router: Router, appAuth: boolean): void => {
  for (const route of workflowRouteDefinitions()) {
    const key = routeKey(route.method, route.path);
    const workflowIdParam = APP_AUTH_ROUTES.get(key);
    if (Boolean(workflowIdParam) !== appAuth) continue;

    const method = route.method.toLowerCase() as 'get' | 'post' | 'put' | 'delete';

    // Order is load-bearing: the guard runs before multer, so an unauthenticated upload
    // is refused without buffering a byte of it.
    const middleware = [
      ...(appAuth
        ? [webhookLimiter, authenticateApp, requirePermission(scopeForMethod(route.method))]
        : []),
      ...(route.multipart ? [uploadConfig.any()] : []),
    ];

    router[method](route.path, ...middleware, (req: Request, res: Response) => {
      void (async () => {
        try {
          const ctx = ctxFromRequest(req);
          if (workflowIdParam) await assertTriggerableWorkflow(req, ctx, workflowIdParam);

          const routeRequest = buildRouteRequest(req);

          if (ATTRIBUTE_INJECTED_ROUTES.has(key)) {
            const body = (routeRequest.body ?? {}) as Record<string, unknown>;
            body['attributes'] = { workspaceId: ctx.workspaceId, createdByUserId: ctx.userId };
            (routeRequest as { body: unknown }).body = body;
          }

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

/** Mounted before the session middleware — registers only {@link APP_AUTH_ROUTES}, so
 *  every other request falls through to `workflowsRouter`. */
export const workflowsTriggerRouter: Router = express.Router();
mount(workflowsTriggerRouter, true);

export const workflowsRouter: Router = express.Router();
mount(workflowsRouter, false);
