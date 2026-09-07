/**
 * Express adapter for the `@xyne/workflow-sdk` HTTP surface.
 *
 * `createWorkflowRouter` returns plain `RouteDefinition[]` — `{ method, path, handler }`
 * with no framework coupling. This file is the glue: Express request → `RouteRequest`,
 * `RouteResponse` → Express response, in both directions, including SSE, binary and
 * redirects.
 *
 * Two routers come out, and the split matters:
 *  - `workflowsPublicRouter` — routes the SDK marks `authenticated: false`. Their
 *    authorization is a secret in the path, so they mount BEFORE the auth middleware.
 *  - `workflowsRouter` — everything else, mounted behind it.
 */
import express, { type Request, type Response, type Router } from 'express';
import { createWorkflowRouter, type RouteRequest } from '@xyne/workflow-sdk';
import { logger } from '@/utils/logger';
import { uploadConfig } from '@/middleware/upload';
import { workflowRuntime } from './runtime';
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

const buildRouteRequest = (req: Request): RouteRequest => {
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

const mount = (router: Router, authenticated: boolean): void => {
  const routes = createWorkflowRouter<XyneCtx>(workflowRuntime, {
    // Only consulted for unauthenticated routes, whose authorization is a path secret —
    // so reaching it at all means a route was misclassified.
    authenticate: () => {
      throw Object.assign(new Error('Unauthorized'), { statusCode: 401 });
    },
  });

  for (const route of routes) {
    const isPublic = route.authenticated === false;
    if (isPublic !== !authenticated) continue;

    const method = route.method.toLowerCase() as 'get' | 'post' | 'put' | 'delete';
    const key = `${route.method} ${route.path}`;

    // The SDK tells us which routes need a multipart parser; run multer only there so
    // ordinary JSON routes are untouched.
    const middleware = route.multipart ? [uploadConfig.any()] : [];

    router[method](route.path, ...middleware, (req: Request, res: Response) => {
      void (async () => {
        try {
          const ctx = authenticated ? ctxFromRequest(req) : null;
          const routeRequest = buildRouteRequest(req);

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
mount(workflowsPublicRouter, false);
