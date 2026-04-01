/**
 * Global Stream Manager for XyneAI
 * Manages streaming lifecycle outside of React components
 * Allows streams to persist across sidebar open/close cycles
 * Uses Web Worker for streaming to run on a separate thread
 */
import { BASE_URL } from '../clients/apiClient';
import { parsePartialSummarizerJSON } from '../../utils/partialJsonParser';
import {
  parseStreamingContent,
  transformToolOutput,
} from '../../components/Chat/XyneAISidebar/utils/XyneAIUtils';
import { generateToolInputStatus } from '../../components/Chat/XyneAISidebar/utils/toolInputStatus';
import type {
  Message,
  MessageAttachment,
  ReportArtifact,
} from '../../components/Chat/XyneAISidebar/utils/XyneAITypes';
import type { ToolOutput as GeniusToolOutput } from 'cosmic-ai-genius';
import type { ResearchContext } from '@xyne/shared';
import {
  xyneAIStreamStorage,
  type StreamRecord,
  type StreamStatus,
  type StreamChunk,
} from './XyneAIStreamStorage';
import { toast } from 'sonner';
import { xyneAIActor } from '../../machines/xyneAIMachine';
import XyneAIStreamWorker from './xyneAIStream.worker?worker';
import type { WorkerIncomingMessage, WorkerOutgoingMessage } from './xyneAIStream.worker';

export interface StreamState {
  streamId: string;
  threadId: string;
  sessionId: string;
  status: StreamStatus;
  messages: Message[];
  traceId?: string;
  error?: string;
}

export interface StreamRequest {
  query: string;
  channelIds: string[];
  canvasIds?: string[];
  ticketIds?: string[];
  callIds?: string[];
  conversationId: string;
  threadConversationId?: string | undefined;
  attachmentIds?: string[] | undefined;
  canvasViewAccessId?: string | null | undefined;
  webSearchEnabled: boolean;
  gmailSearchEnabled: boolean;
  researchContext?: ResearchContext | null | undefined;
  attachments: MessageAttachment[];
  parentMessageId?: string | undefined;
  isRegenerate?: boolean | undefined;
  localUserMessageId?: string | undefined;
}

type StreamSubscriber = (state: StreamState) => void;

// Helper function to clear status message from a message object
const clearStatusMessage = <T extends { statusMessage?: string | string[] }>(
  message: T,
): Omit<T, 'statusMessage'> => {
  const { statusMessage: _, ...rest } = message;
  return rest;
};

class XyneAIStreamManager {
  private static instance: XyneAIStreamManager;

  // Active stream tracking
  private activeStreams: Map<string, StreamState> = new Map();
  private abortControllers: Map<string, AbortController> = new Map();

  // Subscribers for state updates
  private subscribers: Set<StreamSubscriber> = new Set();

  // Track which threads have pending completion notifications
  private pendingCompletionNotifications: Set<string> = new Set();

  // Track if sidebar is open for notification logic
  private isSidebarOpen: boolean = false;

  // Web Worker instance
  private worker: Worker;

  // Map to track raw content, tool outputs, and local message IDs for each stream
  private streamDataMap: Map<
    string,
    { rawContent: string; toolOutputs: GeniusToolOutput[]; localUserMessageId?: string }
  > = new Map();

  private constructor() {
    // Initialize the Web Worker
    this.worker = new XyneAIStreamWorker();
    this.worker.addEventListener('message', this.handleWorkerMessage.bind(this));
    this.worker.addEventListener('error', this.handleWorkerError.bind(this));

    // Initialize by loading any persisted active streams
    void this.initializeFromStorage();

    // Cleanup old streams periodically
    setInterval(
      () => {
        void xyneAIStreamStorage.cleanupOldStreams();
      },
      15 * 60 * 1000,
    ); // Every 15 minutes
  }

  public static getInstance(): XyneAIStreamManager {
    if (!XyneAIStreamManager.instance) {
      XyneAIStreamManager.instance = new XyneAIStreamManager();
    }
    return XyneAIStreamManager.instance;
  }

