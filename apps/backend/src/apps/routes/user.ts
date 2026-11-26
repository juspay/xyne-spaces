import { Router } from 'express';
import { API } from '@xyne/shared';
import { api } from '@/framework/api';
import { appPermission } from '../access';
import { userInfo } from '../handlers/users';

// Typed routes (API.apps.user), served by the API router behind the contract gate.
api.routes(API.apps.user, (serve) => ({
  info: serve('info', {
    auth: 'app',
    access: { permission: appPermission('users:read') },
    handle: ({ query }) => userInfo({ query }),
  }),
}));

// Nothing untyped left under /api/apps/user.
const router = Router();
export default router;
