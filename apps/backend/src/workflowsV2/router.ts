import { pipeline } from 'node:stream/promises';
import express, { type Request, type Response, type Router } from 'express';
import { createWorkflowRouter, type RouteAccess, type RouteRequest } from '@xyne/workflow-sdk';
import { db } from '@/database/client';
import { logger } from '@/utils/logger';
import { appWorkflowLimiter, webhookLimiter } from '@/middleware/rateLimiters';
import { workflowAttachmentUpload } from '@/middleware/upload';
import { ShareableEntityType } from '@xyne/shared';
import { appResourceAccessService } from '@/services/appResourceAccessService';
import { SDLC_AUTHOR_METADATA_KEY, sdlcAuthorOf } from './agents/identity';
import { isRecord } from './agents/claw-provider';
import { RUN_STARTING_ROUTES, withRunStarter } from './runStarter';
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

/** The workflow a run belongs to, for the upload scope check and the app attachment guard. */
const workflowOfExecution = async (id: unknown): Promise<string | undefined> => {
  if (typeof id !== 'string' || id === '') return undefined;
  return (await persistence.getExecution(id))?.workflowId ?? undefined;
};

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

/** SDLC steps act as this author, so only the server sets it: whoever last changed the steps. */
const guardSdlcAuthor = async (key: string, request: RouteRequest, ctx: XyneCtx): Promise<void> => {
  const body = request.body;
  if (!isRecord(body)) return;

  if (key !== 'POST /workflows' && key !== 'PUT /workflows/:id') return;
  const sent = body['metadata'];
  const metadata = isRecord(sent) ? { ...sent } : {};
  delete metadata[SDLC_AUTHOR_METADATA_KEY];
  if (body['config']) metadata[SDLC_AUTHOR_METADATA_KEY] = ctx.userId;
  else if (sent !== undefined && key === 'PUT /workflows/:id') {
    // Metadata replaces whole: keep the author the steps were last saved by.
    const stored = await db.workflow.findFirst({
      where: { id: request.params['id'] ?? '', workspaceId: ctx.workspaceId },
      select: { metadata: true },
    });
    const author = sdlcAuthorOf(stored?.metadata);
    if (author) metadata[SDLC_AUTHOR_METADATA_KEY] = author;
  }
  if (sent !== undefined || body['config']) body['metadata'] = metadata;
};

/** How to find the workflow a request acts on; `undefined` is refused as "not found". */
type WorkflowUnderTest = (req: Request) => Promise<string | undefined>;

/** Mirrors the SDK's `str()`: blank counts as absent. */
const nonBlank = (v: unknown): string | undefined =>
  typeof v === 'string' && v.trim() !== '' ? v : undefined;

/**
 * Route key → how to find the workflow it acts on. Mounted behind app auth rather than
 * the session, and absent from {@link PUBLIC_ALLOWED_ROUTES} so nothing else exposes it.
 * Re-check on an SDK bump.
 *
 * A trigger names its workflow in the path. A conversation names it only when it starts;
 * after that it is identified by the run it created, so the workflow behind it is looked
 * up. A wait is answered on a run, likewise. Either way the same check follows: in this
 * workspace, attached to this install.
 */