  /**
   * Initialize from IndexedDB storage on startup
   * This only runs once when the app first loads, not on sidebar reopen
   */
  private async initializeFromStorage(): Promise<void> {
    try {
      const activeRecords = await xyneAIStreamStorage.getAllActiveStreams();

      for (const record of activeRecords) {
        // These are streams that were in progress when the browser/app was closed
        // Mark them as errored in IndexedDB only
        await xyneAIStreamStorage.errorStream(
          record.streamId,
          'Stream interrupted - application was closed',
        );

        // Note: We do NOT add these to activeStreams map or notify subscribers
        // The sidebar will load messages from xyneAIStorage (conversation history)
        // not from stream storage
      }
    } catch (error) {
      console.error('[XyneAIStreamManager] Failed to initialize from storage:', error);
    }
  }

  /**
   * Handle messages from the Web Worker
   */
  private handleWorkerMessage(event: MessageEvent<WorkerOutgoingMessage>): void {
    const { type, payload } = event.data;

    switch (type) {
      case 'STREAM_CHUNK':
        this.handleWorkerStreamChunk(payload.streamId, payload.data);
        break;

      case 'STREAM_COMPLETE':
        this.handleWorkerStreamComplete(payload.streamId);
        break;

      case 'STREAM_ERROR':
        this.handleWorkerStreamError(payload.streamId, payload.error);
        break;

      default:
        console.error('[XyneAIStreamManager] Unknown worker message type:', type);
    }
  }

  /**
   * Handle worker errors
   */
  private handleWorkerError(error: ErrorEvent): void {
    console.error('[XyneAIStreamManager] Worker error:', error);
  }

  /**
   * Handle stream chunk from worker
   */
  private handleWorkerStreamChunk(streamId: string, data: Record<string, unknown>): void {
    // Find the thread ID for this stream
    let threadId: string | undefined;
    let streamState: StreamState | undefined;

    for (const [tid, state] of this.activeStreams.entries()) {
      if (state.streamId === streamId) {
        threadId = tid;
        streamState = state;
        break;
      }
    }

    if (!threadId || !streamState) {
      console.error('[XyneAIStreamManager] Stream not found for chunk:', streamId);
      return;
    }

    // Get or initialize stream data
    let streamData = this.streamDataMap.get(streamId);
    if (!streamData) {
      streamData = { rawContent: '', toolOutputs: [] };
      this.streamDataMap.set(streamId, streamData);
    }

    // Find the streaming bot message (the last one with isStreaming: true)
    const messages = streamState.messages || [];
    const streamingBotMessage = [...messages]
      .reverse()
      .find(m => m.type === 'bot' && m.isStreaming);
    const botMessageId = streamingBotMessage?.id;

    if (!botMessageId) {
      console.error('[XyneAIStreamManager] No streaming bot message found for stream');
      return;
    }

    // Store chunk in IndexedDB
    const streamChunk: StreamChunk = {
      type: data['type'] as string,
      content: data['content'] as string | undefined,
      data,
      timestamp: Date.now(),
    };
    void xyneAIStreamStorage.appendChunk(streamId, streamChunk);

    // Process the event
    const result = this.processStreamEvent(
      data,
      botMessageId,
      streamData.rawContent,
      streamData.toolOutputs,
      streamId,
      threadId,
    );

    // Update rawContent if there's new content
    if (data['type'] === 'delta' || data['type'] === 'content') {
      if (data['content'] && typeof data['content'] === 'string') {
        streamData.rawContent += data['content'];
      }
    }

    // Update traceId if received
    if (result.traceId) {
      streamState.traceId = result.traceId;
    }
  }

  /**
   * Handle stream completion from worker
   */
  private handleWorkerStreamComplete(streamId: string): void {
    // Find the thread ID for this stream
    let threadId: string | undefined;

    for (const [tid, state] of this.activeStreams.entries()) {
      if (state.streamId === streamId) {
        threadId = tid;
        break;
      }
    }

    if (!threadId) {
      console.error('[XyneAIStreamManager] Stream not found for completion:', streamId);
      return;
    }

    const streamData = this.streamDataMap.get(streamId);
    const rawContent = streamData?.rawContent || '';

    this.completeStream(streamId, threadId, rawContent);

    // Cleanup stream data
    this.streamDataMap.delete(streamId);
  }

