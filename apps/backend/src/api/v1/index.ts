/**
 * The Xyne Spaces public API (v1).
 *
 * Both authorization server and resource server for SDK clients: OAuth endpoints
 * mint RS256 access tokens which the same process verifies on resource requests.
 * No external auth service dependency.
 *
 * Route definitions live in `domains/*` as manifest data; this file assembles
 * them into a router and owns the middleware chain shared by every endpoint.
 */

import { Router, type Request, type Response } from 'express';
import { API_VERSION } from '@xyne/spaces-contract';
import { requestId } from './middleware/requestId';
import { authn } from './middleware/authn';
import { v1ErrorHandler, v1NotFound } from './middleware/errorHandler';
import { registerRoutes } from './manifest/register';
import { readsAvailable } from './engine/queries';
import { searchRoutes } from './domains/search';
import type { RouteDefinition } from './manifest/types';
import { oauthRouter } from './oauth';
import { oauthConfig } from './oauth/config';

/**
 * Routes that require custom API handlers (not available via Zero fallback).
 *
 * Most SDK operations use /zero/query-fallback and /zero/push-fallback to
 * reuse existing Zero queries/mutators. Only operations that need custom
 * logic (like search which delegates to Vespa) are defined here.
 */
export const allRoutes: readonly RouteDefinition[] = [
  ...searchRoutes,
];

export function createV1Router(): Router {
  const router = Router();

  router.use(requestId);

  // Unauthenticated service endpoints. Deliberately before `authn` so a probe
  // can tell "the API is misconfigured" from "your token is bad".
  router.get('/version', (_req: Request, res: Response) => {
    res.json({ version: API_VERSION, service: 'xyne-spaces-api' });
  });

  router.get('/health', (_req: Request, res: Response) => {
    const reads = readsAvailable();
    const authConfigured = oauthConfig.isConfigured;
    res.status(reads ? 200 : 503).json({
      status: reads ? 'ok' : 'degraded',
      reads: reads
        ? { available: true }
        : {
            available: false,
            reason:
              'No read replica configured (DATABASE_READ_REPLICA_POOL_URL) and SDK_QUERIES_ALLOW_PRIMARY is off.',
          },
      auth: authConfigured
        ? { configured: true }
        : { configured: false, reason: 'SDK_JWT_PRIVATE_KEY or SDK_JWT_KEY_ID is unset.' },
    });
  });

  // OAuth endpoints (authorization server). Mounted before authn because they
  // use Spaces session authentication, not SDK access tokens.
  if (oauthConfig.enabled) {
    router.use('/oauth', oauthRouter);
  }

  router.use(authn);
  router.use(registerRoutes(allRoutes));

  router.use(v1NotFound);
  router.use(v1ErrorHandler);

  return router;
}
