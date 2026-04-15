import { useCallback, useEffect, useRef } from 'react';
import type {
  Message,
  MessageAttachment,
  SelectionContext,
  UserTag,
} from '../components/Chat/XyneAISidebar/utils/XyneAITypes';
import type { ResearchContext } from '@xyne/shared';
import { xyneAIStreamManager, type StreamState } from '../services/XyneAI';

interface UseXyneAIStreamParams {
  channelIds: string[];
  conversationId: string;
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
  channelId?: string | undefined; // Added for thread ID construction
  ticketIds?: string[];
  canvasIds?: string[];
  callIds?: string[];
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
  channelId,
  ticketIds,
  canvasIds,
  callIds,
}: UseXyneAIStreamParams) => {
  const currentStreamIdRef = useRef<string | null>(null);

  // Compute thread ID for stream manager
  const threadId = channelId
    ? threadConversationId
      ? `${channelId}_${threadConversationId}`
      : channelId
    : 'general';

  // Track conversationId in a ref so subscription doesn't re-run when it changes
  const conversationIdRef = useRef(conversationId);
  conversationIdRef.current = conversationId;

  // Subscribe to stream manager updates
  // For global context (no threadConversationId), we listen to any non-thread stream
  useEffect(() => {
    const isGlobalContext = !threadConversationId;

    const unsubscribe = xyneAIStreamManager.subscribe((state: StreamState) => {
      if (isGlobalContext) {
        // Global context: accept updates from any non-thread stream
        // Non-thread streams have threadId without underscore
        if (state.threadId.includes('_')) return;
      } else {
        // Thread context: only accept updates for our specific thread
        if (state.threadId !== threadId) return;
      }

      // Update messages from stream state
      setMessages(state.messages);

      // Update session ID if changed (use ref to avoid stale closure)
      if (state.sessionId && state.sessionId !== conversationIdRef.current) {
        setConversationId(state.sessionId);
      }

      // Update trace ID if available
      if (state.traceId && setCurrentTraceId) {
        setCurrentTraceId(state.traceId);
      }
    });

    // Check for active stream on mount
    let activeStream;
    if (isGlobalContext) {
      // Global context: check for any active global stream
      activeStream = xyneAIStreamManager.getActiveGlobalStream();
    } else {
      // Thread context: check for thread-specific stream
      activeStream = xyneAIStreamManager.getActiveStream(threadId);
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
    }

    // Note: We do NOT abort on unmount - this is the key change!
    // The stream continues in the background via the stream manager
    return () => {
      unsubscribe();
    };
  }, [threadId, threadConversationId, setMessages, setConversationId, setCurrentTraceId]);

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

      // Append hidden canvas instruction when create canvas is enabled
      // This forces the LLM to create a canvas with the output at the end
      if (createCanvasEnabled) {
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
          researchContext,
          attachments,
          parentMessageId,
          isRegenerate,
          localUserMessageId,
          ticketIds,
          canvasIds,
          callIds,
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
      syncMessagesRef,
      ticketIds,
      canvasIds,
      callIds,
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
