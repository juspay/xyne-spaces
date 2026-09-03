/**
 * The Xyne Spaces public SDK API.
 *
 * A thin authenticated surface over machinery that already exists. It owns
 * exactly five concerns:
 *
 *   auth.ts      the API-key format and how one is minted
 *   v1/          the versioned surface: operation map, argument parsers, routes
 *   query.ts     run one catalog query
 *   mutation.ts  run one catalog mutator
 *   direct.ts    call the product controllers behind the catalog gaps
 *   handler.ts   request id and one error envelope
 *
 * Authenticating a *request* against a key is `middleware/sdkApiKeyAuth.ts`,
 * passed in explicitly where this router is mounted — see `app.ts` — rather
 * than applied invisibly inside it.
 *
 * Everything else — ACL, Vespa indexing, side effects, sequence allocation — is
 * reached through code the app itself uses, never reimplemented here.
 */

import { Router, type Request, type Response } from 'express';
import { errorHandler, notFound, requestId } from './handler';
import { readsAvailable } from './query';
import { createSdkV1Router } from './v1';

/**
 * Unauthenticated service endpoints, mounted before the authenticated router
 * so a probe can tell "the API is misconfigured" from "your key is bad".
 *
 * `requestId` lives here rather than in both routers: it is `router.use()`
 * with no path, so it runs for every request to `/api/sdk/*` regardless of
 * which of the two routers ultimately serves it — mounting order in `app.ts`
 * guarantees this one sees the request first.
 */
export function createSdkPublicRouter(): Router {
  const router = Router();

  router.use(requestId);

  router.get('/version', (_req: Request, res: Response) => {
    res.json({ version: 'v1', service: 'xyne-spaces-api' });
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
              'No read replica configured (DATABASE_READ_REPLICA_POOL_URL) and this is a production deployment, ' +
              'which does not fall back to the primary pool.',
          },
    });
  });

  return router;
}

/**
 * The authenticated part of the API. `app.ts` mounts this behind
 * `apiKeyAuth`, passed explicitly rather than applied inside — see that file.
 */
export function createSdkRouter(): Router {
  const router = Router();

  router.use('/v1', createSdkV1Router());


  router.use(notFound);
  router.use(errorHandler);

  return router;
}
