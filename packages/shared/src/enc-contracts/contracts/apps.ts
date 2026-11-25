import { z } from 'zod';
import { defineRequestContract, type RequestOf } from '../define.js';
import { defineRoute } from '../api-route.js';
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

export const appsChatPostMessage = defineRoute({
  method: 'POST',
  path: '/apps/chat/postMessage',
  body: appsChatPostMessageBodySchema,
  response: appsChatActionResponseSchema,
  encryption: appsChatPostMessageClient,
});

export const appsChatUpdateMessage = defineRoute({
  method: 'POST',
  path: '/apps/chat/updateMessage',
  body: appsChatUpdateMessageBodySchema,
  response: appsChatActionResponseSchema,
  encryption: appsChatUpdateMessageClient,
});
