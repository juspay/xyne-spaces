import { z } from 'zod';
import { defineRoute } from '../api-route.js';

// ─── Slack-compatible Xyne Apps API (/apps/slack/...) ─────────────────────────
// Same actions as the native /apps/chat API, in Slack's wire format, for bots written against
// a Slack SDK: Slack argument names (`channel`, `ts`), and every answer is HTTP 200 with
// `ok: true | false` (an error is `{ ok: false, error: '<slack_code>' }`).

/**
 * chat.delete's arguments. `channel` is a channel id, `#name`, or a user id (the bot's DM);
 * it is optional here so that a missing one gets Slack's `channel_not_found` from the channel
 * check, as before, rather than `invalid_arguments`. `ts` is the message id.
 */
export const appsSlackChatDeleteBodySchema = z.object({
  channel: z.string().optional(),
  ts: z.string().min(1, 'ts is required'),
});

/** chat.delete's success answer. */
export const appsSlackChatDeleteResponseSchema = z.object({
  ok: z.literal(true),
  channel: z.string(),
  ts: z.string(),
});

export const appsSlackChatDelete = defineRoute({
  method: 'POST',
  path: '/apps/slack/chat.delete',
  body: appsSlackChatDeleteBodySchema,
  response: appsSlackChatDeleteResponseSchema,
});