  /**
   * Handle stream error from worker
   */
  private handleWorkerStreamError(streamId: string, error: string): void {
    // Find the thread ID for this stream
    let threadId: string | undefined;
    let botMessageId: string | undefined;

    for (const [tid, state] of this.activeStreams.entries()) {
      if (state.streamId === streamId) {
        threadId = tid;
        // Find the streaming bot message
        const streamingBotMessage = [...state.messages]
          .reverse()
          .find(m => m.type === 'bot' && m.isStreaming);
        botMessageId = streamingBotMessage?.id;
        break;
      }
    }

    if (!threadId || !botMessageId) {
      console.error('[XyneAIStreamManager] Stream not found for error:', streamId);
      return;
    }

    this.errorStream(streamId, threadId, botMessageId, error);

    // Cleanup stream data
    this.streamDataMap.delete(streamId);
  }

  /**
   * Subscribe to stream state changes
   */
  public subscribe(callback: StreamSubscriber): () => void {
    this.subscribers.add(callback);
    return () => {
      this.subscribers.delete(callback);
    };
  }

  /**
   * Notify all subscribers of state change
   */
  private notifySubscribers(state: StreamState): void {
    for (const subscriber of this.subscribers) {
      try {
        subscriber(state);
      } catch (error) {
        console.error('[XyneAIStreamManager] Subscriber error:', error);
      }
    }
  }

  /**
   * Set sidebar open state (for notification logic)
   */
  public setSidebarOpen(isOpen: boolean): void {
    this.isSidebarOpen = isOpen;

    // Clear pending notifications for current thread when sidebar opens
    if (isOpen) {
      const snapshot = xyneAIActor.getSnapshot();
      const channelId = snapshot.context.channelId;
      const threadInfo = snapshot.context.threadInfo;

      if (channelId) {
        const threadId = threadInfo?.conversationId
          ? `${channelId}_${threadInfo.conversationId}`
          : channelId;
        this.pendingCompletionNotifications.delete(threadId);
      }
    }
  }

  /**
   * Get active stream for a thread
   */
  public getActiveStream(threadId: string): StreamState | null {
    return this.activeStreams.get(threadId) || null;
  }

  /**
   * Get all active streams
   */
  public getAllActiveStreams(): Map<string, StreamState> {
    return new Map(this.activeStreams);
  }

  /**
   * Get any active global stream (non-thread stream)
   * Returns the most recent active stream that is not a thread-specific stream
   */
  public getActiveGlobalStream(): StreamState | null {
    for (const [threadId, state] of this.activeStreams.entries()) {
      // Global streams have threadId that doesn't contain underscore (no thread suffix)
      // e.g., "channelId" vs "channelId_threadConversationId"
      if (!threadId.includes('_') && state.status === 'streaming') {
        return state;
      }
    }
    return null;
  }

  /**
   * Check if there's a pending completion notification for a thread
   */
  public hasPendingCompletion(threadId: string): boolean {
    return this.pendingCompletionNotifications.has(threadId);
  }

  /**
   * Clear pending completion notification
   */
  public clearPendingCompletion(threadId: string): void {
    this.pendingCompletionNotifications.delete(threadId);
  }

