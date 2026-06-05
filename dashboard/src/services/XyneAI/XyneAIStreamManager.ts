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
  DraftSource,
  SummarizerOutput,
} from '../../components/Chat/XyneAISidebar/utils/XyneAITypes';
import type { ToolOutput as GeniusToolOutput } from 'cosmic-ai-genius';
import type { ResearchContext } from '@xyne/shared';
import type { AttachedContextItem } from '../../components/Chat/XyneAISidebar/components/ContextPickerPanel';
import type { UserActivity } from '../../hooks/useUserActivity';
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
import { fetchV2ConversationMessages } from './XyneAISessionsV2Service';
import { getAskAIErrorInfo } from '../../utils/askAIErrorMapping';
import {
  deriveStreamSlotKey,
  getStreamSlotKeyFromThreadId,
} from '../../utils/xyneAIStreamThreadId';
import { ASK_AI_VERSION_STORAGE_KEY } from '../../hooks/useAskAIVersion';
import type { AskAIVersion } from '../../hooks/useAskAIVersion';

function getStoredVersion(): AskAIVersion {
  const stored = localStorage.getItem(ASK_AI_VERSION_STORAGE_KEY);
  if (stored === 'v1' || stored === 'v2') return stored;
  return 'v1';
}

export interface StreamState {
  streamId: string;
  threadId: string;
  /** Same as sidebar streamSessionKey — stable across migrateThreadId; use for subscriber routing */
  streamSlotKey: string;
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
  collectionIds?: string[];
  canvasIds?: string[] | undefined;
  ticketIds?: string[] | undefined;
  callIds?: string[] | undefined;
  attachedContext?: AttachedContextItem[] | undefined;
  activities?: UserActivity[] | undefined;
  conversationId: string;
  threadConversationId?: string | undefined;
  attachmentIds?: string[] | undefined;
  canvasViewAccessId?: string | null | undefined;
  webSearchEnabled: boolean;
  deepResearchEnabled?: boolean;
  createCanvasEnabled?: boolean;
  researchContext?: ResearchContext | null | undefined;
  attachments: MessageAttachment[];
  parentMessageId?: string | undefined;
  isRegenerate?: boolean | undefined;
  localUserMessageId?: string | undefined;
  suppressCompletionToast?: boolean | undefined;
  draftMode?: boolean | undefined;
  version?: 'v1' | 'v2' | undefined;
  disableTools?: boolean | undefined;
  agentSlug?: string | undefined;
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

// Parse width/height from data URL if it's an image
function parseAttachmentDimensions(data: string): { width?: number; height?: number } {
  // Data URLs don't contain dimension info directly, but we can check if it's an image
  // The dimensions will be set when the image is actually loaded/displayed
  if (data.startsWith('data:image/')) {
    // It's an image, but we can't get dimensions from the data URL string alone
    // The MessageItem component will handle dimension detection when rendering
    return {};
  }
  return {};
}

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

