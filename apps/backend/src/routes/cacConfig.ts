import { Router } from 'express';
import { API } from '@xyne/shared';
import { api } from '@/framework/api';
import { cacConfig } from '@/handlers/workspace';

// Typed route (API.cacConfig.get), served by the API router behind the contract gate.
api.routes(API.cacConfig, (serve) => ({
  get: serve('get', { handle: ({ params, user, headers }) => cacConfig({ params, user, headers }) }),
}));

// Nothing untyped left under /api/cac-config.
const router = Router();
export default router;