  /**
   * Start a new stream
   */
  public async startStream(
    threadId: string,
    request: StreamRequest,
    initialMessages: Message[],
  ): Promise<string> {
    const streamId = `stream-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

    // Abort any existing stream for this thread
    const existingStream = this.activeStreams.get(threadId);
    if (existingStream) {
      this.abortStream(existingStream.streamId);
    }

    // Create abort controller
    const abortController = new AbortController();
    this.abortControllers.set(streamId, abortController);

    // Initialize stream state
    const streamState: StreamState = {
      streamId,
      threadId,
      sessionId: request.conversationId,
      status: 'streaming',
      messages: initialMessages,
    };

    this.activeStreams.set(threadId, streamState);
    this.notifySubscribers(streamState);

    // Persist to IndexedDB
    await xyneAIStreamStorage.createStream(
      streamId,
      threadId,
      request.conversationId,
      request.query,
      request.channelIds,
      request.webSearchEnabled,
      request.gmailSearchEnabled,
      request.attachments,
      initialMessages,
    );

    // Start the actual streaming request
    void this.executeStream(streamId, threadId, request, abortController);

    return streamId;
  }

  /**
   * Execute the streaming request via Web Worker
   */
  private executeStream(
    streamId: string,
    _threadId: string,
    request: StreamRequest,
    _abortController: AbortController,
  ): void {
    // Initialize stream data
    this.streamDataMap.set(streamId, {
      rawContent: '',
      toolOutputs: [],
      ...(request.localUserMessageId && { localUserMessageId: request.localUserMessageId }),
    });

    // Send message to worker to start streaming
    const message: WorkerIncomingMessage = {
      type: 'START_STREAM',
      payload: {
        streamId,
        url: `${BASE_URL}/xyne-ai`,
        requestBody: {
          query: request.query,
          channelIds: request.channelIds,
          ...(request.canvasIds &&
            request.canvasIds.length > 0 && { canvasIds: request.canvasIds }),
          ...(request.ticketIds &&
            request.ticketIds.length > 0 && { ticketIds: request.ticketIds }),
          ...(request.callIds && request.callIds.length > 0 && { callIds: request.callIds }),
          conversationId: request.threadConversationId || '',
          sessionId: request.conversationId,
          webSearchEnabled: request.webSearchEnabled,
          gmailSearchEnabled: request.gmailSearchEnabled,
          researchContext: request.researchContext
            ? { type: request.researchContext.type, name: request.researchContext.name }
            : null,
          ...(request.canvasViewAccessId && { canvasViewAccessId: request.canvasViewAccessId }),
          ...(request.attachmentIds &&
            request.attachmentIds.length > 0 && { messageAttachmentIds: request.attachmentIds }),
          ...(request.attachments.length > 0 && {
            attachments: request.attachments.map(att => ({
              data: att.data,
              mimeType: att.mimeType,
              filename: att.filename,
            })),
          }),
          ...(request.parentMessageId && { parentMessageId: request.parentMessageId }),
          ...(request.isRegenerate && { isRegenerate: request.isRegenerate }),
        },
      },
    };

    this.worker.postMessage(message);

    // Note: The worker will handle the streaming and send messages back
    // which will be processed by handleWorkerMessage
  }

  /**
   * Process individual stream events
   */
  private processStreamEvent(
    data: Record<string, unknown>,
    botMessageId: string,
    rawContent: string,
    toolOutputs: GeniusToolOutput[],
    streamId: string,
    threadId: string,
  ): { sessionId?: string; traceId?: string } {
    const result: { sessionId?: string; traceId?: string } = {};
    const currentState = this.activeStreams.get(threadId);
    if (!currentState) return result;

    const updateMessages = (updater: (messages: Message[]) => Message[]): void => {
      currentState.messages = updater(currentState.messages);
      this.notifySubscribers({ ...currentState });
      void xyneAIStreamStorage.updateMessages(streamId, currentState.messages);
    };

    switch (data['type']) {
      case 'start':
        if (data['sessionId'] && typeof data['sessionId'] === 'string') {
          result.sessionId = data['sessionId'];
          currentState.sessionId = data['sessionId'];
        }
        if (data['traceId'] && typeof data['traceId'] === 'string') {
          result.traceId = data['traceId'];
          updateMessages(prev =>
            prev.map(msg =>
              msg.id === botMessageId && msg.type === 'bot'
                ? { ...msg, traceId: data['traceId'] as string }
                : msg,
            ),
          );
        }
        break;

      case 'delta':
      case 'content':
        if (data['content'] && typeof data['content'] === 'string') {
          updateMessages(prev =>
            prev.map(msg => {
              if (msg.id !== botMessageId) return msg;

              // Only clear status message once we have substantial content (30+ chars)
              const shouldClearStatus = rawContent.length > 30;

              // For Summarizer, parse partial JSON in real-time
              if (msg.agentType === 'summarizer') {
                const partialOutput = parsePartialSummarizerJSON(rawContent);
                if (partialOutput) {
                  if (shouldClearStatus) {
                    return {
                      ...clearStatusMessage(msg),
                      streamingContent: partialOutput.summary,
                      summarizerOutput: partialOutput,
                    };
                  }
                  return {
                    ...msg,
                    streamingContent: partialOutput.summary,
                    summarizerOutput: partialOutput,
                  };
                }
                if (shouldClearStatus) {
                  return {
                    ...clearStatusMessage(msg),
                    streamingContent: rawContent,
                  };
                }
                return {
                  ...msg,
                  streamingContent: rawContent,
                };
              }

              // For Genius, parse the streaming content
              const parsed = parseStreamingContent(rawContent);
              if (shouldClearStatus) {
                return {
                  ...clearStatusMessage(msg),
                  streamingContent: parsed.summary,
                  parsedContent: parsed,
                };
              }
              return {
                ...msg,
                streamingContent: parsed.summary,
                parsedContent: parsed,
              };
            }),
          );
        }
        break;

      case 'tool_input': {
        const toolName = (data['toolName'] || data['tool_name']) as string | undefined;
        const toolInput = data['input'];

        if (toolName) {
          const statusMessage = generateToolInputStatus(toolName, toolInput);

          updateMessages(prev =>
            prev.map(msg =>
              msg.id === botMessageId
                ? {
                    ...msg,
                    toolName,
                    toolInput,
                    statusMessage,
                    ...(toolName === 'fetch_channel_messages' && {
                      agentType: 'summarizer' as const,
                    }),
                  }
                : msg,
            ),
          );
        }
        break;
      }

      case 'tool_output':
        this.handleToolOutput(data, botMessageId, toolOutputs, updateMessages);
        break;

      case 'team_intelligence_report_ready':
        if (data['reportArtifact'] && typeof data['reportArtifact'] === 'object') {
          const reportArtifact = data['reportArtifact'] as ReportArtifact;
          updateMessages(prev =>
            prev.map(msg =>
              msg.id === botMessageId
                ? {
                    ...msg,
                    reportArtifact,
                  }
                : msg,
            ),
          );
        }
        break;

      case 'complete':
      case 'done':
        this.handleCompletionEvent(data, botMessageId, rawContent, toolOutputs, updateMessages);
        if (data['sessionId'] && typeof data['sessionId'] === 'string') {
          result.sessionId = data['sessionId'];
        }
        // Sync local message IDs with server-assigned IDs for branching tree
        {
          const streamData = this.streamDataMap.get(streamId);
          const localUserMessageId = streamData?.localUserMessageId;
          const serverUserMsgId = data['userMessageId'] as string | undefined;
          const serverBotMsgId = data['messageId'] as string | undefined;
          if (serverUserMsgId || serverBotMsgId) {
            updateMessages(prev =>
              prev.map(msg => {
                if (serverUserMsgId && localUserMessageId && msg.id === localUserMessageId) {
                  return { ...msg, id: serverUserMsgId };
                }
                if (serverBotMsgId && msg.id === botMessageId) {
                  return {
                    ...msg,
                    id: serverBotMsgId,
                    ...(serverUserMsgId && { parentId: serverUserMsgId }),
                  };
                }
                if (serverUserMsgId && localUserMessageId && msg.parentId === localUserMessageId) {
                  return { ...msg, parentId: serverUserMsgId };
                }
                return msg;
              }),
            );
          }
        }
        break;

      case 'error':
        console.error('[XyneAIStreamManager] Backend error:', data['error']);
        updateMessages(prev =>
          prev.map(msg =>
            msg.id === botMessageId
              ? {
                  ...msg,
                  content: 'Unexpected error occurred',
                  isStreaming: false,
                }
              : msg,
          ),
        );
        break;

      case 'agent_update':
        if (data['message'] && typeof data['message'] === 'string') {
          updateMessages(prev =>
            prev.map(msg =>
              msg.id === botMessageId
                ? {
                    ...msg,
                    statusMessage: 'Running JAF agent',
                  }
                : msg,
            ),
          );
        }
        break;

      case 'genius_start':
        if (data['toolName'] === 'genius') {
          updateMessages(prev =>
            prev.map(msg =>
              msg.id === botMessageId
                ? {
                    ...msg,
                    isGeniusResponse: true,
                  }
                : msg,
            ),
          );
        }
        break;
    }

    return result;
  }

  /**
   * Handle tool output events
   */
  private handleToolOutput(
    data: Record<string, unknown>,
    botMessageId: string,
    toolOutputs: GeniusToolOutput[],
    updateMessages: (updater: (messages: Message[]) => Message[]) => void,
  ): void {
    const toolName = (data['toolName'] || data['tool_name']) as string | undefined;

    if (toolName === 'fetch_channel_messages') {
      const content = data['content'] as string;
      updateMessages(prev =>
        prev.map(msg =>
          msg.id === botMessageId
            ? {
                ...msg,
                fetchedMessages: content,
                agentType: 'summarizer',
              }
            : msg,
        ),
      );
      return;
    }

    if (toolName === 'web_search') {
      const content = data['content'] as string;
      const webSearchToolOutput: GeniusToolOutput = {
        id: `tool-websearch-${Date.now()}-${Math.random()}`,
        toolName: 'web_search',
        content: content,
      } as GeniusToolOutput;

      toolOutputs.push(webSearchToolOutput);

      updateMessages(prev =>
        prev.map(msg =>
          msg.id === botMessageId
            ? {
                ...msg,
                toolOutputs: [...toolOutputs],
              }
            : msg,
        ),
      );
      return;
    }

    if (toolName) {
      const inputStr = data['input'] as string;
      const outputStr = data['output'] as string;

      let parsedInput: unknown = inputStr;
      let parsedOutput: unknown = outputStr;

      try {
        if (
          typeof inputStr === 'string' &&
          (inputStr.startsWith('{') || inputStr.startsWith('['))
        ) {
          parsedInput = JSON.parse(inputStr);
        }
      } catch (e) {
        console.warn('Failed to parse tool input:', e);
      }

      try {
        if (
          typeof outputStr === 'string' &&
          (outputStr.startsWith('{') || outputStr.startsWith('['))
        ) {
          parsedOutput = JSON.parse(outputStr);
        }
      } catch (e) {
        console.warn('Failed to parse tool output:', e);
      }

      const transformedData = transformToolOutput(toolName, parsedInput, parsedOutput);

      if (Object.keys(transformedData).length === 0) return;

      const newToolOutput: GeniusToolOutput = {
        id: `tool-${Date.now()}-${Math.random()}`,
        ...transformedData,
      } as GeniusToolOutput;

      toolOutputs.push(newToolOutput);

      updateMessages(prev =>
        prev.map(msg =>
          msg.id === botMessageId
            ? {
                ...msg,
                toolOutputs: [...toolOutputs],
                agentType: 'genius',
              }
            : msg,
        ),
      );
    } else if (data['toolOutput'] && typeof data['toolOutput'] === 'object') {
      const toolOutput = data['toolOutput'] as GeniusToolOutput;
      toolOutputs.push(toolOutput);

      updateMessages(prev =>
        prev.map(msg =>
          msg.id === botMessageId
            ? {
                ...msg,
                toolOutputs: [...toolOutputs],
              }
            : msg,
        ),
      );
    }
  }

  /**
   * Handle completion events
   */
  private handleCompletionEvent(
    data: Record<string, unknown>,
    botMessageId: string,
    rawContent: string,
    toolOutputs: GeniusToolOutput[],
    updateMessages: (updater: (messages: Message[]) => Message[]) => void,
  ): void {
    // Check if this is a Summarizer response
    if (data['output'] && typeof data['output'] === 'object') {
      const output = data['output'] as Record<string, unknown>;
      if ('keyPoints' in output && Array.isArray(output['keyPoints'])) {
        updateMessages(prev =>
          prev.map(msg => {
            if (msg.id !== botMessageId) return msg;
            const { traceId } = msg;
            const updatedMsg: Message = {
              ...msg,
              content: (output['summary'] as string) || '',
              summarizerOutput:
                output as unknown as import('../../components/Chat/XyneAISidebar/utils/XyneAITypes').SummarizerOutput,
              isStreaming: false,
              agentType: 'summarizer',
            };
            if (traceId) updatedMsg.traceId = traceId;
            return updatedMsg;
          }),
        );
        return;
      }
    }

    // Genius response
    const finalParsed = parseStreamingContent(rawContent);

    updateMessages(prev =>
      prev.map(msg => {
        if (msg.id !== botMessageId) return msg;
        const { traceId } = msg;
        const updatedMsg: Message = {
          ...msg,
          content: finalParsed.summary,
          isStreaming: false,
          streamingContent: finalParsed.summary,
          parsedContent: finalParsed,
          ...(!msg.agentType && { agentType: 'genius' as const }),
          ...(toolOutputs.length > 0 && { toolOutputs }),
        };
        if (traceId) updatedMsg.traceId = traceId;
        return updatedMsg;
      }),
    );
  }

  /**
   * Mark stream as completed
   */
  private completeStream(streamId: string, threadId: string, finalResponse: string): void {
    const currentState = this.activeStreams.get(threadId);
    if (!currentState) return;

    currentState.status = 'completed';
    this.notifySubscribers({ ...currentState });

    // Persist completion
    void xyneAIStreamStorage.completeStream(streamId, finalResponse);

    // Show toast notification if sidebar is closed
    if (!this.isSidebarOpen) {
      this.pendingCompletionNotifications.add(threadId);
      this.showCompletionToast(threadId, finalResponse);
    }

    // Cleanup after a delay
    setTimeout(() => {
      this.activeStreams.delete(threadId);
      this.abortControllers.delete(streamId);
    }, 5000);
  }

  /**
   * Mark stream as errored
   */
  private errorStream(
    streamId: string,
    threadId: string,
    botMessageId: string,
    error: string,
  ): void {
    const currentState = this.activeStreams.get(threadId);
    if (!currentState) return;

    currentState.status = 'error';
    currentState.error = error;

    // Update messages to show error
    currentState.messages = currentState.messages.map(msg =>
      msg.id === botMessageId
        ? {
            ...msg,
            content: 'Unexpected error occurred',
            isStreaming: false,
          }
        : msg,
    );

    this.notifySubscribers({ ...currentState });

    // Persist error
    void xyneAIStreamStorage.errorStream(streamId, error);

    // Cleanup
    this.activeStreams.delete(threadId);
    this.abortControllers.delete(streamId);
  }

  /**
   * Abort a stream
   */
  public abortStream(streamId: string): void {
    const abortController = this.abortControllers.get(streamId);
    if (abortController) {
      abortController.abort();
      this.abortControllers.delete(streamId);
    }

    // Send abort message to worker
    const message: WorkerIncomingMessage = {
      type: 'ABORT_STREAM',
      payload: { streamId },
    };
    this.worker.postMessage(message);

    // Find and update the stream state
    for (const [threadId, state] of this.activeStreams.entries()) {
      if (state.streamId === streamId) {
        state.status = 'aborted';

        // Update messages to show aborted state
        state.messages = state.messages.map(msg =>
          msg.isStreaming
            ? {
                ...msg,
                content: 'Query aborted by user.',
                isStreaming: false,
                isAborted: true,
                streamingContent: '',
              }
            : msg,
        );

        this.notifySubscribers({ ...state });

        // Persist abort
        void xyneAIStreamStorage.abortStream(streamId);

        // Cleanup
        this.activeStreams.delete(threadId);
        this.streamDataMap.delete(streamId);
        break;
      }
    }
  }

  /**
   * Abort stream by thread ID
   */
  public abortStreamByThread(threadId: string): void {
    const state = this.activeStreams.get(threadId);
    if (state) {
      this.abortStream(state.streamId);
    }
  }

  /**
   * Show toast notification for completed stream
   */
  private showCompletionToast(threadId: string, response: string): void {
    const preview = response.length > 100 ? response.substring(0, 100) + '...' : response;

    toast('XyneAI Response Ready', {
      description: preview,
      duration: 10000,
      action: {
        label: 'View',
        onClick: () => {
          // Open sidebar
          xyneAIActor.send({ type: 'OPEN' });
          this.clearPendingCompletion(threadId);
        },
      },
    });
  }

  /**
   * Load persisted stream data for a thread
   */
  public async loadPersistedStream(threadId: string): Promise<StreamRecord | null> {
    return xyneAIStreamStorage.getActiveStreamForThread(threadId);
  }
}

// Export singleton instance
export const xyneAIStreamManager = XyneAIStreamManager.getInstance();
