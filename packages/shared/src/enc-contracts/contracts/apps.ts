import { z } from 'zod';
import { hasText, unreadableString } from '../unreadable-string.js';
import { defineRoute } from '../api-route.js';
import { MESSAGE_DELIVERY } from '../../validation/flowSchema.js';
import { conversationsSendClient } from './conversations.js';
import { derive } from '../extractors.js';

/**
 * The facts asked of a bot's Slack-format `text` (mrkdwn, `<@U…>` mentions): the Slack ids it
 * mentions. The backend looks them up and the encryption service builds the message HTML from
 * the encrypted text with them (compose template slackMessageContent), so the backend never
 * parses, or reads, the text.
 */
const slackTextFacts = {
  slackMentionUserIds: derive.slackMentionUserIds,
  slackMentionGroupIds: derive.slackMentionGroupIds,
  slackMentionChannels: derive.slackMentionChannels,
} as const;

/**
 * The facts of a message's content (mentions, `@channel` / `@here`, link preview, PR links, Meet
 * links, bot command): the same facts, under the same names, as the dashboard's
 * `conversations.send`, because both end in the same message insert job.
 */
const contentFacts = conversationsSendClient.sourceToDerived.content;

// ─── Route contracts (method, address, body, response) ────────────────────────
// The body schemas below were the chat controller's own (PostMessageBodySchema,
// UpdateMessageBodySchema); they live here now so the backend and bot SDKs share them.

/** `contentFormat` values; the backend's `ContentFormat` enum has the same ones. */
export const appsContentFormatSchema = z.enum(['markdown']);

const appsUploadedFileSchema = z.object({
  originalName: z.string(),
  fileName: z.string(),
  fileSize: z.number(),
  mimeType: z.string(),
  fileUrl: z.string(),
  thumbnailUrl: z.string().optional(),
});

/** Fields every chat message body has (postMessage, updateMessage). */
const appsChatMessageFields = {
  /**
   * Plain text or Slack BlockKit. Encrypted (the ingress transit proxy, MASTER_DEK): the
   * encryption service builds the message HTML from it (compose), the backend reads its facts.
   */
  text: unreadableString().optional(),
  /** Raw markdown (optional frontmatter), stored as-is. Encrypted by the ingress transit proxy (MASTER_DEK). */
  markdownText: unreadableString().optional(),
  attachments: z.array(z.any()).optional(),
  /** Message metadata (e.g. hasAppActions, appId). */
  metadata: z.record(z.string(), z.unknown()).optional(),
  uploadedFiles: z.array(appsUploadedFileSchema).optional(),
  contentFormat: appsContentFormatSchema.optional(),
};

/** A v2 Flow UI definition as an app sends it (screenId and loadingComponentIds may be left out). */
export const appsFlowInputSchema = z.object({
  version: z.literal('2.0'),
  screenId: z.string().optional(),
  title: z.string().optional(),
  components: z.array(z.record(z.string(), z.any())).optional(),
  data: z.record(z.string(), z.unknown()).optional(),
  state: z.object({
    values: z.record(z.string(), z.unknown()),
    touched: z.record(z.string(), z.boolean()),
    errors: z.record(z.string(), z.string()),
    submitting: z.boolean(),
    submitted: z.boolean(),
    history: z.array(z.string()),
    loadingComponentIds: z.array(z.string()).optional(),
  }),
});

/**
 * postMessage's fields without its cross-field checks, for callers that add fields (the
 * internal S2S postAsUser route adds `userId`): zod cannot extend a schema that has refinements.
 */
export const appsChatPostMessageFields = {
  ...appsChatMessageFields,
  channelId: z.string().min(1, 'Channel ID is required').trim().optional(),
  channelName: z.string().min(1, 'Channel name is required').trim().optional(),
  conversationId: z.string().trim().optional(),
  flow: appsFlowInputSchema.optional(),
};

/** postMessage's cross-field checks, applied to any object schema with its fields. */
export function refineAppsChatPostMessage<S extends z.ZodObject<typeof appsChatPostMessageFields>>(schema: S) {
  return schema
    .refine(
      (data) => hasText(data.text) || hasText(data.markdownText) || !!data.flow || (!!data.attachments && data.attachments.length > 0),
      { message: 'Either text, markdownText, flow, or attachments is required', path: ['text'] },
    )
    .refine((data) => !!data.channelId || !!data.channelName || !!data.conversationId, {
      message: 'Either channelId, channelName, or conversationId is required',
      path: ['channelId'],
    });
}

export const appsChatPostMessageBodySchema = refineAppsChatPostMessage(z.object(appsChatPostMessageFields));

/**
 * postEphemeral's body: postMessage's fields plus `user` (the single recipient) and
 * `messageDelivery` (EPHEMERAL renders a card; OPENSCREEN opens the flow as a popup).
 */
