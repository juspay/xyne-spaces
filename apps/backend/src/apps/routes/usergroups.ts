import { Router } from 'express';
import { API } from '@xyne/shared';
import { api } from '@/framework/api';
import { appPermission } from '../access';
import { listUserGroups } from '../handlers/users';

// Typed routes (API.apps.usergroups), served by the API router behind the contract gate.
api.routes(API.apps.usergroups, (serve) => ({
  list: serve('list', {
    auth: 'app',
    access: { permission: appPermission('usergroups:read') },
    handle: () => listUserGroups(),
  }),
}));

// Nothing untyped left under /api/apps/usergroups.
const router = Router();
export default router;
