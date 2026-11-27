import { route } from '../../enc-contracts/api-route.js';
import { z } from 'zod';

// ─── CAC config, sub-ticket links and conversation labels: dashboard login. ─────────────
// Ids, keys, counts and flags. Nothing encrypted.

// ── CAC config (/cac-config/:key) ───────────────────────────────────────────

/** `/cac-config`: a config value for the caller. Key order is the mount order. */
export const cacConfig = route('/cac-config', {
  /** One config value by key, resolved for the caller (their email, workspace, and the playground header). */
  get: {
    method: 'GET',
    path: '/:key',
    params: z.object({ key: z.string().min(1, 'Config key is required') }),
    response: z.object({ key: z.string(), config: z.unknown() }),
  },
});
