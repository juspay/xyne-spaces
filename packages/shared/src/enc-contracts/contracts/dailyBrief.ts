import { z } from 'zod';
import { defineRoute } from '../api-route.js';

// ─── Daily brief settings (/daily-brief/config and /settings): dashboard login. ───────────
// The enable flag, the user's own brief instructions (plain text today, as before), and which
// agent runs the brief. The briefs themselves (latest, history, by-date) are not here.
// The answers are claw-auth's, passed through unwrapped.

export const dailyBriefConfig = defineRoute({
  method: 'GET',
  path: '/daily-brief/config',
  response: z.unknown(),
});

export const dailyBriefConfigSet = defineRoute({
  method: 'PUT',
  path: '/daily-brief/config',
  body: z.object({
    enabled: z.boolean().optional(),
    instructions: z.string().nullable().optional(),
    instructionsEnabled: z.boolean().optional(),
  }),
  response: z.unknown(),
});

export const dailyBriefSettings = defineRoute({
  method: 'GET',
  path: '/daily-brief/settings',
  response: z.unknown(),
});

/** Sets the org's brief agent. Admin only: claw-auth answers 403 or 400 and the status is passed through. */
export const dailyBriefSettingsSet = defineRoute({
  method: 'PUT',
  path: '/daily-brief/settings',
  body: z.object({ agentSlug: z.string().optional() }),
  response: z.unknown(),
});
