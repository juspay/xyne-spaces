import { z } from 'zod';
import { defineRequestContract, type RequestOf } from '../define.js';
import { defineRoute } from '../api-route.js';
import { MESSAGE_DELIVERY } from '../../validation/flowSchema.js';
import { conversationsSendClient } from './conversations.js';

/**
 * Xyne Apps `POST /apps/chat/postMessage`, sent by bots through the transit proxy, which
 * encrypts `markdownText` under the apps transit keys; the handler stores the workspace-DEK
 * ciphertext as-is. The message's insert side effects read these facts instead of parsing the
 * content (mentions, `@channel` / `@here`, link preview, PR links, Meet links, bot command):
 * the same facts, under the same names, as the dashboard's `conversations.send`, because both
 * end in the same message insert job (`derived.fields.content`).
 * `text` stays plaintext for now: the handler resolves Slack mentions and parses BlockKit in
 * it, which cannot run on ciphertext until that processing moves into the extractor.
 */
export const appsChatPostMessageClient = defineRequestContract({
  sourceToDerived: { markdownText: conversationsSendClient.sourceToDerived.content },
  schema: z.object({
    channelId: z.string().optional(),
    channelName: z.string().optional(),
    conversationId: z.string().optional(),
    text: z.string().optional(),
    markdownText: z.string().optional(),
    flow: z.unknown().optional(),
    attachments: z.array(z.unknown()).optional(),
  }),
});

export type AppsChatPostMessageRequest = RequestOf<typeof appsChatPostMessageClient>;

/**
 * Xyne Apps `POST /apps/chat/updateMessage`: same treatment as postMessage. The ingress
 * proxy encrypts `markdownText`; the handler stores the workspace-DEK ciphertext as-is.
 * `text` and `flowJSON` stay plaintext (mentions, BlockKit and flow HTML are built from them).
 */
export const appsChatUpdateMessageClient = defineRequestContract({
  sourceToDerived: { markdownText: {} },
  schema: z.object({
    messageId: z.string(),
    channelId: z.string().optional(),
    channelName: z.string().optional(),
    text: z.string().optional(),
    markdownText: z.string().optional(),
    flowJSON: z.unknown().optional(),
    attachments: z.array(z.unknown()).optional(),
  }),
});

export type AppsChatUpdateMessageRequest = RequestOf<typeof appsChatUpdateMessageClient>;

/**
 * Xyne Apps `POST /apps/chat/postEphemeral`: the ingress proxy encrypts `markdownText`, and
 * the encryption service turns it into workspace-DEK ciphertext (MASTER_DEK), as for
 * postMessage, so the backend and Redis never hold it in the clear. The message is never
 * stored: the backend relays the ciphertext to the recipient's sockets, re-encrypting it per
 * socket for that tab's transit key (websocketService.handleUserEvent), and the browser
 * decrypts it (useEphemeralMessages). Nothing is derived (no insert job reads facts). `text`
 * and `flow` stay plaintext, as for postMessage.
 */
export const appsChatPostEphemeralClient = defineRequestContract({
  sourceToDerived: { markdownText: {} },
  schema: z.object({
    channelId: z.string().optional(),
    channelName: z.string().optional(),
    conversationId: z.string().optional(),
    user: z.string(),
    messageDelivery: z.string().optional(),
    text: z.string().optional(),
    markdownText: z.string().optional(),
    flow: z.unknown().optional(),
    attachments: z.array(z.unknown()).optional(),
  }),
});

export type AppsChatPostEphemeralRequest = RequestOf<typeof appsChatPostEphemeralClient>;

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
  /** Plain text or Slack BlockKit, processed through the BlockKit parser. */
  text: z.string().optional(),
  /** Raw markdown (optional frontmatter), stored as-is. Encrypted by the ingress transit proxy. */
  markdownText: z.string().optional(),
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
      (data) => !!data.text || !!data.markdownText || !!data.flow || (!!data.attachments && data.attachments.length > 0),
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
    (data) => !!data.text || !!data.markdownText || !!data.flowJSON || (!!data.attachments && data.attachments.length > 0),
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
  response: appsChatActionResponseSchema,
  encryption: appsChatPostMessageClient,
});

export const appsChatPostEphemeral = defineRoute({
  method: 'POST',
  path: '/apps/chat/postEphemeral',
  body: appsChatPostEphemeralBodySchema,
  response: appsChatPostEphemeralResponseSchema,
  encryption: appsChatPostEphemeralClient,
});

export const appsChatUpdateMessage = defineRoute({
  method: 'POST',
  path: '/apps/chat/updateMessage',
  body: appsChatUpdateMessageBodySchema,
  response: appsChatActionResponseSchema,
  encryption: appsChatUpdateMessageClient,
});
