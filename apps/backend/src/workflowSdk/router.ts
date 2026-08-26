// Express glue over the SDK's framework-agnostic route definitions.
//
// Two routers, both mounted at /api/workflow-studio (app.ts):
//   workflowSdkPublicRouter — no auth; the secret in the path is the credential.
//   workflowSdkRouter       — behind authMiddleware; ctx comes from req.user.
//
// The `authenticate` option below is never invoked for routes we wire manually
// — host glue owns auth (same pattern as xyne-search).

import express from 'express';
import multer from 'multer';
import rateLimit from 'express-rate-limit';
import { createWorkflowRouter, AccessDeniedError, ResourceNotFoundError } from '@xyne/workflow-sdk';
import type { RouteRequest } from '@xyne/workflow-sdk';
import { logger } from '@/utils/logger';
import { db } from '@/database/client';
import { workflowSdkRuntime } from './runtime';
import { isWorkflowStudioAdmin } from './accessControl';
import { SDK_WORKFLOW_TYPE } from './acl';
import type { XyneCtx } from './acl';

const routeDefs = createWorkflowRouter(workflowSdkRuntime, {
  authenticate: () => {
    throw new Error('Unauthorized');
  },
});

type SdkRouteDef = (typeof routeDefs)[number];

const routeKey = (r: SdkRouteDef): string => `${r.method} ${r.path}`;

// Unauthenticated routes we expose publicly. An allow-list rather than
// `filter(authenticated === false)`, so a new unauthenticated route in a future
// SDK version can't silently become public — it lands in `withheldRouteDefs`
// and is logged at boot. Both entries carry a 24-byte secret in the path.
const PUBLIC_ROUTE_ALLOWLIST = new Set([
  'POST /webhooks/:workflowId/:secret',
  'POST /wait/callback/:secret/:executionId',
]);

// Routes the SDK ships unauthenticated that we require auth for anyway. The
// multipart trigger accepts uploads and starts an execution, so it goes behind
// authMiddleware — which already accepts `Bearer <api key>` (middleware/auth.ts)
// as well as browser sessions, covering external callers without a new key
// system. Its handler ignores `auth` and calls runtime.*Public(), so it does no
// tenant scoping — requireWorkflowOwned supplies that.
const AUTH_REQUIRED_OVERRIDE = new Set(['POST /v2/workflows/:workflowId/trigger/v2']);

// Routes whose SDK handler never consults the authorizer, so the action set
// this.permissions() computes for a credential does not gate them. /test
// decrypts the named credential and sends it to a caller-supplied URL, which
// is credential:manage in everything but name — so it is held to the same
// WORKFLOW-STUDIO ADMIN rule the authorizer applies.
const ADMIN_REQUIRED = new Set(['POST /credentials/:name/test']);

const unauthenticatedDefs = routeDefs.filter(r => r.authenticated === false);
const publicRouteDefs = unauthenticatedDefs.filter(r => PUBLIC_ROUTE_ALLOWLIST.has(routeKey(r)));
const withheldRouteDefs = unauthenticatedDefs.filter(
  r => !PUBLIC_ROUTE_ALLOWLIST.has(routeKey(r)) && !AUTH_REQUIRED_OVERRIDE.has(routeKey(r)),
);
const authenticatedRouteDefs = routeDefs.filter(
  r => r.authenticated !== false || AUTH_REQUIRED_OVERRIDE.has(routeKey(r)),
);

// Express has no `router[method]` that narrows, so the dispatch table lives
// here once rather than as a switch at each of the two mount loops.
const mount = (
  router: express.Router,
  routeDef: SdkRouteDef,
  middlewares: express.RequestHandler[],
  handler: express.RequestHandler,
): void => {
  switch (routeDef.method) {
    case 'GET':
      router.get(routeDef.path, ...middlewares, handler);
      break;
    case 'POST':
      router.post(routeDef.path, ...middlewares, handler);
      break;
    case 'PUT':
      router.put(routeDef.path, ...middlewares, handler);
      break;
    case 'DELETE':
      router.delete(routeDef.path, ...middlewares, handler);
      break;
  }
};

const upload = multer({ storage: multer.memoryStorage() });

const multerMiddlewares = (multipart?: 'files' | 'any'): express.RequestHandler[] =>
  multipart === 'files' ? [upload.array('files')] : multipart === 'any' ? [upload.any()] : [];

