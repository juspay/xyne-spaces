import { defineRoute, route, type RouteContract } from '../../../enc-contracts/api-route.js';
import { z } from 'zod';
import { derive } from '../../../enc-contracts/extractors.js';
import { hasText, unreadableString, type UnreadableString } from '../../../enc-contracts/unreadable-string.js';

// ─── Slack-compatible Xyne Apps API (/apps/slack/...) ─────────────────────────
// Same actions as the native /apps/chat API, in Slack's wire format, for bots written agains
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

const hasContent = (data: { text?: UnreadableString; blocks?: unknown[]; attachments?: unknown[] }): boolean =>
  hasText(data.text) || (!!data.blocks && data.blocks.length > 0) || (!!data.attachments && data.attachments.length > 0);
const contentRequired = { message: 'Either text, blocks, or attachments is required', path: ['text'] };

/**
 * The facts asked of Slack-format `text`: every Slack id it mentions (also inside a serialised
 * Slack message JSON), looked up by the backend so the encryption service can build the conten
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
  /** Encrypted by the ingress transit proxy (MASTER_DEK). */
  text: unreadableString().optional(),
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
    text: unreadableString().optional(),
    blocks: slackArray,
    attachments: slackArray,
  })
  .refine(hasContent, contentRequired);

/** Slack's success answers carry more than `ok` (channel, ts, message…): only `ok` is pinned. */
const slackOk = z.object({ ok: z.literal(true) });

// ─── Slack-compatible reads (auth, conversations, users, usergroups) ──────────
// Each method answers GET (arguments in the query) and POST (arguments in the body), as Slack
// does: one contract per method and verb, the same rules. Ids, names and profile data only.

const slackListLimit = z
  .union([z.number(), z.string()])
  .optional()
  .transform((val) => (val ? Number(val) : 100));

const conversationsInfoArgs = z.object({ channel: z.string().min(1, 'channel is required') });
const conversationsListArgs = z.object({ types: z.string().optional(), limit: slackListLimit, cursor: z.string().optional() });
const usersInfoArgs = z.object({ user: z.string().min(1, 'user is required') });
const usersLookupByEmailArgs = z.object({ email: z.string().email('email is required') });
const usersConversationsArgs = z.object({
  user: z.string().optional(),
  types: z.string().optional(),
  limit: slackListLimit,
  cursor: z.string().optional(),
  exclude_archived: slackBoolean.default(false),
  team_id: z.string().optional(),
});
const usergroupsListArgs = z.object({
  include_users: slackBoolean.default(false),
  include_disabled: slackBoolean.default(false),
  include_count: slackBoolean.default(true),
  team_id: z.string().optional(),
});

/**
 * A Slack read method as its GET (query) and POST (body) contracts. Read args are plain (never
 * `unreadableString()`), so the POST needs no `facts`. While `A` is generic the compiler canno
 * see that, so the body is passed widened and the contract is typed with `A`; the API table's
 * test (routeSpecProblems) still checks every contract's encrypted fields at run time.
 */
function slackRead<A extends z.ZodType, P extends string>(path: P, args: A) {
  return {
    get: defineRoute({ method: 'GET', path, query: args, response: slackOk }),
    post: defineRoute({ method: 'POST', path, body: args as z.ZodType, response: slackOk }) as unknown as RouteContract<
      'POST',
      P,
      undefined,
      undefined,
      A,
      typeof slackOk,
      undefined
    >,
  };
}

const authTest = slackRead('/auth.test', z.object({}));
const conversationsInfo = slackRead('/conversations.info', conversationsInfoArgs);
const conversationsList = slackRead('/conversations.list', conversationsListArgs);
const usersInfo = slackRead('/users.info', usersInfoArgs);
const usersLookupByEmail = slackRead('/users.lookupByEmail', usersLookupByEmailArgs);
const usersConversations = slackRead('/users.conversations', usersConversationsArgs);
const usergroupsList = slackRead('/usergroups.list', usergroupsListArgs);

/** `/apps/slack`: the Slack-compatible API for bots. Key order is the mount order. */
export const slack = route('/slack', {
  chatDelete: {
    method: 'POST',
    path: '/chat.delete',
    body: appsSlackChatDeleteBodySchema,
    response: appsSlackChatDeleteResponseSchema,
  },
  chatPostMessage: {
    method: 'POST',
    path: '/chat.postMessage',
    body: appsSlackChatPostMessageBodySchema,
    sourceToDerived: { text: slackChatTextFacts },
    response: slackOk,
  },
  chatPostEphemeral: {
    method: 'POST',
    path: '/chat.postEphemeral',
    body: appsSlackChatPostEphemeralBodySchema,
    sourceToDerived: { text: slackChatTextFacts },
    response: slackOk,
  },
  chatUpdate: {
    method: 'POST',
    path: '/chat.update',
    body: appsSlackChatUpdateBodySchema,
    sourceToDerived: { text: slackChatTextFacts },
    response: slackOk,
  },
  authTestGet: authTest.get,
  authTestPost: authTest.post,
  conversationsInfoGet: conversationsInfo.get,
  conversationsInfoPost: conversationsInfo.post,
  conversationsListGet: conversationsList.get,
  conversationsListPost: conversationsList.post,
  /** conversations.open: POST only. `users` (comma-separated) or `channel`. */
  conversationsOpen: {
    method: 'POST',
    path: '/conversations.open',
    body: z
      .object({ users: z.string().optional(), channel: z.string().optional(), return_im: slackBoolean })
      .refine((data) => !!data.users || !!data.channel, { message: 'users or channel is required', path: ['users'] }),
    response: slackOk,
  },
  usersInfoGet: usersInfo.get,
  usersInfoPost: usersInfo.post,
  usersLookupByEmailGet: usersLookupByEmail.get,
  usersLookupByEmailPost: usersLookupByEmail.post,
  usersConversationsGet: usersConversations.get,
  usersConversationsPost: usersConversations.post,
  usergroupsListGet: usergroupsList.get,
  usergroupsListPost: usergroupsList.post,
});
