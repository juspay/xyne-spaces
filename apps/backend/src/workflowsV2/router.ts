import { pipeline } from 'node:stream/promises';
import express, { type Request, type Response, type Router } from 'express';
import { createWorkflowRouter, type RouteAccess, type RouteRequest } from '@xyne/workflow-sdk';
import { logger } from '@/utils/logger';
import { webhookLimiter } from '@/middleware/rateLimiters';
import { workflowAttachmentUpload } from '@/middleware/upload';
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

/** The workflow a run belongs to, for the upload scope check. */
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
): void => {
  const routes = createWorkflowRouter<XyneCtx>(workflowRuntime, {
    authenticate: () => {
      throw Object.assign(new Error('Unauthorized'), { statusCode: 401 });
    },
  });

  for (const route of routes) {
    const method = route.method.toLowerCase() as 'get' | 'post' | 'put' | 'delete';
    const key = `${route.method} ${route.path}`;

    if (needsSession(route.access) !== authenticated) continue;
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

    router[method](route.path, ...guards, ...middleware, (req: Request, res: Response) => {
      void (async () => {
        try {
          const ctx = authenticated ? ctxFromRequest(req) : null;

          const routeRequest = buildRouteRequest(req, route.rawBody === true);

          if (ctx && ATTRIBUTE_INJECTED_ROUTES.has(key)) {
            const body = (routeRequest.body ?? {}) as Record<string, unknown>;
            body['attributes'] = { workspaceId: ctx.workspaceId, createdByUserId: ctx.userId };
            (routeRequest as { body: unknown }).body = body;
          }

          const response = await route.handler(routeRequest, ctx);
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