const buildRouteRequest = (
  req: express.Request,
  injectBodyPatch?: (body: Record<string, unknown>) => void,
): RouteRequest => {
  const multerFiles = (req as unknown as { files?: Express.Multer.File[] }).files;
  const files = Array.isArray(multerFiles)
    ? multerFiles.map(f => ({
        fieldName: f.fieldname,
        name: f.originalname,
        mimeType: f.mimetype,
        bytes: new Uint8Array(f.buffer.buffer, f.buffer.byteOffset, f.buffer.byteLength),
      }))
    : undefined;

  let body: unknown = req.body;
  if (injectBodyPatch) {
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      body = {};
    }
    injectBodyPatch(body as Record<string, unknown>);
  }

  return {
    params: req.params as Record<string, string>,
    query: req.query as Record<string, string | string[] | undefined>,
    body,
    headers: req.headers as Record<string, string | string[] | undefined>,
    ...(files ? { files } : {}),
  };
};

// A workflow/folder `name` must be a well-formed string with a conservative
// character set — rejects NoSQL-injection-shaped objects and special
// characters while covering every real name (same guard as xyne-search).
const validateNameField = (body: unknown, res: express.Response): boolean => {
  if (body && typeof body === 'object' && 'name' in body) {
    const rawName = (body as Record<string, unknown>).name;
    if (rawName != null) {
      if (typeof rawName !== 'string') {
        res.status(400).json({ error: '`name` must be a string' });
        return false;
      }
      if (!/^[A-Za-z0-9 _()+-]+$/.test(rawName)) {
        res.status(400).json({
          error: '`name` may contain only letters, digits, spaces, and _ ( ) + -',
        });
        return false;
      }
    }
  }
  return true;
};

const dispatch = async (
  routeDef: SdkRouteDef,
  req: express.Request,
  res: express.Response,
  ctx: XyneCtx | null,
  injectBodyPatch?: (body: Record<string, unknown>) => void,
): Promise<void> => {
  try {
    const routeReq = buildRouteRequest(req, injectBodyPatch);
    if (!validateNameField(routeReq.body, res)) return;

    const response = await routeDef.handler(routeReq, ctx);

    // SSE streaming response (execution live view).
    if (response.stream) {
      res.writeHead(response.status, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
        ...response.headers,
      });
      let closed = false;
      const onClose = () => {
        closed = true;
      };
      req.on('close', onClose);
      try {
        for await (const chunk of response.stream) {
          if (closed) break;
          res.write(chunk);
        }
      } finally {
        req.off('close', onClose);
        res.end();
      }
      return;
    }

    if (response.headers) {
      for (const [k, v] of Object.entries(response.headers)) {
        res.setHeader(k, v);
      }
    }

    // Defense-in-depth: /attachments streams raw user-uploaded bytes. Force a
    // download and disable MIME sniffing so an uploaded HTML/SVG can never
    // execute script in the app origin. Skipped for redirect (signed-URL)
    // responses.
    if (routeDef.path === '/attachments' && !(response.status >= 300 && response.status < 400)) {
      const dlName = typeof req.query.name === 'string' ? req.query.name : 'download';
      res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(dlName)}"`);
      res.setHeader('X-Content-Type-Options', 'nosniff');
    }

    // Redirect (e.g. attachment download via a signed URL).
    const location = response.headers?.['Location'];
    if (response.status >= 300 && response.status < 400 && location) {
      res.redirect(response.status, location);
      return;
    }

    // Binary body (e.g. attachment download streamed from storage).
    if (response.body instanceof Uint8Array) {
      res.status(response.status).end(Buffer.from(response.body));
      return;
    }

    res.status(response.status).json(response.body);
  } catch (err) {
    if (!res.headersSent) {
      if (err instanceof AccessDeniedError) {
        res.status(403).json({ error: 'Forbidden' });
        return;
      }
      if (err instanceof ResourceNotFoundError) {
        res.status(404).json({ error: 'Not found' });
        return;
      }
    }
    logger.error(
      `[WORKFLOW-SDK] ${routeDef.method} ${routeDef.path} failed: ${err instanceof Error ? err.message : String(err)}`,
    );
    if (!res.headersSent) {
      res.status(500).json({
        error: err instanceof Error ? err.message : 'Internal server error',
      });
    }
  }
};

// ── Authenticated router (mounted behind authMiddleware.authenticate) ────────

export const workflowSdkRouter = express.Router();

