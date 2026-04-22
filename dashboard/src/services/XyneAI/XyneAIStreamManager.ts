/**
 * Global Stream Manager for XyneAI
 * Manages streaming lifecycle outside of React components
 * Allows streams to persist across sidebar open/close cycles
 * Uses Web Worker for streaming to run on a separate thread
 */
import { BASE_URL } from '../clients/apiClient';
import { trackCitationsGenerated } from '../otel/xyneAIMetrics';
import { parsePartialSummarizerJSON } from '../../utils/partialJsonParser';
import {
  parseStreamingContent,
  transformToolOutput,
} from '../../components/Chat/XyneAISidebar/utils/XyneAIUtils';
import { generateToolInputStatus } from '../../components/Chat/XyneAISidebar/utils/toolInputStatus';
import type {
  Message,
  MessageAttachment,
  Participant,
  UserTag,
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
import { reactNativeBridge, NativeInboundMessageType } from '../../utils/reactNativeBridge';

export interface StreamState {
  streamId: string;
  threadId: string;
  sessionId: string;
  status: StreamStatus;
  messages: Message[];
  traceId?: string;
  error?: string;
  suppressCompletionToast?: boolean;
}

export interface StreamRequest {
  query: string;
  displayQuery?: string;
  channelIds: string[];
  canvasIds?: string[] | undefined;
  ticketIds?: string[] | undefined;
  callIds?: string[] | undefined;
  conversationId: string;
  threadConversationId?: string | undefined;
  attachmentIds?: string[] | undefined;
  canvasViewAccessId?: string | null | undefined;
  webSearchEnabled: boolean;
  deepResearchEnabled?: boolean;
  researchContext?: ResearchContext | null | undefined;
  attachments: MessageAttachment[];
  parentMessageId?: string | undefined;
  isRegenerate?: boolean | undefined;
  localUserMessageId?: string | undefined;
  suppressCompletionToast?: boolean | undefined;
  draftMode?: boolean | undefined;
}

type StreamSubscriber = (state: StreamState) => void;

// Helper function to clear status message from a message object
const clearStatusMessage = <T extends { statusMessage?: string | string[] }>(
  message: T,
): Omit<T, 'statusMessage'> => {
  const { statusMessage: _, ...rest } = message;
  return rest;
};

/**
 * Convert userTags to participants format
 * Transforms {tag: {name, userId}} to [{id, name, email, picture}]
 */
function convertUserTagsToParticipants(userTags?: Record<string, UserTag>): Participant[] {
  if (!userTags || Object.keys(userTags).length === 0) return [];

  return Object.values(userTags).map(userTag => ({
    id: userTag.userId,
    name: userTag.name,
    email: '', // Not available from userTags
    picture: '', // Will be handled by ParticipantsDropdown's getAvatarUrl helper
  }));
}

// Generic helper to extract a value from root level or nested in output object
function extractNestedValue<T>(data: Record<string, unknown>, key: string): T | undefined {
  return (data[key] ?? (data['output'] as Record<string, unknown> | undefined)?.[key]) as
    | T
    | undefined;
}

// Extract userTags from data (root level or nested in output)
const extractUserTags = (
  data: Record<string, unknown>,
): Record<string, { name: string; userId: string }> | undefined =>
  extractNestedValue<Record<string, { name: string; userId: string }>>(data, 'userTags');

// Extract participants from data (root level or nested in output)
const extractParticipants = (data: Record<string, unknown>): Participant[] | undefined => {
  const participants = extractNestedValue<unknown>(data, 'participants');
  return Array.isArray(participants) ? (participants as Participant[]) : undefined;
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

  // Streams that the worker is actively sending chunks for.
  // A stream is added on first STREAM_CHUNK and removed on STREAM_COMPLETE / STREAM_ERROR.
  // Used to detect silently-dropped connections after Android backgrounding.
  private workerActiveStreams: Set<string> = new Set();

  // Map to track raw content, tool outputs, and local message IDs for each stream
  private streamDataMap: Map<
    string,
    {
      rawContent: string;
      toolOutputs: GeniusToolOutput[];
      localUserMessageId?: string;
      participants: Participant[];
    }
  > = new Map();

  // rAF-based batching: accumulate delta content per stream and flush once per frame
  private pendingDeltaMap: Map<string, string> = new Map();
  private rafIdMap: Map<string, number> = new Map();

  private constructor() {
    // Initialize the Web Worker
    this.worker = new XyneAIStreamWorker();
    this.worker.addEventListener('message', this.handleWorkerMessage.bind(this));
    this.worker.addEventListener('error', this.handleWorkerError.bind(this));

    // Re-execute interrupted streams when the native app returns to foreground
    // (Android aborts fetch/SSE connections when the app goes to background)
    reactNativeBridge.on(NativeInboundMessageType.NATIVE_APP_FOREGROUND, () => {
      void this.handleAppForeground();
    });

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
   * Re-execute any streams that were interrupted when the app went to background.
   * The OS aborts fetch/SSE connections on Android when backgrounded, so we
   * restart the worker request for every stream still marked as 'streaming'.
   */
  private async handleAppForeground(): Promise<void> {
    for (const [threadId, state] of this.activeStreams.entries()) {
      if (state.status !== 'streaming') continue;

      // If the worker is still sending chunks for this stream, it survived backgrounding — skip.
      if (this.workerActiveStreams.has(state.streamId)) continue;

      const record = await xyneAIStreamStorage.getActiveStreamForThread(threadId);
      if (!record) continue;

      console.info(
        '[XyneAIStreamManager] App foregrounded — restarting interrupted stream',
        state.streamId,
      );

      // Reset the streaming bot message so it shows a reconnecting indicator
      state.messages = state.messages.map(msg =>
        msg.isStreaming ? { ...msg, streamingContent: '', statusMessage: 'Reconnecting…' } : msg,
      );
      this.notifySubscribers({ ...state });

      // Re-initialize stream data buffer
      this.streamDataMap.set(state.streamId, {
        rawContent: record.rawContent ?? '',
        toolOutputs: record.toolOutputs ?? [],
        participants: [],
      });

      // Re-send START_STREAM to worker with a fresh request
      const message: WorkerIncomingMessage = {
        type: 'START_STREAM',
        payload: {
          streamId: state.streamId,
          url: `${BASE_URL}/xyne-ai`,
          requestBody: {
            query: record.query,
            channelIds: record.channelIds,
            conversationId: record.sessionId,
            sessionId: record.sessionId,
            webSearchEnabled: record.webSearchEnabled,
            deepResearchEnabled: record.deepResearchEnabled ?? false,
            researchContext: null,
            ...(record.attachments.length > 0 && {
              attachments: record.attachments.map(att => ({
                data: att.data,
                mimeType: att.mimeType,
                filename: att.filename,
              })),
            }),
          },
        },
      };
      this.worker.postMessage(message);
    }
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
        // The sidebar will load messages from the backend (conversation history)
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
        this.workerActiveStreams.add(payload.streamId);
        this.handleWorkerStreamChunk(payload.streamId, payload.data);
        break;

      case 'STREAM_COMPLETE':
        this.workerActiveStreams.delete(payload.streamId);
        this.handleWorkerStreamComplete(payload.streamId);
        break;

      case 'STREAM_ERROR':
        this.workerActiveStreams.delete(payload.streamId);
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
   * Flush pending delta content for a stream (called via rAF)
   */
  private flushDeltaContent(streamId: string): void {
    this.rafIdMap.delete(streamId);

    const pendingDelta = this.pendingDeltaMap.get(streamId);
    if (!pendingDelta) return;
    this.pendingDeltaMap.delete(streamId);

    // Find thread and state
    let threadId: string | undefined;
    let streamState: StreamState | undefined;
    for (const [tid, state] of this.activeStreams.entries()) {
      if (state.streamId === streamId) {
        threadId = tid;
        streamState = state;
        break;
      }
    }
    if (!threadId || !streamState) return;

    const streamData = this.streamDataMap.get(streamId);
    if (!streamData) return;

    const botMessageId = [...streamState.messages]
      .reverse()
      .find(m => m.type === 'bot' && m.isStreaming)?.id;
    if (!botMessageId) return;

    // Accumulate into rawContent
    streamData.rawContent += pendingDelta;
    const currentRawContent = streamData.rawContent;

    const updateMessages = (updater: (messages: Message[]) => Message[]): void => {
      streamState.messages = updater(streamState.messages);
      this.notifySubscribers({ ...streamState });
      void xyneAIStreamStorage.updateMessages(streamId, streamState.messages);
    };

    updateMessages(prev =>
      prev.map(msg => {
        if (msg.id !== botMessageId) return msg;

        const shouldClearStatus = currentRawContent.length > 30;

        if (msg.agentType === 'summarizer') {
          const partialOutput = parsePartialSummarizerJSON(currentRawContent);
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
            return { ...clearStatusMessage(msg), streamingContent: currentRawContent };
          }
          return { ...msg, streamingContent: currentRawContent };
        }

        const parsed = parseStreamingContent(currentRawContent);
        if (shouldClearStatus) {
          return {
            ...clearStatusMessage(msg),
            streamingContent: parsed.summary,
            parsedContent: parsed,
          };
        }
        return { ...msg, streamingContent: parsed.summary, parsedContent: parsed };
      }),
    );
  }

  private scheduleDeltaFlush(streamId: string): void {
    if (!this.rafIdMap.has(streamId)) {
      const rafId = requestAnimationFrame(() => this.flushDeltaContent(streamId));
      this.rafIdMap.set(streamId, rafId);
    }
  }

  private flushDeltaContentSync(streamId: string): void {
    const rafId = this.rafIdMap.get(streamId);
    if (rafId !== undefined) {
      cancelAnimationFrame(rafId);
      this.rafIdMap.delete(streamId);
    }
    this.flushDeltaContent(streamId);
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
      streamData = { rawContent: '', toolOutputs: [], participants: [] };
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

    const eventType = data['type'];

    // For delta/content events, batch via rAF instead of immediate state update
    if (
      (eventType === 'delta' || eventType === 'content') &&
      data['content'] &&
      typeof data['content'] === 'string'
    ) {
      const pending = this.pendingDeltaMap.get(streamId) ?? '';
      this.pendingDeltaMap.set(streamId, pending + data['content']);
      this.scheduleDeltaFlush(streamId);
      return;
    }

    // Flush any pending delta before processing non-delta events
    // (tool_output, complete, etc. need up-to-date rawContent)
    if (this.pendingDeltaMap.has(streamId)) {
      this.flushDeltaContentSync(streamId);
    }

    // Process the event
    const result = this.processStreamEvent(
      data,
      botMessageId,
      streamData.rawContent,
      streamData.toolOutputs,
      streamId,
      threadId,
    );

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

    // Flush any remaining buffered delta content before completing
    if (this.pendingDeltaMap.has(streamId)) {
      this.flushDeltaContentSync(streamId);
    }

    const streamData = this.streamDataMap.get(streamId);
    const rawContent = streamData?.rawContent || '';

    this.completeStream(streamId, threadId, rawContent);

    // Cleanup stream data
    this.streamDataMap.delete(streamId);
    this.pendingDeltaMap.delete(streamId);
    const completionRafId = this.rafIdMap.get(streamId);
    if (completionRafId !== undefined) {
      cancelAnimationFrame(completionRafId);
      this.rafIdMap.delete(streamId);
    }
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

    // Flush any remaining buffered delta before erroring
    if (this.pendingDeltaMap.has(streamId)) {
      this.flushDeltaContentSync(streamId);
    }

    this.errorStream(streamId, threadId, botMessageId, error);

    // Cleanup stream data
    this.streamDataMap.delete(streamId);
    this.pendingDeltaMap.delete(streamId);
    const errorRafId = this.rafIdMap.get(streamId);
    if (errorRafId !== undefined) {
      cancelAnimationFrame(errorRafId);
      this.rafIdMap.delete(streamId);
    }
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

    // Handle any existing stream for this thread
    const existingStream = this.activeStreams.get(threadId);
    if (existingStream) {
      if (existingStream.status === 'completed') {
        // Silently clean up completed streams — don't abort (which would fire
        // subscriber notifications that clobber the new stream's React state)
        this.activeStreams.delete(threadId);
        this.abortControllers.delete(existingStream.streamId);
      } else {
        this.abortStream(existingStream.streamId);
      }
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
      ...(request.suppressCompletionToast && { suppressCompletionToast: true }),
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
      request.deepResearchEnabled ?? false,
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
      participants: [],
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
          ...(request.displayQuery && { displayQuery: request.displayQuery }),
          channelIds: request.channelIds,
          ...(request.canvasIds &&
            request.canvasIds.length > 0 && { canvasIds: request.canvasIds }),
          ...(request.ticketIds &&
            request.ticketIds.length > 0 && { ticketIds: request.ticketIds }),
          ...(request.callIds && request.callIds.length > 0 && { callIds: request.callIds }),
          conversationId: request.threadConversationId || '',
          sessionId: request.conversationId,
          webSearchEnabled: request.webSearchEnabled,
          deepResearchEnabled: request.deepResearchEnabled ?? false,
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
          ...(request.draftMode && { draftMode: true }),
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
        // Capture participants from start event
        if (data['participants'] && Array.isArray(data['participants'])) {
          const streamData = this.streamDataMap.get(streamId);
          if (streamData) {
            streamData.participants = data['participants'] as Participant[];
            updateMessages(prev =>
              prev.map(msg =>
                msg.id === botMessageId ? { ...msg, participants: streamData.participants } : msg,
              ),
            );
          }
        }
        break;

      case 'delta':
      case 'content':
        // Delta/content events are now batched via rAF in handleWorkerStreamChunk.
        // This case is kept for any edge cases where processStreamEvent is called
        // directly with delta events (should not happen in normal flow).
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

      case 'complete':
      case 'done':
        this.handleCompletionEvent(
          data,
          botMessageId,
          rawContent,
          toolOutputs,
          updateMessages,
          streamId,
        );
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
                    ...(serverUserMsgId && msg.parentId && { parentId: serverUserMsgId }),
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
    streamId?: string,
  ): void {
    // Extract userTags and participants from completion data
    const userTags = extractUserTags(data);
    const streamData = streamId ? this.streamDataMap.get(streamId) : undefined;

    // Determine participants: from completion data, userTags conversion, or stored from start event
    let participants = extractParticipants(data);
    if (!participants?.length && userTags && Object.keys(userTags).length > 0) {
      participants = convertUserTagsToParticipants(userTags);
    }
    if (!participants?.length && streamData?.participants?.length) {
      participants = streamData.participants;
    }

    // Check if this is a Summarizer response
    if (data['output'] && typeof data['output'] === 'object') {
      const output = data['output'] as Record<string, unknown>;
      if ('keyPoints' in output && Array.isArray(output['keyPoints'])) {
        const summarizerCitationCount = (output['keyPoints'] as Array<unknown>).filter(
          (kp): kp is Record<string, unknown> =>
            kp !== null &&
            typeof kp === 'object' &&
            'citation' in kp &&
            (kp as Record<string, unknown>)['citation'] !== null,
        ).length;
        if (summarizerCitationCount > 0) {
          trackCitationsGenerated('summarizer', summarizerCitationCount);
        }

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
              ...(userTags && { userTags }),
              ...(participants && participants.length > 0 && { participants }),
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
    const geniusCitationCount = Object.keys(finalParsed.citations ?? {}).length;
    if (geniusCitationCount > 0) {
      trackCitationsGenerated('genius', geniusCitationCount);
    }

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
          ...(userTags && { userTags }),
          ...(participants && participants.length > 0 && { participants }),
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
    if (!this.isSidebarOpen && !currentState.suppressCompletionToast) {
      this.pendingCompletionNotifications.add(threadId);
      this.showCompletionToast(threadId, finalResponse);
    }

    // Cleanup after a delay — only if this stream is still the active one for this thread
    // (a new stream may have replaced it under the same threadId key)
    setTimeout(() => {
      const current = this.activeStreams.get(threadId);
      if (current && current.streamId === streamId) {
        this.activeStreams.delete(threadId);
      }
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
        this.workerActiveStreams.delete(streamId);
        this.pendingDeltaMap.delete(streamId);
        const rafId = this.rafIdMap.get(streamId);
        if (rafId !== undefined) {
          cancelAnimationFrame(rafId);
          this.rafIdMap.delete(streamId);
        }
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
