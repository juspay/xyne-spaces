export type ThinkingLevel = 'off' | 'minimal' | 'low' | 'medium' | 'high';

/** Context the user attached to a message; also what the server stores on it. */
export interface AttachedContextItem {
  type: string;
  id: string;
  title: string;
  threadId?: string | undefined;
  metadata?: Record<string, string> | undefined;
}

/** A file sent with a message; `data` is raw base64, absent on files reloaded from history. */
export interface AttachedFile {
  /** Set on files reloaded from history, which are fetched by id. */
  id?: string | undefined;
  filename: string;
  mimeType: string;
  data?: string | undefined;
}

export interface XyneAIStreamRequest {
  query: string;
  /** Empty for a new chat; the server assigns one in its `start` event. */
  sessionId: string;
  agentSlug?: string | undefined;
  model?: string | undefined;
  modelProvider?: string | undefined;
  thinkingLevel?: ThinkingLevel | undefined;
  instant?: boolean | undefined;
  webSearchEnabled?: boolean | undefined;
  deepResearchEnabled?: boolean | undefined;
  /** What the new message hangs under: the previous answer, or the question a regenerated answer branches from. */
  parentMessageId?: string | undefined;
  isRegenerate?: boolean | undefined;
  /** An edited question is sent as a sibling of `editedUserMessageId` under `parentAssistantMessageId`. */
  isEditUserMessage?: boolean | undefined;
  editedUserMessageId?: string | undefined;
  parentAssistantMessageId?: string | undefined;
  attachedContext?: AttachedContextItem[] | undefined;
  attachments?: AttachedFile[] | undefined;
  /** The message thread this chat is about ("Ask AI" on a message). */
  conversationId?: string | undefined;
  messageAttachmentIds?: string[] | undefined;
}

/** The body the web client sends for a standalone chat turn (`version` is always v2). */
export function buildStreamRequestBody({
  query,
  sessionId,
  agentSlug,
  model,
  modelProvider,
  thinkingLevel,
  instant,
  webSearchEnabled,
  deepResearchEnabled,
  parentMessageId,
  isRegenerate,
  isEditUserMessage,
  editedUserMessageId,
  parentAssistantMessageId,
  attachedContext = [],
  attachments = [],
  conversationId = '',
  messageAttachmentIds = [],
}: XyneAIStreamRequest): Record<string, unknown> {
  const idsOf = (type: string): string[] =>
    attachedContext.filter(item => item.type === type).map(item => item.id);
  const files = attachments.filter(file => file.data);

  /* eslint-disable @typescript-eslint/naming-convention */
  return {
    query,
    channel_ids: idsOf('channel'),
    conversation_id: conversationId,
    session_id: sessionId,
    web_search_enabled: webSearchEnabled ?? false,
    deep_research_enabled: deepResearchEnabled ?? false,
    create_canvas_enabled: false,
    instant: instant ?? false,
    research_context: null,
    version: 'v2',
    ...(thinkingLevel && { thinkingLevel }),
    ...(agentSlug && { agentSlug }),
    ...(model && { model }),
    ...(model && modelProvider && { modelProvider }),
    ...(parentMessageId && { parent_message_id: parentMessageId }),
    ...(isRegenerate && { is_regenerate: true }),
    ...(isEditUserMessage && { is_edit_user_message: true }),
    ...(editedUserMessageId && { edited_user_message_id: editedUserMessageId }),
    ...(parentAssistantMessageId && { parent_assistant_message_id: parentAssistantMessageId }),
    ...(attachedContext.length > 0 && {
      ticket_ids: idsOf('ticket'),
      canvas_ids: idsOf('canvas'),
      call_ids: idsOf('call'),
      attached_context: attachedContext,
    }),
    ...(messageAttachmentIds.length > 0 && { message_attachment_ids: messageAttachmentIds }),
    ...(files.length > 0 && {
      attachments: files.map(({ data, mimeType, filename }) => ({
        data,
        mime_type: mimeType,
        filename,
      })),
    }),
  };
  /* eslint-enable @typescript-eslint/naming-convention */
}