  /** Backend session id (or empty) for the conversation currently visible in the sidebar */
  private visibleConversationId: string | null = null;

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
            ...(record.version && { version: record.version }),
            ...(record.attachments.length > 0 && {
              attachments: record.attachments
                .filter(
                  (att): att is MessageAttachment & { data: string; filename: string } =>
                    !!att.data && !!att.filename,
                )
                .map(att => ({
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

    // Get the streamData reference for use in the functional update
    // This ensures we always read the latest rawContent value
    const currentStreamData = streamData;

    const updateMessages = (updater: (messages: Message[]) => Message[]): void => {
      streamState.messages = updater(streamState.messages);
      this.notifySubscribers({ ...streamState });
      void xyneAIStreamStorage.updateMessages(streamId, streamState.messages);
    };

    updateMessages(prev =>
      prev.map(msg => {
        if (msg.id !== botMessageId) return msg;

        // Read rawContent here to ensure we have the latest accumulated value
        const rawContent = currentStreamData.rawContent;
        const shouldClearStatus = rawContent.length > 30;

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
            return { ...clearStatusMessage(msg), streamingContent: rawContent };
          }
          return { ...msg, streamingContent: rawContent };
        }

        const parsed = parseStreamingContent(rawContent);
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

    if (isOpen && this.visibleConversationId) {
      this.pendingCompletionNotifications.delete(this.visibleConversationId);
    }
  }

  /**
   * Which conversation the user is viewing (for completion toasts when backgrounded or on another session).
   */
  public setVisibleConversationId(sessionId: string | null): void {
    this.visibleConversationId = sessionId && sessionId.length > 0 ? sessionId : null;
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
   * Debug / diagnostics: each streamId corresponds to one worker SSE request.
   */
  public getInFlightStreamSummaries(): ReadonlyArray<{
    streamId: string;
    streamSlotKey: string;
    sessionId: string;
    threadId: string;
    status: StreamStatus;
  }> {
    return Array.from(this.activeStreams.values()).map(s => ({
      streamId: s.streamId,
      streamSlotKey: s.streamSlotKey,
      sessionId: s.sessionId,
      threadId: s.threadId,
      status: s.status,
    }));
  }

  /**
   * Active stream whose server session id matches (e.g. after switching history while a draft-keyed stream received an id).
   */
  public findActiveStreamBySessionId(sessionId: string): StreamState | null {
    if (!sessionId) return null;
    for (const state of this.activeStreams.values()) {
      if (state.status !== 'streaming') continue;
      if (state.sessionId === sessionId || state.streamSlotKey === sessionId) {
        return state;
      }
    }
    return null;
  }

  /**
   * Session / slot keys that currently have a streaming response (for history row indicators).
   */
  public getStreamingSessionIds(): string[] {
    const ids = new Set<string>();
    for (const state of this.activeStreams.values()) {
      if (state.status !== 'streaming') continue;
      const sid = state.sessionId?.trim();
      if (sid) ids.add(sid);
      const slotKey = state.streamSlotKey?.trim();
      if (slotKey) ids.add(slotKey);
      const fromTid = getStreamSlotKeyFromThreadId(state.threadId);
      if (fromTid) ids.add(fromTid);
    }
    return Array.from(ids);
  }

  /**
   * Migrate active stream map + storage from one thread key to another (draft client key → server session key).
   */
  public migrateThreadId(oldThreadId: string, newThreadId: string): void {
    if (oldThreadId === newThreadId) return;
    const state = this.activeStreams.get(oldThreadId);
    if (!state) return;
    if (this.activeStreams.has(newThreadId)) return;

    this.activeStreams.delete(oldThreadId);
    state.threadId = newThreadId;
    state.streamSlotKey = deriveStreamSlotKey(newThreadId);
    this.activeStreams.set(newThreadId, state);
    this.notifySubscribers({ ...state });
    void xyneAIStreamStorage.updateStreamThreadId(state.streamId, newThreadId);
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

    request.version = getStoredVersion();

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

    const trimmedConv = request.conversationId?.trim() ?? '';
    const slotFromThread = getStreamSlotKeyFromThreadId(threadId) ?? '';
    const initialSessionId = trimmedConv || slotFromThread;

    // Initialize stream state
    const streamState: StreamState = {
      streamId,
      threadId,
      streamSlotKey: deriveStreamSlotKey(threadId),
      sessionId: initialSessionId,
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
      initialSessionId,
      request.query,
      request.channelIds,
      request.webSearchEnabled,
      request.deepResearchEnabled ?? false,
      request.attachments,
      initialMessages,
      request.version,
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
          ...(request.collectionIds &&
            request.collectionIds.length > 0 && { collectionIds: request.collectionIds }),
          ...(request.canvasIds &&
            request.canvasIds.length > 0 && { canvasIds: request.canvasIds }),
          ...(request.ticketIds &&
            request.ticketIds.length > 0 && { ticketIds: request.ticketIds }),
          ...(request.callIds && request.callIds.length > 0 && { callIds: request.callIds }),
          ...(request.attachedContext &&
            request.attachedContext.length > 0 && { attachedContext: request.attachedContext }),
          conversationId: request.threadConversationId || '',
          sessionId: request.conversationId,
          webSearchEnabled: request.webSearchEnabled,
          deepResearchEnabled: request.deepResearchEnabled ?? false,
          createCanvasEnabled: request.createCanvasEnabled ?? false,
          researchContext: request.researchContext
            ? request.researchContext.id
              ? {
                  type: request.researchContext.type,
                  id: request.researchContext.id,
                  name: request.researchContext.name,
                }
              : { type: request.researchContext.type, name: request.researchContext.name }
            : null,
          ...(request.canvasViewAccessId && { canvasViewAccessId: request.canvasViewAccessId }),
          ...(request.attachmentIds &&
            request.attachmentIds.length > 0 && { messageAttachmentIds: request.attachmentIds }),
          ...(request.attachments.length > 0 && {
            attachments: request.attachments
              .filter(
                (att): att is MessageAttachment & { data: string; filename: string } =>
                  !!att.data && !!att.filename,
              )
              .map(att => ({
                data: att.data,
                mimeType: att.mimeType,
                filename: att.filename,
              })),
          }),
          ...(request.parentMessageId && { parentMessageId: request.parentMessageId }),
          ...(request.isRegenerate && { isRegenerate: request.isRegenerate }),
          ...(request.draftMode && { draftMode: true }),
          ...(request.version && { version: request.version }),
          ...(request.disableTools && { disableTools: true }),
          ...(request.agentSlug && { agentSlug: request.agentSlug }),
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
          // Store sessionId on the bot message for later use (e.g., action approval)
          updateMessages(prev =>
            prev.map(msg =>
              msg.id === botMessageId && msg.type === 'bot'
                ? { ...msg, sessionId: data['sessionId'] as string }
                : msg,
            ),
          );
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

      // v2 events (xyne-claw integration)
      case 'reasoning_delta': {
        const reasoningDelta = data['reasoningDelta'] as string | undefined;
        if (reasoningDelta) {
          updateMessages(prev =>
            prev.map(msg =>
              msg.id === botMessageId
                ? { ...msg, reasoning: (msg.reasoning ?? '') + reasoningDelta }
                : msg,
            ),
          );
        }
        break;
      }

      case 'tool_invocation': {
        const toolInvocation = data['toolInvocation'] as
          | {
              toolName: string;
              toolCallId?: string;
              args: Record<string, unknown>;
              result?: string;
              status: 'running' | 'completed' | 'error';
              durationMs: number;
              isError?: boolean;
              subagentName?: string;
              parentToolCallId?: string;
              citations?: Array<{
                label?: string;
                kind: 'thread' | 'canvas' | 'ticket' | 'external';
                channelId?: string;
                conversationId?: string;
                channelName?: string;
                channelType?: string;
                viewAccessId?: string;
                ticketId?: string;
                url?: string;
              }>;
            }
          | undefined;

        if (toolInvocation) {
          updateMessages(prev =>
            prev.map(msg => {
              if (msg.id !== botMessageId) return msg;
              const existingInvocations = msg.toolInvocations ?? [];
              // Check if we already have this tool call (by toolCallId)
              const existingIndex = toolInvocation.toolCallId
                ? existingInvocations.findIndex(inv => inv.toolCallId === toolInvocation.toolCallId)
                : -1;

              let newInvocations;
              if (existingIndex >= 0) {
                // Update existing invocation
                newInvocations = existingInvocations.map((inv, idx) =>
                  idx === existingIndex ? { ...inv, ...toolInvocation } : inv,
                );
              } else {
                // Add new invocation
                newInvocations = [...existingInvocations, toolInvocation];
              }

              return { ...msg, toolInvocations: newInvocations };
            }),
          );
        }
        break;
      }

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

      case 'error': {
        const rawError = typeof data['error'] === 'string' ? data['error'] : undefined;
        const httpStatus =
          typeof data['httpStatus'] === 'number'
            ? data['httpStatus']
            : typeof data['statusCode'] === 'number'
              ? data['statusCode']
              : undefined;
        const errorInfo = getAskAIErrorInfo(rawError, httpStatus);
        updateMessages(prev =>
          prev.map(msg =>
            msg.id === botMessageId
              ? {
                  ...msg,
                  content:
                    typeof msg.streamingContent === 'string' &&
                    msg.streamingContent.trim().length > 0
                      ? msg.streamingContent
                      : errorInfo.message,
                  errorInfo,
                  isStreaming: false,
                  streamingContent: '',
                }
              : msg,
          ),
        );
        break;
      }

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
      const contentStr = data['content'] as string;

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

      // For create_ppt, data is in 'content' field, not 'output'
      if (toolName === 'create_ppt' && contentStr) {
        try {
          parsedOutput = JSON.parse(contentStr);
        } catch (e) {
          console.warn('Failed to parse create_ppt content:', e);
        }
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

    const outputObj = (data['output'] as Record<string, unknown> | undefined) ?? undefined;
    const rawSources = outputObj?.['sources'];
    const sources: DraftSource[] | undefined = Array.isArray(rawSources)
      ? (rawSources as DraftSource[])
      : undefined;

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
              summarizerOutput: output as unknown as SummarizerOutput,
              isStreaming: false,
              agentType: 'summarizer',
              ...(userTags && { userTags }),
              ...(participants && participants.length > 0 && { participants }),
              ...(sources && sources.length > 0 && { sources }),
            };
            if (traceId) updatedMsg.traceId = traceId;
            return updatedMsg;
          }),
        );
        return;
      }
    }

    // For v2 (claw) responses, the complete event includes the full authoritative
    // content from the agent. Prefer this over the accumulated rawContent from
    // streaming deltas, which can have partial/broken markdown that causes
    // rendering misalignment during streaming.
    const finalContent =
      typeof data['content'] === 'string' && data['content'].length > 0
        ? data['content']
        : rawContent;

    // Genius response
    const finalParsed = parseStreamingContent(finalContent);
    const geniusCitationCount = Object.keys(finalParsed.citations ?? {}).length;
    if (geniusCitationCount > 0) {
      trackCitationsGenerated('genius', geniusCitationCount);
    }

    // Extract pending actions from completion data (v2)
    const pendingActions = data['pendingActions'] as
      | Array<{
          id: string;
          serverType: string;
          tool: string;
          params: Record<string, unknown>;
          signature: string;
        }>
      | undefined;

    // Extract attachments from completion data (v2)
    const completionAttachments = data['attachments'] as
      | Array<{
          fileName: string;
          mimeType: string;
          data: string;
        }>
      | undefined;

    // Convert completion attachments to MessageAttachment format
    const messageAttachments: MessageAttachment[] | undefined = completionAttachments?.map(att => ({
      id: `temp-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      filename: att.fileName,
      mimeType: att.mimeType,
      data: att.data,
      // Parse dimensions if present in data URL or metadata
      ...parseAttachmentDimensions(att.data),
    }));

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
          ...(pendingActions && pendingActions.length > 0 && { pendingActions }),
          ...(messageAttachments &&
            messageAttachments.length > 0 && { attachments: messageAttachments }),
          ...(sources && sources.length > 0 && { sources }),
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

    // Re-fetch messages from backend to get authoritative final state
    // This fixes rendering misalignment issues caused by partial/broken markdown
    // during streaming deltas (similar to refreshRuns pattern in claw chat)
    void this.refreshMessagesFromBackend(streamId, threadId);

    const notifyKey = currentState.sessionId || currentState.streamSlotKey || threadId;
    const viewingThis = Boolean(
      notifyKey && this.visibleConversationId && notifyKey === this.visibleConversationId,
    );

    const shouldNotify =
      !currentState.suppressCompletionToast && (!this.isSidebarOpen || !viewingThis);

    if (shouldNotify) {
      this.pendingCompletionNotifications.add(notifyKey);
      this.showCompletionToast(notifyKey, finalResponse, currentState.sessionId || null);
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
   * Re-fetch conversation messages from backend after streaming completes.
   * This ensures the UI renders the authoritative final state rather than
   * potentially misaligned incremental deltas from streaming.
   */
  private async refreshMessagesFromBackend(streamId: string, threadId: string): Promise<void> {
    const currentState = this.activeStreams.get(threadId);
    if (!currentState) return;

    // Only refresh for v2 (claw-backed) streams that have a sessionId
    const conversationId = currentState.sessionId;
    if (!conversationId || !conversationId.startsWith('chat-')) {
      return;
    }

    try {
      const refreshedMessages = await fetchV2ConversationMessages(conversationId);

      // Merge refreshed messages with current state, preserving streaming state
      // and ensuring we don't overwrite messages that are still being processed
      this.mergeRefreshedMessages(streamId, threadId, refreshedMessages);
    } catch (error) {
      console.warn('[XyneAIStreamManager] Failed to refresh messages from backend:', error);
      // Don't throw - the stream already has the best-effort content from streaming
    }
  }

  /**
   * Merge refreshed messages from backend into the local stream state.
   * Preserves message IDs and relationships while updating content to authoritative version.
   */
  private mergeRefreshedMessages(
    streamId: string,
    threadId: string,
    refreshedMessages: Message[],
  ): void {
    const currentState = this.activeStreams.get(threadId);
    if (!currentState || currentState.streamId !== streamId) return;

    // Build a map of refreshed messages by ID for direct lookup
    const refreshedById = new Map(refreshedMessages.map(m => [m.id, m]));

    // Also build a positional index for v2 where server-assigned IDs
    // differ from local temp IDs (e.g., "bot-123" vs "cmoomcbi...")
    // Match by type + order within the conversation
    const localBotMsgs = currentState.messages.filter(m => m.type === 'bot' && !m.isStreaming);
    const refreshedBotMsgs = refreshedMessages.filter(m => m.type === 'bot');

    // Update local messages with refreshed content from backend
    const updatedMessages = currentState.messages.map(localMsg => {
      if (localMsg.type === 'bot' && !localMsg.isStreaming) {
        // First try direct ID match (works for v1 and v2 after ID sync)
        const refreshed = refreshedById.get(localMsg.id);

        // Fallback: match by positional index for v2 where IDs haven't synced yet
        let positionalFallback: Message | undefined;
        if (!refreshed) {
          const localBotIndex = localBotMsgs.indexOf(localMsg);
          if (localBotIndex >= 0 && localBotIndex < refreshedBotMsgs.length) {
            positionalFallback = refreshedBotMsgs[localBotIndex];
          }
        }

        const finalRefreshed = refreshed ?? positionalFallback;

        if (finalRefreshed) {
          // Preserve locally accumulated content which is more complete than
          // backend content during the async refresh window
          const localContent = localMsg.streamingContent || localMsg.content;
          const refreshedContent = finalRefreshed.content || finalRefreshed.streamingContent || '';

          // Use local content if backend content is empty/incomplete, otherwise prefer backend
          const finalContent =
            localContent.length >= refreshedContent.length ? localContent : refreshedContent;
          const finalStreamingContent =
            localContent.length >= refreshedContent.length
              ? localMsg.streamingContent
              : finalRefreshed.streamingContent || finalRefreshed.content;

          const mergedMsg: Message = {
            ...finalRefreshed,
            // Keep local traceId if it was set during streaming
            ...(localMsg.traceId && { traceId: localMsg.traceId }),
            // Preserve locally accumulated content over potentially incomplete backend content
            content: finalContent,
            streamingContent: finalStreamingContent || finalContent,
            // Keep the local ID to avoid breaking React keys and parent references
            id: localMsg.id,
          };
          return mergedMsg;
        }
      }
      return localMsg;
    });

    // Check if we have any user messages that need to be synced with server IDs
    // The backend assigns permanent IDs that we should adopt
    const localUserMsgs = currentState.messages.filter(m => m.type === 'user');
    for (const localUserMsg of localUserMsgs) {
      // Find matching user message in refreshed data
      const matchingRefreshed = refreshedMessages.find(
        rm => rm.type === 'user' && rm.content === localUserMsg.content,
      );
      if (matchingRefreshed && matchingRefreshed.id !== localUserMsg.id) {
        // Update the ID to match server
        const msgIndex = updatedMessages.findIndex(m => m.id === localUserMsg.id);
        if (msgIndex !== -1 && msgIndex < updatedMessages.length) {
          const targetMsg = updatedMessages[msgIndex];
          if (targetMsg) {
            updatedMessages[msgIndex] = {
              ...targetMsg,
              id: matchingRefreshed.id,
            };
            // Also update parent references pointing to this message
            for (let i = 0; i < updatedMessages.length; i++) {
              const msg = updatedMessages[i];
              if (msg && msg.parentId === localUserMsg.id) {
                updatedMessages[i] = { ...msg, parentId: matchingRefreshed.id };
              }
            }
          }
        }
      }
    }

    // Update state if changed
    if (JSON.stringify(updatedMessages) !== JSON.stringify(currentState.messages)) {
      currentState.messages = updatedMessages;
      this.notifySubscribers({ ...currentState });
      void xyneAIStreamStorage.updateMessages(streamId, updatedMessages);
    }
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

    const errorInfo = getAskAIErrorInfo(error);

    // Update messages to show error
    currentState.messages = currentState.messages.map(msg => {
      if (msg.id !== botMessageId) return msg;
      const sc = msg.streamingContent;
      const hasPartial = typeof sc === 'string' && sc.trim().length > 0;
      return {
        ...msg,
        content: hasPartial ? sc : errorInfo.message,
        errorInfo,
        isStreaming: false,
        streamingContent: '',
      };
    });

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
  private showCompletionToast(
    notifyKey: string,
    response: string,
    focusSessionId: string | null,
  ): void {
    const preview = response.length > 100 ? response.substring(0, 100) + '...' : response;

    toast('XyneAI Response Ready', {
      description: preview,
      duration: 10000,
      action: {
        label: 'View',
        onClick: () => {
          xyneAIActor.send({
            type: 'OPEN',
            ...(focusSessionId ? { focusSessionId } : {}),
          });
          this.clearPendingCompletion(notifyKey);
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
