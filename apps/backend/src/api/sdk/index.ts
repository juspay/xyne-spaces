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

import { Router, type NextFunction, type Request, type Response } from 'express';
import { z, ZodError } from 'zod';
import { API_VERSION } from '@xyne/spaces-contract';
import { requestId } from './middleware/requestId';
import { rateLimit } from './middleware/rateLimit';
import { v1ErrorHandler, v1NotFound } from './middleware/errorHandler';
import { apiKeyAuth } from './auth';
import { callQuery, readsAvailable } from './query';
import { callMutator } from './mutation';
import { createDirectRouter } from './direct';
import { ApiError } from './errors';

/**
 * Body of a catalog call. What a caller may actually reach is decided by Zero's
 * per-table ACL, which is folded into every query AST and wrapped transaction —
 * an API key acts as its user and gets exactly that user's reach.
 */
const catalogRequest = z.object({
  name: z.string().min(1),
  args: z.unknown().optional(),
});

function catalogHandler(kind: 'query' | 'mutator') {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const auth = req.sdkAuth;
      if (!auth) throw new ApiError('unauthenticated', 'Missing authenticated principal.');

      const { name, args } = catalogRequest.parse(req.body);

      if (kind === 'query') {
        res.status(200).json({ data: await callQuery(name, args, auth.ctx) });
        return;
      }

      await callMutator(name, args, auth.authData);
      res.status(200).json({ success: true });
    } catch (err) {
      next(err instanceof ZodError ? ApiError.validation(err) : err);
    }
  };
}

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

  router.post('/catalog/query', rateLimit('read'), catalogHandler('query'));
  router.post('/catalog/mutate', rateLimit('write'), catalogHandler('mutator'));
  router.use(createDirectRouter());

  router.use(v1NotFound);
  router.use(v1ErrorHandler);

  return router;
}
