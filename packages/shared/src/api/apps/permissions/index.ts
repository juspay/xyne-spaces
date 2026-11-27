import { route } from '../../../enc-contracts/api-route.js';
import { z } from 'zod';

const dateish = z.union([z.date(), z.string()]);
const permissionStatus = z.object({ scope: z.string(), status: z.string() });
const ok = z.object({ ok: z.literal(true) });
const appId = z.object({ appId: z.string().min(1, 'App ID is required').trim() });

// ── Permissions (the app template's) ────────────────────────────────────────

/** `/apps/permissions`: the permission registry and an app's permissions (dashboard). Key order is the mount order. */
export const permissions = route('/permissions', {
  list: {
    method: 'GET',
    path: '',
    response: z.object({ permissions: z.array(z.object({ id: z.string(), name: z.string(), description: z.string().nullable(), type: z.string(), createdAt: dateish })) }),
  },
  get: {
    method: 'GET',
    path: '/:appId',
    params: z.object({ appId: z.string() }),
    response: z.object({ permissions: z.array(z.string()), permissionsPending: z.literal(false), statuses: z.array(permissionStatus) }),
  },
  set: {
    method: 'POST',
    path: '/:appId',
    params: z.object({ appId: z.string() }),
    body: z.object({ permissions: z.array(z.string()) }),
    response: ok,
  },
});