export const appsChatPostEphemeralBodySchema = refineAppsChatPostMessage(
  z.object({
    ...appsChatPostMessageFields,
    user: z.string().min(1, 'user is required').trim(),
    messageDelivery: z.enum(MESSAGE_DELIVERY).default('EPHEMERAL'),
  }),
).refine(
  // A popup renders a screen; there is nothing to show without one. Rejecting here gives the
  // app a 400 it can act on, instead of a 201 and an empty dialog for the recipient.
  (data) => data.messageDelivery !== 'OPENSCREEN' || !!data.flow,
  { message: 'flow is required when messageDelivery is OPENSCREEN', path: ['flow'] },
);

/** What postEphemeral answers: delivery is best-effort, nothing is stored. */
export const appsChatPostEphemeralResponseSchema = z.object({
  messageId: z.string(),
  channelId: z.string(),
  conversationId: z.string().nullable(),
  visibleTo: z.string(),
  messageDelivery: z.enum(MESSAGE_DELIVERY),
  ephemeral: z.literal(true),
  delivery: z.literal('best-effort'),
});

export const appsChatUpdateMessageBodySchema = z
  .object({
    ...appsChatMessageFields,
    messageId: z.string().min(1, 'Message ID is required').trim(),
    channelId: z.string().optional(),
    channelName: z.string().trim().optional(),
    flowJSON: z.record(z.string(), z.unknown()).optional(),
  })
  .refine(
    (data) => hasText(data.text) || hasText(data.markdownText) || !!data.flowJSON || (!!data.attachments && data.attachments.length > 0),
    { message: 'Either text, markdownText, flowJSON, or attachments is required', path: ['text'] },
  );

/** What postMessage / updateMessage / deleteMessage answer. */
export const appsChatActionResponseSchema = z.object({
  eventType: z.enum(['MESSAGE_POSTED', 'MESSAGE_UPDATED', 'MESSAGE_DELETED']),
  conversationId: z.string(),
  messageId: z.string(),
  channelId: z.string().optional(),
  ticketId: z.string().optional(),
});

/** deleteMessage's body: the message, and the channel it must be in. Ids only, nothing encrypted. */
export const appsChatDeleteMessageBodySchema = z
  .object({
    messageId: z.string().min(1, 'Message ID is required').trim(),
    channelId: z.string().min(1, 'Channel ID is required').trim().optional(),
    channelName: z.string().min(1, 'Channel name is required').trim().optional(),
  })
  .refine((data) => !!data.channelId || !!data.channelName, {
    message: 'Either channelId or channelName is required',
    path: ['channelId'],
  });

/**
 * agentProgress's body: an ephemeral "agent is working" signal (no DB write, Redis pub/sub
 * only), published by xyne-claw-auth while an agent runs. Not encrypted.
 */
export const appsChatAgentProgressBodySchema = z.object({
  conversationId: z.string().min(1).trim(),
  channelId: z.string().min(1).trim().optional(),
  agentSlug: z.string().min(1).trim().optional(),
  agentName: z.string().min(1).trim().optional(),
  toolLabel: z.string().optional(),
  status: z.enum(['working', 'done']).default('working'),
  /** The human who started the run: gates the Stop button. */
  triggeredByUserId: z.string().min(1).trim().optional(),
  /** The run id: scopes done-suppression so a straggler from a finished run can't resurrect the spinner. */
  sessionId: z.string().min(1).trim().optional(),
});

/** What agentProgress answers; `suppressed` when a late `working` from a finished run was dropped. */
export const appsChatAgentProgressResponseSchema = z.object({
  success: z.literal(true),
  suppressed: z.literal(true).optional(),
});

export const appsChatDeleteMessage = defineRoute({
  method: 'POST',
  path: '/apps/chat/deleteMessage',
  body: appsChatDeleteMessageBodySchema,
  response: appsChatActionResponseSchema,
});

export const appsChatAgentProgress = defineRoute({
  method: 'POST',
  path: '/apps/chat/agentProgress',
  body: appsChatAgentProgressBodySchema,
  response: appsChatAgentProgressResponseSchema,
});

export const appsChatPostMessage = defineRoute({
  method: 'POST',
  path: '/apps/chat/postMessage',
  body: appsChatPostMessageBodySchema,
  // `text` is Slack format (built into HTML by compose; the facts come from the result) or, with
  // contentFormat markdown, the content itself: hence both sets of facts.
  facts: { markdownText: contentFacts, text: { ...contentFacts, ...slackTextFacts } },
  response: appsChatActionResponseSchema,
});

export const appsChatPostEphemeral = defineRoute({
  method: 'POST',
  path: '/apps/chat/postEphemeral',
  body: appsChatPostEphemeralBodySchema,
  // Never stored: nothing reads facts of markdownText; `text` is built into HTML as for postMessage.
  facts: { markdownText: {}, text: slackTextFacts },
  response: appsChatPostEphemeralResponseSchema,
});

export const appsChatUpdateMessage = defineRoute({
  method: 'POST',
  path: '/apps/chat/updateMessage',
  body: appsChatUpdateMessageBodySchema,
  facts: { markdownText: {}, text: slackTextFacts },
  response: appsChatActionResponseSchema,
});
