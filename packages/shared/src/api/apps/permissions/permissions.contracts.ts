import { z } from 'zod';
import { defineRoute } from '../../../enc-contracts/api-route.js';
import { appId, dateish, ok, permissionStatus } from '../dashboard.schemas.js';

// ── Permissions (the app template's) ────────────────────────────────────────

export const appsPermissions = defineRoute({
  method: 'GET',
  path: '',
  response: z.object({ permissions: z.array(z.object({ id: z.string(), name: z.string(), description: z.string().nullable(), type: z.string(), createdAt: dateish })) }),
});

export const appsPermissionsGet = defineRoute({
  method: 'GET',
  path: '/:appId',
  params: z.object({ appId: z.string() }),
  response: z.object({ permissions: z.array(z.string()), permissionsPending: z.literal(false), statuses: z.array(permissionStatus) }),
});

export const appsPermissionsSet = defineRoute({
  method: 'POST',
  path: '/:appId',
  params: z.object({ appId: z.string() }),
  body: z.object({ permissions: z.array(z.string()) }),
  response: ok,
});