/**
 * The Xyne Spaces public API (v1).
 *
 * Resource server for SDK clients: it verifies RS256 access tokens minted by
 * xyne-claw-auth, then serves the operation catalog directly out of Postgres.
 * No Zero sync process, cache, or replica is involved — `@rocicorp/zero` is used
 * here purely as a query compiler and typed operation registry.
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
import { platformRoutes } from './domains/platform';
import { searchRoutes } from './domains/search';
import { userRoutes } from './domains/users';
import type { RouteDefinition } from './manifest/types';
import { v1Config } from './config';

/** Every domain's manifest, in one place for the router and the tooling. */
export const allRoutes: readonly RouteDefinition[] = [
  ...platformRoutes,
  ...searchRoutes,
  ...userRoutes,
  // Next: channels/conversations/messages, then work management, then the rest.
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
    res.status(reads ? 200 : 503).json({
      status: reads ? 'ok' : 'degraded',
      reads: reads
        ? { available: true }
        : {
            available: false,
            reason:
              'No read replica configured (DATABASE_READ_REPLICA_POOL_URL) and SDK_QUERIES_ALLOW_PRIMARY is off.',
          },
      auth: v1Config.jwksUrl ? { configured: true } : { configured: false, reason: 'SDK_JWKS_URL is unset.' },
    });
  });

  router.use(authn);
  router.use(registerRoutes(allRoutes));

  router.use(v1NotFound);
  router.use(v1ErrorHandler);

  return router;
}
