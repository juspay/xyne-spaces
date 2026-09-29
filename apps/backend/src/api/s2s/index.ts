// /api/s2s: what every version shares (request id, key auth, errors). Versions are folders.
import { Router } from 'express';
import { requestId } from '@/api/sdk/handler';
import { s2sErrorHandler, s2sNotFound } from './errors';
import { s2sKeyAuth } from './middleware';
import { createV1Router } from './v1';

export function createS2sRouter(): Router {
  const router = Router();
  router.use(requestId);
  router.use(s2sKeyAuth);
  router.use('/v1', createV1Router());
  router.use(s2sNotFound);
  router.use(s2sErrorHandler);
  return router;
}
