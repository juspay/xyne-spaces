/**
 * Platform-agnostic Ask AI request-body builder.
 *
 * Maps the camelCase {@link AskAIRequestInput} to the exact snake_case JSON body
 * the backend (`POST /api/xyne-ai`) expects. This was previously inlined inside
 * the dashboard Web Worker; it is pure (no `fetch`, no globals) so both web and
 * native can share ONE serializer and never drift.
 *
 * IMPORTANT: this is a faithful, field-for-field port of the worker's original
 * inline serialization — same conditional-inclusion rules, same defaults, same
 * key names (including the deliberately camelCase `agentSlug`, and the always-
 * present `research_context`/`instant`/`*_enabled` keys). Do not "clean up" the
 * conditionals without checking the backend contract; empty-array omission and
 * `?? false`/`?? null` defaults are load-bearing.
 */

import type { AskAIRequestInput } from "./types";

/**
 * Serialize an {@link AskAIRequestInput} into the wire body for the Ask AI
 * streaming endpoint. Returns a plain object; the caller is responsible for
 * `JSON.stringify` and transport.
 */
export function buildAskAIRequestBody(
  input: AskAIRequestInput,
): Record<string, unknown> {
  /* eslint-disable @typescript-eslint/naming-convention */
  return {
    query: input.query,
    ...(input.displayQuery && { display_query: input.displayQuery }),
    channel_ids: input.channelIds,
    ...(input.collectionIds &&
      input.collectionIds.length > 0 && {
        collection_ids: input.collectionIds,
      }),
    ...(input.fileIds &&
      input.fileIds.length > 0 && { file_ids: input.fileIds }),
    ...(input.canvasIds &&
      input.canvasIds.length > 0 && { canvas_ids: input.canvasIds }),
    ...(input.ticketIds &&
      input.ticketIds.length > 0 && { ticket_ids: input.ticketIds }),
    ...(input.callIds &&
      input.callIds.length > 0 && { call_ids: input.callIds }),
    ...(input.attachedContext &&
      input.attachedContext.length > 0 && {
        attached_context: input.attachedContext,
      }),
    conversation_id: input.conversationId,
    session_id: input.sessionId,
    web_search_enabled: input.webSearchEnabled,
    deep_research_enabled: input.deepResearchEnabled ?? false,
    create_canvas_enabled: input.createCanvasEnabled ?? false,
    instant: input.instant ?? false,
    research_context: input.researchContext ?? null,
    ...(input.canvasId && {
      canvas_id: input.canvasId,
    }),
    ...(input.messageAttachmentIds &&
      input.messageAttachmentIds.length > 0 && {
        message_attachment_ids: input.messageAttachmentIds,
      }),
    ...(input.attachments &&
      input.attachments.length > 0 && {
        attachments: input.attachments.map((a) => ({
          data: a.data,
          mime_type: a.mimeType,
          filename: a.filename,
        })),
      }),
    ...(input.parentMessageId && {
      parent_message_id: input.parentMessageId,
    }),
    ...(input.isRegenerate && { is_regenerate: input.isRegenerate }),
    ...(input.isEditUserMessage && {
      is_edit_user_message: input.isEditUserMessage,
    }),
    ...(input.editedUserMessageId && {
      edited_user_message_id: input.editedUserMessageId,
    }),
    ...(input.parentAssistantMessageId && {
      parent_assistant_message_id: input.parentAssistantMessageId,
    }),
    ...(input.draftMode && { draft_mode: true }),
    ...(input.version && { version: input.version }),
    ...(input.disableTools && { disable_tools: true }),
    ...(input.agentSlug && { agentSlug: input.agentSlug }),
    ...(input.model && { model: input.model }),
  };
  /* eslint-enable @typescript-eslint/naming-convention */
}