const APP_AUTH_ROUTES = new Map<string, WorkflowUnderTest>([
  ['POST /v2/workflows/:workflowId/trigger/v2', (req) => Promise.resolve(req.params['workflowId'])],
  ['POST /executions/:execId/waits/:stepId', (req) => workflowOfExecution(req.params['execId'])],
  [
    'POST /conversations',
    (req) => {
      const body: unknown = req.body;
      const b = body && typeof body === 'object' && !Array.isArray(body) ? (body as Record<string, unknown>) : {};
      // Same precedence as the SDK: a conversationId wins, and workflowId is only read to
      // start. Reading workflowId first would let an attached id vouch for someone else's run.
      const conversationId = nonBlank(b['conversationId']);
      return conversationId ? workflowOfExecution(conversationId) : Promise.resolve(nonBlank(b['workflowId']));
    },
  ],
  ['GET /conversations/:id', (req) => workflowOfExecution(req.params['id'])],
  ['POST /conversations/:id/end', (req) => workflowOfExecution(req.params['id'])],
]);

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
  find: WorkflowUnderTest,
): Promise<void> => {
  const workflowId = await find(req);
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

const resolveWorkflowUploadScope: express.RequestHandler = (req, res, next) => {
  void (async () => {
    const fromSession = req.user?.workspaceId;
    if (fromSession) {
      (req as { workflowUploadWorkspaceId?: string }).workflowUploadWorkspaceId = fromSession;
      next();
      return;
    }

    const execId = req.params['execId'];
    if (typeof execId === 'string' && execId !== '') {
      const workflowId = await workflowOfExecution(execId);
      const workflow = workflowId ? await persistence.getWorkflow(workflowId) : null;
      const workspaceId = attrsOf(workflow?.attributes)?.workspaceId;
      if (workspaceId) {
        (req as { workflowUploadWorkspaceId?: string }).workflowUploadWorkspaceId = workspaceId;
        next();
        return;
      }
    }

    // No session and no run to inherit from: refuse before reading a byte.
    res.status(404).json({ error: 'Not found' });
  })().catch(next);
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

  // Multer streamed each part into storage as it parsed; a route sees the
  // reference, never the bytes. `path` is the key it filed under.
  const multerFiles = Array.isArray(req.files) ? req.files : [];
  const files = multerFiles.map((f) => ({
    fieldName: f.fieldname,
    attachment: {
      name: f.originalname,
      mimeType: f.mimetype,
      handle: f.path,
      size: f.size,
    },
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

  if (response.bodyStream) {
    if (routePath === '/attachments') {
      res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(downloadName)}"`);
      res.setHeader('X-Content-Type-Options', 'nosniff');
    }
    res.status(response.status);
    await pipeline(response.bodyStream as NodeJS.ReadableStream, res);
    return;
  }

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
  appAuth?: ReadonlyMap<string, WorkflowUnderTest>,
): void => {
  const routes = createWorkflowRouter<XyneCtx>(workflowRuntime, {
    authenticate: () => {
      throw Object.assign(new Error('Unauthorized'), { statusCode: 401 });
    },
  });

  for (const route of routes) {
    const method = route.method.toLowerCase() as 'get' | 'post' | 'put' | 'delete';
    const key = `${route.method} ${route.path}`;
    const findWorkflow = appAuth?.get(key);

    // App-auth routes bypass the filter: the conversation routes are `session` in the SDK
    // but are mounted here behind app auth.
    if (!findWorkflow && needsSession(route.access) !== authenticated) continue;
    if (allow && !allow.has(key)) continue;

    const middleware: express.RequestHandler[] = route.multipart
      ? [
          resolveWorkflowUploadScope,
          workflowAttachmentUpload.any(),
          express.json({ limit: '10mb' }),
        ]
      : route.rawBody
        ? [express.raw({ type: () => true, limit: '10mb' })]
        : [express.json({ limit: '10mb' })];

    const attachGuard: express.RequestHandler[] = findWorkflow
      ? [
          (req, res, next) => {
            void assertTriggerableWorkflow(req, ctxFromRequest(req), findWorkflow).then(
              () => next(),
              (err: unknown) => {
                const status = (err as { statusCode?: number }).statusCode ?? 500;
                if (status >= 500) logger.error(`[workflows] ${key} guard failed`, err);
                res.status(status).json({ error: status < 500 ? (err as Error).message : 'Internal error' });
              },
            );
          },
        ]
      : [];

    // Multipart: the guard goes before the parser, which writes files to storage as it
    // parses, so an unattached app is refused before it reads a byte (ids are in the path).
    // JSON: after the parser, because `POST /conversations` names its workflow in the body.
    const chain = route.multipart ? [...attachGuard, ...middleware] : [...middleware, ...attachGuard];

    router[method](route.path, ...guards, ...chain, (req: Request, res: Response) => {
      void (async () => {
        try {
          const ctx = authenticated || findWorkflow ? ctxFromRequest(req) : null;

          const routeRequest = buildRouteRequest(req, route.rawBody === true);

          if (ctx && ATTRIBUTE_INJECTED_ROUTES.has(key)) {
            const body = (routeRequest.body ?? {}) as Record<string, unknown>;
            body['attributes'] = { workspaceId: ctx.workspaceId, createdByUserId: ctx.userId };
            (routeRequest as { body: unknown }).body = body;
          }
          if (ctx) await guardSdlcAuthor(key, routeRequest, ctx);

          const response = ctx && RUN_STARTING_ROUTES.has(key)
            ? await withRunStarter(ctx.userId, () => route.handler(routeRequest, ctx))
            : await route.handler(routeRequest, ctx);
          const name = typeof req.query['name'] === 'string' ? req.query['name'] : 'download';
          await sendRouteResponse(res, response, route.path, name);
        } catch (err) {
          const status = (err as { statusCode?: number }).statusCode ?? 500;
          const message = status < 500 && err instanceof Error ? err.message : 'Internal error';
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

/** Registers only {@link APP_AUTH_ROUTES}; mounted under `/api/apps/workflows` behind `authenticateApp`. */
export const workflowsAppRouter: Router = express.Router();
mount(workflowsAppRouter, false, new Set(APP_AUTH_ROUTES.keys()), [appWorkflowLimiter], APP_AUTH_ROUTES);
