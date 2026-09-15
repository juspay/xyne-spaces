import { lengthBucket } from './trackSource';

export type XyneAiSurface = 'panel' | 'page';

/**
 * What caused a send. `button` is special: the send button keeps its own
 * `data-track-name` (`SEND_MESSAGE` on the /ai page, `SUBMIT_MESSAGE` in the
 * panel) so the click series that predate the manual event keep flowing, and
 * the manual SEND_MESSAGE is skipped for that trigger so no send counts twice.
 */
export type XyneAiSendTrigger =
  | 'button'
  | 'enter'
  | 'programmatic'
  | 'submit'
  | 'regenerate'
  | 'edit'
  | 'auto_send'
  | 'suggestion';

/**
 * Run dimensions a send button can bake into `data-track-metadata` at render
 * time, so its click row carries the same keys as the manual SEND_MESSAGE.
 * Attachment and context counts are omitted where the button cannot see them.
 */
export function aiSendButtonTrackingMetadata(args: {
  surface: XyneAiSurface;
  agentSlug?: string | null | undefined;
  model?: string | null | undefined;
  thinkingLevel?: string | null | undefined;
  webSearchEnabled?: boolean | undefined;
  deepResearchEnabled?: boolean | undefined;
  createCanvasEnabled?: boolean | undefined;
  attachmentsCount?: number | undefined;
}): Record<string, unknown> {
  return {
    surface: args.surface,
    trigger: 'button' satisfies XyneAiSendTrigger,
    agentSlug: args.agentSlug ?? 'ask-ai',
    ...(args.model && { model: args.model }),
    ...(args.thinkingLevel && { thinkingLevel: args.thinkingLevel }),
    webSearchEnabled: !!args.webSearchEnabled,
    deepResearchEnabled: !!args.deepResearchEnabled,
    createCanvasEnabled: !!args.createCanvasEnabled,
    ...(typeof args.attachmentsCount === 'number' && { attachmentsCount: args.attachmentsCount }),
  };
}

export interface AiRunTrackingArgs {
  surface: XyneAiSurface | undefined;
  contextType?: string | null | undefined;
  agentSlug?: string | null | undefined;
  model?: string | null | undefined;
  modelProvider?: string | null | undefined;
  thinkingLevel?: string | null | undefined;
  webSearchEnabled?: boolean | undefined;
  deepResearchEnabled?: boolean | undefined;
  createCanvasEnabled?: boolean | undefined;
  instant?: boolean | undefined;
  attachmentsCount?: number | undefined;
  channelCount?: number | undefined;
  fileCount?: number | undefined;
  folderCount?: number | undefined;
  collectionCount?: number | undefined;
  canvasCount?: number | undefined;
  ticketCount?: number | undefined;
  callCount?: number | undefined;
  hasSelectionContext?: boolean | undefined;
  hasResearchContext?: boolean | undefined;
  hasWorkflowContext?: boolean | undefined;
  queryLength?: number | undefined;
  isRegenerate?: boolean | undefined;
  isEdit?: boolean | undefined;
  conversationId?: string | null | undefined;
}

/**
 * Dimensions for every Xyne AI run event (`SEND_MESSAGE`, `RESPONSE_*`).
 *
 * Built from what `useXyneAIStream.submitQuery` already has in hand. Never the
 * query, attachment filenames or selection text — only counts, flags and enums.
 * `conversationId` is the claw session id, which is safe to store: it is the
 * join key to `agent_runs`, not user content.
 */
export function aiRunTrackingMetadata(args: AiRunTrackingArgs): Record<string, unknown> {
  const conversationId = args.conversationId || null;
  return {
    surface: args.surface ?? 'panel',
    ...(args.contextType && { contextType: args.contextType }),
    agentSlug: args.agentSlug ?? 'ask-ai',
    ...(args.model && { model: args.model }),
    ...(args.modelProvider && { modelProvider: args.modelProvider }),
    ...(args.thinkingLevel && { thinkingLevel: args.thinkingLevel }),
    webSearchEnabled: !!args.webSearchEnabled,
    deepResearchEnabled: !!args.deepResearchEnabled,
    createCanvasEnabled: !!args.createCanvasEnabled,
    instant: !!args.instant,
    attachmentsCount: args.attachmentsCount ?? 0,
    channelCount: args.channelCount ?? 0,
    fileCount: args.fileCount ?? 0,
    folderCount: args.folderCount ?? 0,
    collectionCount: args.collectionCount ?? 0,
    canvasCount: args.canvasCount ?? 0,
    ticketCount: args.ticketCount ?? 0,
    callCount: args.callCount ?? 0,
    hasSelectionContext: !!args.hasSelectionContext,
    hasResearchContext: !!args.hasResearchContext,
    hasWorkflowContext: !!args.hasWorkflowContext,
    ...(typeof args.queryLength === 'number' && {
      queryLengthBucket: lengthBucket(args.queryLength),
    }),
    isRegenerate: !!args.isRegenerate,
    isEdit: !!args.isEdit,
    isNewConversation: !conversationId,
    ...(conversationId && { conversationId }),
  };
}

/**
 * Dimensions for act-on-answer clicks (copy, like, dislike, regenerate,
 * citations…) so they join back to the run that produced the answer.
 */
export function aiMessageTrackingMetadata(args: {
  conversationId?: string | null | undefined;
  messageId?: string | null | undefined;
  agentSlug?: string | null | undefined;
  model?: string | null | undefined;
  surface?: XyneAiSurface | undefined;
}): Record<string, unknown> {
  return {
    ...(args.surface && { surface: args.surface }),
    ...(args.conversationId && { conversationId: args.conversationId }),
    ...(args.messageId && { messageId: args.messageId }),
    ...(args.agentSlug && { agentSlug: args.agentSlug }),
    ...(args.model && { model: args.model }),
  };
}

export { lengthBucket };
