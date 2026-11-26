import { z } from 'zod';
import { defineRoute } from '../../../enc-contracts/api-route.js';
import { CommandType } from '../../../zero/types.js';
import { appCommand } from '../dashboard.schemas.js';

// ── Commands and shortcuts ──────────────────────────────────────────────────

/** Commands or shortcuts available in a channel. An unknown `commandAccessibility` is ignored, as before. */
export const appsChannelCommands = defineRoute({
  method: 'GET',
  path: '/:channelId/commands',
  params: z.object({ channelId: z.string().min(1).trim() }),
  query: z.object({ commandType: z.nativeEnum(CommandType), commandAccessibility: z.string().optional() }),
  response: z.array(appCommand.extend({ appName: z.string().optional() })),
});