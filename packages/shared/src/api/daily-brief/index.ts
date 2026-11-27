import { route } from '../../enc-contracts/api-route.js';
import { z } from 'zod';

// ─── Daily brief settings (/daily-brief/config and /settings): dashboard login. ───────────
// The enable flag, the user's own brief instructions (plain text today, as before), and which
// agent runs the brief. The briefs themselves (latest, history, by-date) are not here.
// The answers are claw-auth's, passed through unwrapped: their shape is claw-auth's to define,
// so the responses stay open (z.unknown()) on purpose, not for lack of a type here.

/** `/daily-brief`: daily brief config and settings. Key order is the mount order. */
export const dailyBrief = route('/daily-brief', {
  config: {
    method: 'GET',
    path: '/config',
    response: z.unknown(),
  },
  configSet: {
    method: 'PUT',
    path: '/config',
    body: z.object({
      enabled: z.boolean().optional(),
      instructions: z.string().nullable().optional(),
      instructionsEnabled: z.boolean().optional(),
    }),
    response: z.unknown(),
  },
  settings: {
    method: 'GET',
    path: '/settings',
    response: z.unknown(),
  },
  /** Sets the org's brief agent. Admin only: claw-auth answers 403 or 400 and the status is passed through. */
  settingsSet: {
    method: 'PUT',
    path: '/settings',
    body: z.object({ agentSlug: z.string().nullable().optional() }),
    response: z.unknown(),
  },
});
