/**
 * The Xyne Spaces public SDK API.
 *
 * A thin authenticated surface over machinery that already exists. It owns
 * exactly five concerns:
 *
 *   auth.ts      authenticate an API key into an `AuthData`
 *   query.ts     run one catalog query
 *   mutation.ts  run one catalog mutator
 *   direct.ts    call the product controllers behind the catalog gaps
 *   handler.ts   request id, rate limit, and one error envelope
 *
 * Everything else — ACL, Vespa indexing, side effects, sequence allocation — is
 * reached through code the app itself uses, never reimplemented here.
 */

import { Router, type Request, type Response } from 'express';
import { API_VERSION } from '@xyne/spaces-contract';
import { requestId } from './middleware/requestId';
import { apiKeyAuth } from './auth';
import { v1ErrorHandler, v1NotFound } from './middleware/errorHandler';
import { registerRoutes } from './manifest/register';
import { readsAvailable } from './engine/queries';
import { searchRoutes } from './domains/search';
import { catalogGapRoutes } from './domains/catalog-gaps';
import type { RouteDefinition } from './manifest/types';
import { catalogRouter } from './domains/catalog';

/** Direct API routes: operations that are not Zero catalog queries or mutators. */
export const allRoutes: readonly RouteDefinition[] = [
  ...catalogGapRoutes,
  ...searchRoutes,
];

export function createSdkRouter(): Router {
  const router = Router();

  router.use(requestId);

  // Unauthenticated service endpoints. Deliberately before `apiKeyAuth` so a
  // probe can tell "the API is misconfigured" from "your key is bad".
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
    });
  });

  router.use(apiKeyAuth);
  router.use('/catalog', catalogRouter);
  router.use(registerRoutes(allRoutes));

  router.use(v1NotFound);
  router.use(v1ErrorHandler);

  return router;
}
