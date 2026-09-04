import { useCallback, useEffect, useRef } from 'react';
import type {
  Message,
  MessageAttachment,
  SelectionContext,
  UserTag,
  DebugEventRecord,
} from '../components/Chat/XyneAISidebar/utils/XyneAITypes';
import type { ResearchContext } from '@xyne/shared';
import type { AttachedContextItem } from '../components/Chat/XyneAISidebar/components/ContextPickerPanel';
import type { UserActivity } from '../hooks/useUserActivity';
import { xyneAIStreamManager, type StreamState } from '../services/XyneAI';
import { buildXyneAIStreamThreadId } from '../utils/xyneAIStreamThreadId';

/**
 * Per-submit overrides for the stream options. When provided, each field takes
 * precedence over the hook-level config for that single submitQuery call. Used
 * by the /ai composer, which owns its own context/toggle state and passes a
 * snapshot at submit time instead of feeding the hook config on every render.
 */
export interface StreamOverrides {
  channelIds?: string[];
  collectionIds?: string[];
  fileIds?: string[];
  /** Folder scopes from the composer picker. Sent to claw-auth as a single
   *  'folder' attached_context pointer per id — xyneAIControllerV2.ts does
   *  NOT expand this to a recursive file list; claw-auth resolves it itself,
   *  at Vespa-query time. */
  folderIds?: string[];
  webSearchEnabled?: boolean;
  deepResearchEnabled?: boolean;
  createCanvasEnabled?: boolean;
  /** Single search + single answer pass instead of the full agentic tool
   *  loop — see xyne-claw-auth's run-stream.ts POST / instant branch. */
  instant?: boolean;
  /** Per-run model pin from the composer's model dropdown. Absent = hook-level
   *  `model` (the sidebar's picker), which itself defaults to the DB-configured
   *  model. A pick is the source of truth for the run. */
  model?: string | null;
  /** Which provider a model pin rides — the models endpoint's pinProvider
   *  ("litellm" = the agent's shared credential, "spaces" = the keyless
   *  platform provider). Only sent alongside `model`. */
  modelProvider?: 'litellm' | 'spaces' | null;
  /** Per-run thinking level. Absent = the agent's configured default. */
  thinkingLevel?: 'off' | 'minimal' | 'low' | 'medium' | 'high';
  researchContext?: ResearchContext | null;
  ticketIds?: string[];
  canvasIds?: string[];
  callIds?: string[];
  attachedContext?: AttachedContextItem[];
  /** Display-only richer context set (KB pills incl. titles) to stamp on the
   *  optimistic user message so it matches the persisted pills after reload.
   *  Falls back to `attachedContext` when absent. Never sent to the backend. */
  displayAttachedContext?: AttachedContextItem[];
}

interface UseXyneAIStreamParams {
  channelIds: string[];
  conversationId: string;
  /** Client draft UUID or server session id — must match active conversation slot */
  streamSessionKey: string;
  threadConversationId?: string | undefined;
  attachmentIds?: string[] | undefined; // Attachment IDs to fetch from GCS on backend
  canvasId?: string | null;
  setMessages: React.Dispatch<React.SetStateAction<Message[]>>;
  setConversationId: React.Dispatch<React.SetStateAction<string>>;
  setCurrentTraceId?: React.Dispatch<React.SetStateAction<string | undefined>>;
  webSearchEnabled?: boolean;
  deepResearchEnabled?: boolean;
  researchContext?: ResearchContext | null;
  collectionIds?: string[];
  fileIds?: string[];
  /** Folder scopes from the composer picker. Sent to claw-auth as a single
   *  'folder' attached_context pointer per id — xyneAIControllerV2.ts does
   *  NOT expand this to a recursive file list; claw-auth resolves it itself,
   *  at Vespa-query time. */
  folderIds?: string[];
  createCanvasEnabled?: boolean;
  instant?: boolean;
  isV2?: boolean;
  channelId?: string | undefined; // Added for thread ID construction
  ticketIds?: string[];
  canvasIds?: string[];
  callIds?: string[];
  attachedContext?: AttachedContextItem[];
  /** See StreamOverrides.displayAttachedContext — the richer set (with KB pills)
   *  used only to render the just-sent message's pills. */
  displayAttachedContext?: AttachedContextItem[];
  activities?: UserActivity[]; // User activities to include as context
  /** Selected claw agent slug. If set, the query is routed to that agent instead of Ask AI. */
  agentSlug?: string | null;
  /** Per-run model pin from the composer's model picker. Null = agent default. */
  model?: string | null;
  /** pinProvider for the hook-level `model` (see StreamOverrides.modelProvider). */
  modelProvider?: 'litellm' | 'spaces' | null;
  /** Hook-level thinking pick (the sidebar's menu). Null = agent default. */
  thinkingLevel?: 'off' | 'minimal' | 'low' | 'medium' | 'high' | null;
  /** Skip the global "response ready" toast for this stream (embedded/preview instances). */
  suppressCompletionToast?: boolean;
  setDebugEvents?: React.Dispatch<React.SetStateAction<DebugEventRecord[]>>;
  setDebugArtifactsReadyVersion?: React.Dispatch<React.SetStateAction<number>>;
}