// Tenant check for AUTH_REQUIRED_OVERRIDE routes, whose SDK handlers bypass the
// authorizer. Mounted ahead of multer so a request for someone else's workflow
// is refused before its upload is buffered. "Not found", "not an SDK workflow"
// and "other workspace" all return the same 404 — distinguishing them would
// make the route an oracle for probing workflow ids (as xyne-search's guard
// also avoids).
const requireWorkflowOwned: express.RequestHandler = (req, res, next) => {
  void (async () => {
    const user = req.user;
    if (!user?.workspaceId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }
    const workflowId = req.params['workflowId'];
    if (!workflowId) {
      res.status(400).json({ error: 'Missing workflow ID' });
      return;
    }
    const wf = await db.workflow.findFirst({
      where: { id: workflowId, workflowType: SDK_WORKFLOW_TYPE },
      select: { workspaceId: true },
    });
    if (!wf || wf.workspaceId !== user.workspaceId) {
      res.status(404).json({ error: 'Workflow not found' });
      return;
    }
    next();
  })().catch((err: unknown) => {
    logger.error(
      `[WORKFLOW-SDK] workflow ownership check failed: ${err instanceof Error ? err.message : String(err)}`,
    );
    if (!res.headersSent) res.status(500).json({ error: 'Internal server error' });
  });
};

for (const routeDef of authenticatedRouteDefs) {
  const handler: express.RequestHandler = async (req, res) => {
    const user = req.user;
    if (!user) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }
    if (!user.workspaceId) {
      res.status(400).json({ error: 'No workspace context' });
      return;
    }
    const ctx: XyneCtx = {
      userId: user.id,
      workspaceId: user.workspaceId,
      isAdmin: isWorkflowStudioAdmin(res),
    };

    if (!ctx.isAdmin && ADMIN_REQUIRED.has(routeKey(routeDef))) {
      res.status(403).json({ error: 'Forbidden' });
      return;
    }

    // Put trusted host attributes in the request body before dispatching to
    // the SDK. Any browser-supplied `attributes` value is overwritten here.
    const isWorkflowOrFolderCreate =
      routeDef.method === 'POST' && (routeDef.path === '/workflows' || routeDef.path === '/folders');
    const isCredentialManagement =
      (routeDef.method === 'POST' && routeDef.path === '/credentials') ||
      (routeDef.method === 'PUT' && routeDef.path === '/credentials/:name') ||
      (routeDef.method === 'POST' && routeDef.path === '/credentials/:name/revoke');
    const isCredentialCreate = routeDef.method === 'POST' && routeDef.path === '/credentials';
    const isCredentialTest =
      routeDef.method === 'POST' && routeDef.path === '/credentials/:name/test';

    const injectAttributes = isWorkflowOrFolderCreate
      ? (body: Record<string, unknown>): void => {
          body['attributes'] = {
            workspaceId: ctx.workspaceId,
            createdByUserId: ctx.userId,
          };
        }
      : isCredentialManagement
        ? (body: Record<string, unknown>): void => {
            body['attributes'] = {
              workspaceId: ctx.workspaceId,
              ...(isCredentialCreate ? { createdByUserId: ctx.userId } : {}),
            };
          }
        : isCredentialTest
          ? (body: Record<string, unknown>): void => {
              body['attributes'] = { workspaceId: ctx.workspaceId };
            }
          : undefined;

    await dispatch(routeDef, req, res, ctx, injectAttributes);
  };

  // Ownership check first, then the body parser: a request for someone else's
  // workflow is rejected before its upload is read.
  const middlewares = [
    ...(AUTH_REQUIRED_OVERRIDE.has(routeKey(routeDef)) ? [requireWorkflowOwned] : []),
    ...multerMiddlewares(routeDef.multipart),
  ];
  mount(workflowSdkRouter, routeDef, middlewares, handler);
}

// ── Public router (secret-in-path auth; mounted BEFORE authMiddleware) ────────
// Membership is decided by PUBLIC_ROUTE_ALLOWLIST at the top of this file.

export const workflowSdkPublicRouter = express.Router();

const publicRateLimit = rateLimit({
  windowMs: 60 * 1000,
  max: 120,
  standardHeaders: true,
  legacyHeaders: false,
});

for (const routeDef of publicRouteDefs) {
  const handler: express.RequestHandler = async (req, res) => {
    await dispatch(routeDef, req, res, null);
  };
  const middlewares = [publicRateLimit, ...multerMiddlewares(routeDef.multipart)];
  mount(workflowSdkPublicRouter, routeDef, middlewares, handler);
}

// Rendered from the same lists the mount loops use, so it can't drift from
// what is actually reachable. Withheld routes are mounted on neither router.
logger.info('[WORKFLOW-SDK] Router built', {
  authenticated: authenticatedRouteDefs.length,
  adminRequired: [...ADMIN_REQUIRED],
  public: publicRouteDefs.map(routeKey),
  authRequiredOverride: [...AUTH_REQUIRED_OVERRIDE],
  withheld: withheldRouteDefs.map(routeKey),
});
