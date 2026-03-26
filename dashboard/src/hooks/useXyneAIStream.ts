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
  researchContext?: ResearchContext | null;
  createCanvasEnabled?: boolean;
  channelId?: string | undefined; // Added for thread ID construction
}

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
  researchContext,
  createCanvasEnabled = false,
  channelId,
}: UseXyneAIStreamParams) => {
  const currentStreamIdRef = useRef<string | null>(null);

  // Compute thread ID for stream manager
  const threadId = channelId
    ? threadConversationId
      ? `${channelId}_${threadConversationId}`
      : channelId
    : 'general';

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

      // Update session ID if changed
      if (state.sessionId && state.sessionId !== conversationId) {
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
  }, [
    threadId,
    threadConversationId,
    setMessages,
    setConversationId,
    setCurrentTraceId,
    conversationId,
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
    ): Promise<void> => {
      // Allow empty query if there are selection contexts
      if (!query.trim() && (!selectionContexts || selectionContexts.length === 0)) return;

      // Get current messages synchronously
      const currentMessages = await syncMessagesRef();

      // Add user message
      const userMessage: Message = {
        id: `user-${Date.now()}`,
        type: 'user',
        content: displayContent ?? query,
        timestamp: new Date(),
        ...(attachments.length > 0 && { attachments }),
        ...(selectionContexts && selectionContexts.length > 0 && { selectionContexts }),
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
      };

      const newMessages = [userMessage, botMessage];
      const allMessages = [...currentMessages, ...newMessages];

      // Start stream via the global stream manager
      // The stream manager will notify subscribers which will update messages with the streaming content
      const streamId = await xyneAIStreamManager.startStream(
        threadId,
        {
          query,
          channelIds,
          conversationId,
          threadConversationId,
          attachmentIds,
          canvasViewAccessId,
          webSearchEnabled,
          researchContext,
          attachments,
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
      createCanvasEnabled,
      syncMessagesRef,
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
