/**
 * Retired API versions: every request to them answers 503 `unavailable`.
 *
 * v1 (@xyne/spaces-sdk 0.1.x) and v2 (0.2.x) predate transit encryption: they cannot decrypt
 * responses or encrypt the fields a manifest rule names, so they are switched off rather
 * than left half-working. The router is mounted in `app.ts` ahead of authentication and
 * whether or not the SDK API is enabled, so an old client gets this answer with any session
 * or none, and the body is plain JSON (no session, so the response encryptor leaves it
 * alone).
 */

import { Router, type NextFunction, type Request, type Response } from 'express';
import { SdkApiError } from './errors';
import { errorHandler, requestId } from './handler';

export const RETIRED_SDK_VERSIONS = ['v1', 'v2'] as const;

export function createSdkRetiredRouter(version: (typeof RETIRED_SDK_VERSIONS)[number]): Router {
  const router = Router();
  router.use(requestId);
  router.use((_req: Request, _res: Response, next: NextFunction) => {
    next(
      new SdkApiError(
        'unavailable',
        `API ${version} is no longer available. Upgrade @xyne/spaces-sdk to 0.3.0 or later (API v3).`,
        { reason: 'api_version_retired' },
      ),
    );
  });
  router.use(errorHandler);
  return router;
}