/**
 * Convert user activities to attached context items for v2 API
 */
function activitiesToAttachedContext(activities: UserActivity[]): AttachedContextItem[] {
  return activities.map((activity, index) => ({
    type: 'activity' as const,
    id: `activity-${index}`,
    title: activity.eventName,
    eventName: activity.eventName,
    eventCategory: activity.eventCategory,
    timestamp: activity.timestamp,
    metadata: activity.contextMetadata ?? {},
    relatedData: (activity.relatedData ?? {}) as Record<string, unknown>,
  }));
}

// Canvas creation instruction appended when createCanvasEnabled is true
const CANVAS_CREATION_INSTRUCTION = `
<mandatory_final_step>
You MUST perform these steps after completing your analysis:

1. Call the <tool>create_canvas</tool> tool with:
   - title: A descriptive title for the document
   - markdown: Your complete response formatted in markdown with proper headings, sections, and structure

2. After the tool returns, you MUST include the canvas URL from the tool output in your response.
   The tool will return: "Canvas created successfully! Title: ... URL: https://spaces.xyne.juspay.net/chat/canvas/..."
   Extract and display this URL so the user can click on it.

This is MANDATORY - the user requires the output in a canvas document with a clickable link.
</mandatory_final_step>`;

export const useXyneAIStream = ({
  channelIds,
  conversationId,
  streamSessionKey,
  threadConversationId,
  attachmentIds,
  canvasId,
  setMessages,
  setConversationId,
  setCurrentTraceId,
  webSearchEnabled = false,
  deepResearchEnabled = false,
  researchContext,
  collectionIds,
  fileIds,
  folderIds,
  createCanvasEnabled = false,
  instant = false,
  isV2 = false,
  channelId,
  ticketIds,
  canvasIds,
  callIds,
  attachedContext,
  displayAttachedContext,
  activities,
  agentSlug,
  model,
  modelProvider,
  thinkingLevel,
  suppressCompletionToast,
  setDebugEvents,
  setDebugArtifactsReadyVersion,
}: UseXyneAIStreamParams) => {
  const currentStreamIdRef = useRef<string | null>(null);

  const threadId = buildXyneAIStreamThreadId({
    channelId: channelId ?? null,
    threadConversationId: threadConversationId ?? null,
    streamSessionKey,
  });

  // Track conversationId in a ref so subscription doesn't re-run when it changes
  const conversationIdRef = useRef(conversationId);
  conversationIdRef.current = conversationId;

  const streamSessionKeyRef = useRef(streamSessionKey);
  streamSessionKeyRef.current = streamSessionKey;

  const prevStreamSessionKeyRef = useRef(streamSessionKey);
  if (prevStreamSessionKeyRef.current !== streamSessionKey) {
    prevStreamSessionKeyRef.current = streamSessionKey;
    currentStreamIdRef.current = null;
  }

  // Subscribe by streamSlotKey (matches streamSessionKey). During draft→server migration,
  // React may still have the draft key in refs while the manager already updated streamSlotKey;
  // fall back to streamId (one POST == one streamId) so chunks are not dropped.
  useEffect(() => {
    const expectedAgentSlug = agentSlug ?? 'ask-ai';
    const unsubscribe = xyneAIStreamManager.subscribe((state: StreamState) => {
      if ((state.agentSlug ?? 'ask-ai') !== expectedAgentSlug) return;
      const slotRef = streamSessionKeyRef.current;
      const matchesSlot = state.streamSlotKey === slotRef;
      const matchesTrackedStream =
        currentStreamIdRef.current !== null && state.streamId === currentStreamIdRef.current;
      // Also match by sessionId: a stream created with a draft slot key gets
      // its server sessionId mid-flight (see meta-event handler in the
      // manager). If the user switched conversations before the slot key
      // promotion landed everywhere, we can still recognise "this stream
      // belongs to the conversation this hook represents" by sessionId.
      const matchesBySessionId =
        !!state.sessionId &&
        !!conversationIdRef.current &&
        state.sessionId === conversationIdRef.current;
      if (!matchesSlot && !matchesTrackedStream && !matchesBySessionId) return;

      // Once we've matched by anything, lock onto the streamId so future
      // notifications stay routed even if slot key / sessionId change again.
      if (currentStreamIdRef.current !== state.streamId) {
        currentStreamIdRef.current = state.streamId;
      }

      setMessages(state.messages);

      if (state.sessionId && state.sessionId !== conversationIdRef.current) {
        setConversationId(state.sessionId);
      }

      if (state.traceId && setCurrentTraceId) {
        setCurrentTraceId(state.traceId);
      }
      setDebugEvents?.(state.debugEvents);
      setDebugArtifactsReadyVersion?.(state.debugArtifactsReadyVersion);
    });

    const builtThreadId = threadId;
    let activeStream = xyneAIStreamManager.getActiveStream(builtThreadId);
    if (!activeStream) {
      // Search every active stream — match by slot key, by stream's own
      // sessionId, or by the conversationId this hook is bound to. Don't
      // restrict to status==='streaming' — a stream that completed while we
      // were on another conversation still lives in the manager (the
      // activeStreams TTL is 5min) and we want to adopt its messages.
      const sessionToMatch = conversationIdRef.current;
      for (const s of xyneAIStreamManager.getAllActiveStreams().values()) {
        if ((s.agentSlug ?? 'ask-ai') !== expectedAgentSlug) continue;
        if (
          s.streamSlotKey === streamSessionKey ||
          (sessionToMatch && s.sessionId === sessionToMatch)
        ) {
          activeStream = s;
          break;
        }
      }
    }

    if (activeStream) {
      setMessages(activeStream.messages);
      if (activeStream.sessionId) {
        setConversationId(activeStream.sessionId);
      }
      if (activeStream.traceId && setCurrentTraceId) {
        setCurrentTraceId(activeStream.traceId);
      }
      setDebugEvents?.(activeStream.debugEvents);
      setDebugArtifactsReadyVersion?.(activeStream.debugArtifactsReadyVersion);
      currentStreamIdRef.current = activeStream.streamId;
    } else {
      currentStreamIdRef.current = null;
    }

    return () => {
      unsubscribe();
    };
  }, [
    threadId,
    streamSessionKey,
    setMessages,
    setConversationId,
    setCurrentTraceId,
    setDebugEvents,
    setDebugArtifactsReadyVersion,
    agentSlug,
  ]);

  // Store current messages ref for stream manager
  const messagesRef = useRef<Message[]>([]);

  // Keep messagesRef in sync - update on every render cycle
  const syncMessagesRef = useCallback(() => {
    return new Promise<Message[]>(resolve => {
      setMessages(prev => {
        messagesRef.current = prev;
        resolve(prev);
        return prev;
      });
    });
  }, [setMessages]);

  const submitQuery = useCallback(
    async (
      query: string,
      attachments: MessageAttachment[] = [],
      selectionContexts?: SelectionContext[],
      displayContent?: string,
      userTags?: Record<string, UserTag>,
      parentMessageId?: string,
      isRegenerate?: boolean,
      // Branching: edit-user creates a sibling user under
      // `parentAssistantMessageId`. The backend uses these to clone the PI
      // session at the right cut point. Without them v2 edits land as a
      // follow-up turn (LLM keeps running on the same session, so the
      // pre-edit assistant response leaks into context).
      isEditUserMessage?: boolean,
      editedUserMessageId?: string,
      parentAssistantMessageId?: string,
      streamOverrides?: StreamOverrides,
    ): Promise<void> => {
      // Allow empty query if there are selection contexts
      if (!query.trim() && (!selectionContexts || selectionContexts.length === 0)) return;

      // Per-submit overrides take precedence over hook-level config. `in`
      // checks let an explicit override of null/[] win over the closure value.
      const ov = streamOverrides;
      const eWebSearchEnabled =
        ov && 'webSearchEnabled' in ov ? !!ov.webSearchEnabled : webSearchEnabled;
      const eDeepResearchEnabled =
        ov && 'deepResearchEnabled' in ov ? !!ov.deepResearchEnabled : deepResearchEnabled;
      const eCreateCanvasEnabled =
        ov && 'createCanvasEnabled' in ov ? !!ov.createCanvasEnabled : createCanvasEnabled;
      const eInstant = ov && 'instant' in ov ? !!ov.instant : instant;
      const eModel = ov && 'model' in ov ? (ov.model ?? null) : model;
      const eModelProvider = ov && 'model' in ov ? (ov.modelProvider ?? null) : modelProvider;
      const eThinkingLevel = ov?.thinkingLevel ?? thinkingLevel ?? undefined;
      const eResearchContext =
        ov && 'researchContext' in ov ? (ov.researchContext ?? null) : researchContext;
      const eChannelIds = ov?.channelIds ?? channelIds;
      const eCollectionIds = ov?.collectionIds ?? collectionIds ?? [];
      const eFileIds = ov?.fileIds ?? fileIds ?? [];
      const eFolderIds = ov?.folderIds ?? folderIds ?? [];
      const eTicketIds = ov?.ticketIds ?? ticketIds;
      const eCanvasIds = ov?.canvasIds ?? canvasIds;
      const eCallIds = ov?.callIds ?? callIds;
      const eAttachedContext = ov?.attachedContext ?? attachedContext;
      const eDisplayAttachedContext = ov?.displayAttachedContext ?? displayAttachedContext;

      // Build internal query with selection context format
      // Format: from canvas(canvas_id) ```selected_text```
      let internalQuery = query;
      if (selectionContexts && selectionContexts.length > 0) {
        const selectionFormatted = selectionContexts
          .map(ctx => `\n\nfrom canvas(${ctx.canvasId})\n\`\`\`\n${ctx.selectedText}\n\`\`\``)
          .join('');
        internalQuery = query + selectionFormatted;
      }

      // Append canvas context hint for better accuracy when Ask AI is triggered from a canvas
      if (canvasId) {
        const canvasContextHint = `\n\ncanvas_id: ${canvasId}`;
        internalQuery = internalQuery + canvasContextHint;
      }

      // Append hidden canvas instruction when create canvas is enabled (v1 only)
      // For v2, canvas creation is handled via additionalInstructions in the backend
      if (eCreateCanvasEnabled && !isV2) {
        internalQuery = internalQuery + '\n\n' + CANVAS_CREATION_INSTRUCTION;
      }

      // Get current messages synchronously
      // Strip any still-streaming messages — they may not have been cleared yet if abortCurrentRequest
      // was called just before submitQuery (React batches the state update, so prev still shows them).
      // Preserve whatever content was streamed; only fall back to a placeholder
      // when there's nothing at all (i.e. abort before the first delta).
      const rawMessages = await syncMessagesRef();
      const currentMessages = rawMessages.map(msg =>
        msg.isStreaming
          ? {
              ...msg,
              isStreaming: false,
              isAborted: true,
              content: msg.content || msg.streamingContent || '',
            }
          : msg,
      );

      // Convert activities to attachedContext for v2 API
      const activityContext =
        activities && activities.length > 0 ? activitiesToAttachedContext(activities) : undefined;

      // Merge with existing attachedContext — this is what we SEND to the
      // backend (channels/tickets/canvases/calls + activities).
      const combinedAttachedContext = activityContext
        ? [...(eAttachedContext ?? []), ...activityContext]
        : eAttachedContext;

      // What we STAMP on the optimistic user message for its pills. Prefer the
      // richer display set (adds KB collection/folder/file pills with titles)
      // so the just-sent message matches the persisted pills shown after a
      // reload; fall back to the sent set when no display set was provided.
      const displayContextForMessage = eDisplayAttachedContext
        ? activityContext
          ? [...eDisplayAttachedContext, ...activityContext]
          : eDisplayAttachedContext
        : combinedAttachedContext;

      // Add user message (original query without internal formatting, but with selectionContexts for UI)
      // For regenerate: don't create a new user message — reuse the existing one.
      // The bot response branches as a new child of the same user message.
      const localUserMessageId =
        isRegenerate && parentMessageId ? parentMessageId : `user-${Date.now()}`;

      const userMessage: Message | null = isRegenerate
        ? null
        : {
            id: localUserMessageId,
            type: 'user',
            content: displayContent ?? query,
            timestamp: new Date(),
            ...(attachments.length > 0 && { attachments }),
            ...(selectionContexts && selectionContexts.length > 0 && { selectionContexts }),
            ...(parentMessageId && { parentId: parentMessageId }),
            ...(userTags && Object.keys(userTags).length > 0 && { userTags }),
            ...(displayContextForMessage && displayContextForMessage.length > 0
              ? { attachedContext: displayContextForMessage }
              : {}),
          };

      // Create bot message with streaming state
      const botMessageId = `bot-${Date.now()}`;
      const botMessage: Message = {
        id: botMessageId,
        // Stable render key — survives the id swap to the server id at
        // completion so the bubble updates in place (no remount) and the
        // activity block can animate its live→done transition.
        stableKey: botMessageId,
        type: 'bot',
        content: '',
        timestamp: new Date(),
        isStreaming: true,
        streamingContent: '',
        parsedContent: { summary: '', keypoints: [], citations: {}, isComplete: false },
        messageIdMapping: {},
        conversationIdMapping: {},
        channelIdMapping: {},
        statusMessage: 'Thinking',
        participants: [],
        parentId: localUserMessageId, // Bot is child of user message in tree
      };

      // Build initial messages list for stream manager
      const allMessages = userMessage
        ? [...currentMessages, userMessage, botMessage]
        : [...currentMessages, botMessage];

      // Start stream via the global stream manager
      // The stream manager will notify subscribers which will update messages with the streaming content
      const streamId = await xyneAIStreamManager.startStream(
        threadId,
        {
          query: internalQuery,
          displayQuery: displayContent ?? query,
          channelIds: eChannelIds,
          collectionIds: eCollectionIds,
          fileIds: eFileIds,
          folderIds: eFolderIds,
          conversationId,
          threadConversationId,
          attachmentIds,
          canvasId,
          webSearchEnabled: eWebSearchEnabled,
          deepResearchEnabled: eDeepResearchEnabled,
          createCanvasEnabled: eCreateCanvasEnabled,
          instant: eInstant,
          researchContext: eResearchContext,
          attachments,
          parentMessageId,
          isRegenerate,
          ...(isEditUserMessage ? { isEditUserMessage: true } : {}),
          ...(editedUserMessageId ? { editedUserMessageId } : {}),
          ...(parentAssistantMessageId ? { parentAssistantMessageId } : {}),
          localUserMessageId,
          ticketIds: eTicketIds,
          canvasIds: eCanvasIds,
          callIds: eCallIds,
          attachedContext: combinedAttachedContext,
          agentSlug: agentSlug ?? undefined,
          // v1 resolves its model from env and ignores the pin, so only send it
          // on v2 rather than letting a stale pick ride along invisibly.
          ...(isV2 && eModel ? { model: eModel } : {}),
          ...(isV2 && eModel && eModelProvider ? { modelProvider: eModelProvider } : {}),
          ...(eThinkingLevel ? { thinkingLevel: eThinkingLevel } : {}),
          ...(suppressCompletionToast && { suppressCompletionToast: true }),
          version: isV2 ? 'v2' : 'v1',
        },
        allMessages,
      );

      currentStreamIdRef.current = streamId;
    },
    [
      threadId,
      channelIds,
      collectionIds,
      conversationId,
      threadConversationId,
      attachmentIds,
      canvasId,
      fileIds,
      folderIds,
      researchContext,
      webSearchEnabled,
      deepResearchEnabled,
      createCanvasEnabled,
      instant,
      isV2,
      syncMessagesRef,
      ticketIds,
      canvasIds,
      callIds,
      attachedContext,
      displayAttachedContext,
      activities,
      streamSessionKey,
      agentSlug,
      model,
      modelProvider,
      thinkingLevel,
      suppressCompletionToast,
    ],
  );

  const abortCurrentRequest = useCallback(() => {
    // Use stream manager to abort - it will update messages
    xyneAIStreamManager.abortStreamByThread(threadId);
    const convId = conversationIdRef.current;
    if (convId) {
      const match = xyneAIStreamManager.findActiveStreamBySessionId(convId, agentSlug ?? 'ask-ai');
      if (match && match.threadId !== threadId) {
        xyneAIStreamManager.abortStream(match.streamId);
      }
    }
    currentStreamIdRef.current = null;
  }, [threadId, agentSlug]);

  return {
    submitQuery,
    abortCurrentRequest,
  };
};
