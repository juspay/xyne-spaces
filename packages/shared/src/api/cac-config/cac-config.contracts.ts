import { z } from 'zod';
import { defineRoute } from '../../enc-contracts/api-route.js';

// ─── CAC config, sub-ticket links and conversation labels: dashboard login. ─────────────
// Ids, keys, counts and flags. Nothing encrypted.

// ── CAC config (/cac-config/:key) ───────────────────────────────────────────

/** One config value by key, resolved for the caller (their email, workspace, and the playground header). */
export const cacConfigGet = defineRoute({
  method: 'GET',
  path: '/:key',
  params: z.object({ key: z.string().min(1, 'Config key is required') }),
  response: z.object({ key: z.string(), config: z.unknown() }),
});