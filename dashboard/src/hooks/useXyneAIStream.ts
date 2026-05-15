import { useCallback, useEffect, useRef } from 'react';
import type {
  Message,
  MessageAttachment,
  SelectionContext,
  UserTag,
} from '../components/Chat/XyneAISidebar/utils/XyneAITypes';
import type { ResearchContext } from '@xyne/shared';
import type { AttachedContextItem } from '../components/Chat/XyneAISidebar/components/ContextPickerPanel';
import type { UserActivity } from '../hooks/useUserActivity';
import { useAskAIVersion } from './useAskAIVersion';
import { xyneAIStreamManager, type StreamState } from '../services/XyneAI';
import { buildXyneAIStreamThreadId } from '../utils/xyneAIStreamThreadId';

interface UseXyneAIStreamParams {
  channelIds: string[];
  conversationId: string;
  /** Client draft UUID or server session id — must match active conversation slot */
  streamSessionKey: string;
  threadConversationId?: string | undefined;
  attachmentIds?: string[] | undefined; // Attachment IDs to fetch from GCS on backend
  canvasViewAccessId?: string | null;
  setMessages: React.Dispatch<React.SetStateAction<Message[]>>;
  setConversationId: React.Dispatch<React.SetStateAction<string>>;
  setCurrentTraceId?: React.Dispatch<React.SetStateAction<string | undefined>>;
  webSearchEnabled?: boolean;
  deepResearchEnabled?: boolean;
  researchContext?: ResearchContext | null;
  createCanvasEnabled?: boolean;
  isV2?: boolean;
  channelId?: string | undefined; // Added for thread ID construction
  ticketIds?: string[];
  canvasIds?: string[];
  callIds?: string[];
  attachedContext?: AttachedContextItem[];
  activities?: UserActivity[]; // User activities to include as context
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
  canvasViewAccessId,
  setMessages,
  setConversationId,
  setCurrentTraceId,
  webSearchEnabled = false,
  deepResearchEnabled = false,
  researchContext,
  createCanvasEnabled = false,
  isV2 = false,
  channelId,
  ticketIds,
  canvasIds,
  callIds,
  attachedContext,
  activities,
}: UseXyneAIStreamParams) => {
  const currentStreamIdRef = useRef<string | null>(null);

  // Get Ask AI version from user settings
  const { askAIVersion } = useAskAIVersion();

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

  // Subscribe by streamSlotKey (matches streamSessionKey). During draft→server migration,
  // React may still have the draft key in refs while the manager already updated streamSlotKey;
  // fall back to streamId (one POST == one streamId) so chunks are not dropped.
  useEffect(() => {
    const unsubscribe = xyneAIStreamManager.subscribe((state: StreamState) => {
      const slotRef = streamSessionKeyRef.current;
      const matchesSlot = state.streamSlotKey === slotRef;
      const matchesTrackedStream =
        currentStreamIdRef.current !== null && state.streamId === currentStreamIdRef.current;
      if (!matchesSlot && !matchesTrackedStream) return;

      setMessages(state.messages);

      if (state.sessionId && state.sessionId !== conversationIdRef.current) {
        setConversationId(state.sessionId);
      }

      if (state.traceId && setCurrentTraceId) {
        setCurrentTraceId(state.traceId);
      }
    });

    const builtThreadId = threadId;
    let activeStream = xyneAIStreamManager.getActiveStream(builtThreadId);
    if (!activeStream) {
      for (const s of xyneAIStreamManager.getAllActiveStreams().values()) {
        if (s.streamSlotKey === streamSessionKey && s.status === 'streaming') {
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
      currentStreamIdRef.current = activeStream.streamId;
    } else {
      currentStreamIdRef.current = null;
    }

    return () => {
      unsubscribe();
    };
  }, [threadId, streamSessionKey, setMessages, setConversationId, setCurrentTraceId]);

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
    ): Promise<void> => {
      // Allow empty query if there are selection contexts
      if (!query.trim() && (!selectionContexts || selectionContexts.length === 0)) return;

      // Build internal query with selection context format
      // Format: from canvas(canvas_view_access_id) ```selected_text```
      let internalQuery = query;
      if (selectionContexts && selectionContexts.length > 0) {
        const selectionFormatted = selectionContexts
          .map(
            ctx =>
              `\n\nfrom canvas(${ctx.canvasViewAccessId})\n\`\`\`\n${ctx.selectedText}\n\`\`\``,
          )
          .join('');
        internalQuery = query + selectionFormatted;
      }

      // Append canvas context hint for better accuracy when Ask AI is triggered from a canvas
      if (canvasViewAccessId) {
        const canvasContextHint = `\n\ncanvas view_access_id: ${canvasViewAccessId}`;
        internalQuery = internalQuery + canvasContextHint;
      }

      // Append hidden canvas instruction when create canvas is enabled (v1 only)
      // For v2, canvas creation is handled via additionalInstructions in the backend
      if (createCanvasEnabled && !isV2) {
        internalQuery = internalQuery + '\n\n' + CANVAS_CREATION_INSTRUCTION;
      }

      // Get current messages synchronously
      // Strip any still-streaming messages — they may not have been cleared yet if abortCurrentRequest
      // was called just before submitQuery (React batches the state update, so prev still shows them).
      const rawMessages = await syncMessagesRef();
      const currentMessages = rawMessages.map(msg =>
        msg.isStreaming
          ? {
              ...msg,
              isStreaming: false,
              isAborted: true,
              content: msg.content || 'Query aborted by user.',
            }
          : msg,
      );

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
          };

      // Create bot message with streaming state
      const botMessageId = `bot-${Date.now()}`;
      const botMessage: Message = {
        id: botMessageId,
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

      // Convert activities to attachedContext for v2 API
      const activityContext =
        activities && activities.length > 0 ? activitiesToAttachedContext(activities) : undefined;

      // Merge with existing attachedContext
      const combinedAttachedContext = activityContext
        ? [...(attachedContext ?? []), ...activityContext]
        : attachedContext;

      // Start stream via the global stream manager
      // The stream manager will notify subscribers which will update messages with the streaming content
      const streamId = await xyneAIStreamManager.startStream(
        threadId,
        {
          query: internalQuery,
          displayQuery: displayContent ?? query,
          channelIds,
          conversationId,
          threadConversationId,
          attachmentIds,
          canvasViewAccessId,
          webSearchEnabled,
          deepResearchEnabled,
          createCanvasEnabled,
          researchContext,
          attachments,
          parentMessageId,
          isRegenerate,
          localUserMessageId,
          ticketIds,
          canvasIds,
          callIds,
          attachedContext: combinedAttachedContext,
          version: askAIVersion,
        },
        allMessages,
      );

      currentStreamIdRef.current = streamId;
    },
    [
      threadId,
      channelIds,
      conversationId,
      threadConversationId,
      attachmentIds,
      canvasViewAccessId,
      researchContext,
      webSearchEnabled,
      deepResearchEnabled,
      createCanvasEnabled,
      isV2,
      syncMessagesRef,
      ticketIds,
      canvasIds,
      callIds,
      attachedContext,
      activities,
      askAIVersion,
      streamSessionKey,
    ],
  );

  const abortCurrentRequest = useCallback(() => {
    // Use stream manager to abort - it will update messages
    xyneAIStreamManager.abortStreamByThread(threadId);
    currentStreamIdRef.current = null;
  }, [threadId]);

  return {
    submitQuery,
    abortCurrentRequest,
  };
};
