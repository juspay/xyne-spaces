export type ThinkingLevel = 'off' | 'minimal' | 'low' | 'medium' | 'high';

/** Context the user attached to a message; also what the server stores on it. */
export interface AttachedContextItem {
  type: string;
  id: string;
  title: string;
  threadId?: string | undefined;
  metadata?: Record<string, string> | undefined;
}

export interface XyneAIStreamRequest {
  query: string;
  /** Empty for a new chat; the server assigns one in its `start` event. */
  sessionId: string;
  agentSlug?: string | undefined;
  model?: string | undefined;
  /** Only meaningful with `model`. */
  modelProvider?: string | undefined;
  thinkingLevel?: ThinkingLevel | undefined;
  instant?: boolean | undefined;
  webSearchEnabled?: boolean | undefined;
  deepResearchEnabled?: boolean | undefined;
  /** The user message a regenerated answer branches from. */
  parentMessageId?: string | undefined;
  isRegenerate?: boolean | undefined;
  attachedContext?: AttachedContextItem[] | undefined;
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
  attachedContext = [],
}: XyneAIStreamRequest): Record<string, unknown> {
  const idsOf = (type: string): string[] =>
    attachedContext.filter(item => item.type === type).map(item => item.id);

  /* eslint-disable @typescript-eslint/naming-convention */
  return {
    query,
    channel_ids: idsOf('channel'),
    conversation_id: '',
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
    ...(attachedContext.length > 0 && {
      ticket_ids: idsOf('ticket'),
      canvas_ids: idsOf('canvas'),
      call_ids: idsOf('call'),
      attached_context: attachedContext,
    }),
  };
  /* eslint-enable @typescript-eslint/naming-convention */
}
