import { z } from 'zod';
import { defineRoute } from '../api-route.js';
import { defineRequestContract } from '../define.js';
import { derive } from '../extractors.js';

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

// ─── chat.postMessage / chat.postEphemeral / chat.update ──────────────────────
// Slack SDKs send JSON or form-encoded bodies: booleans and arrays may arrive as strings.

function parseJsonString(value: unknown): unknown {
  if (typeof value !== 'string') return value;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

const slackBoolean = z.preprocess((value) => {
  if (value === 'true') return true;
  if (value === 'false') return false;
  return value;
}, z.boolean().optional());
const slackArray = z.preprocess(parseJsonString, z.array(z.any()).optional());
const slackRecord = z.preprocess(parseJsonString, z.record(z.string(), z.unknown()).optional());
const slackOptionalString = z
  .string()
  .nullable()
  .optional()
  .transform((value) => value ?? undefined);

const hasContent = (data: { text?: string; blocks?: unknown[]; attachments?: unknown[] }): boolean =>
  !!data.text || (!!data.blocks && data.blocks.length > 0) || (!!data.attachments && data.attachments.length > 0);
const contentRequired = { message: 'Either text, blocks, or attachments is required', path: ['text'] };

/**
 * The facts asked of Slack-format `text`: every Slack id it mentions (also inside a serialised
 * Slack message JSON), looked up by the backend so the encryption service can build the content
 * (compose slackChatContent), and its length for the `msg_too_long` check.
 */
const slackChatTextFacts = {
  slackMentionUserIds: derive.slackMentionUserIds,
  slackMentionGroupIds: derive.slackMentionGroupIds,
  slackMentionChannels: derive.slackMentionChannels,
  rawLength: derive.rawLength,
} as const;

// `channel` is optional in the bodies: a missing one gets channel_not_found from the channel check.
const postFields = {
  channel: z.string().optional(),
  text: z.string().optional(),
  blocks: slackArray,
  attachments: slackArray,
  thread_ts: slackOptionalString,
  mrkdwn: slackBoolean.default(true),
  metadata: slackRecord,
  username: slackOptionalString,
};

export const appsSlackChatPostMessageBodySchema = z.object(postFields).refine(hasContent, contentRequired);
export const appsSlackChatPostEphemeralBodySchema = z
  .object({ ...postFields, user: z.string().min(1, 'user is required') })
  .refine(hasContent, contentRequired);
export const appsSlackChatUpdateBodySchema = z
  .object({
    channel: z.string().optional(),
    ts: z.string().min(1, 'ts is required'),
    text: z.string().optional(),
    blocks: slackArray,
    attachments: slackArray,
  })
  .refine(hasContent, contentRequired);

/**
 * The encryption contracts: `text` is encrypted by the ingress transit proxy (MASTER_DEK). The
 * field names are the manifest rule's (the encryption service checks they agree).
 */
export const appsSlackChatPostMessageClient = defineRequestContract({
  sourceToDerived: { text: slackChatTextFacts },
  schema: z.object({
    channel: z.string().optional(),
    text: z.string().optional(),
    blocks: z.unknown().optional(),
    attachments: z.unknown().optional(),
    thread_ts: z.unknown().optional(),
    mrkdwn: z.unknown().optional(),
    metadata: z.unknown().optional(),
    username: z.unknown().optional(),
  }),
});
export const appsSlackChatPostEphemeralClient = defineRequestContract({
  sourceToDerived: { text: slackChatTextFacts },
  schema: z.object({
    channel: z.string().optional(),
    user: z.string().optional(),
    text: z.string().optional(),
    blocks: z.unknown().optional(),
    attachments: z.unknown().optional(),
    thread_ts: z.unknown().optional(),
    mrkdwn: z.unknown().optional(),
    metadata: z.unknown().optional(),
    username: z.unknown().optional(),
  }),
});
export const appsSlackChatUpdateClient = defineRequestContract({
  sourceToDerived: { text: slackChatTextFacts },
  schema: z.object({
    channel: z.string().optional(),
    ts: z.string().optional(),
    text: z.string().optional(),
    blocks: z.unknown().optional(),
    attachments: z.unknown().optional(),
  }),
});

/** Slack's success answers carry more than `ok` (channel, ts, message…): only `ok` is pinned. */
const slackOk = z.object({ ok: z.literal(true) });

export const appsSlackChatPostMessage = defineRoute({
  method: 'POST',
  path: '/apps/slack/chat.postMessage',
  body: appsSlackChatPostMessageBodySchema,
  response: slackOk,
  encryption: appsSlackChatPostMessageClient,
});
export const appsSlackChatPostEphemeral = defineRoute({
  method: 'POST',
  path: '/apps/slack/chat.postEphemeral',
  body: appsSlackChatPostEphemeralBodySchema,
  response: slackOk,
  encryption: appsSlackChatPostEphemeralClient,
});
export const appsSlackChatUpdate = defineRoute({
  method: 'POST',
  path: '/apps/slack/chat.update',
  body: appsSlackChatUpdateBodySchema,
  response: slackOk,
  encryption: appsSlackChatUpdateClient,
});
