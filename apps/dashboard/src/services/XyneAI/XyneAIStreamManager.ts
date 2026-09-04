import { logger, Event as LogEvent } from '../../utils/logger';
/**
 * Global Stream Manager for XyneAI
 * Manages streaming lifecycle outside of React components
 * Allows streams to persist across sidebar open/close cycles
 * Uses Web Worker for streaming to run on a separate thread
 */
import { apiInstance, BASE_URL } from '../clients/apiClient';
import { consumeConversationLiveStream } from './liveConversationStream';
import { trackCitationsGenerated } from '../otel/xyneAIMetrics';
import { parsePartialSummarizerJSON } from '../../utils/partialJsonParser';
import {
  parseStreamingContent,
  transformToolOutput,
  resolveActivePath,
} from '../../components/Chat/XyneAISidebar/utils/XyneAIUtils';
import { generateToolInputStatus } from '../../components/Chat/XyneAISidebar/utils/toolInputStatus';
import type {
  Message,
  MessageAttachment,
  Participant,
  UserTag,
  DraftSource,
  SummarizerOutput,
  DebugEventRecord,
  PendingActionResolution,
  ToolInvocation,
} from '../../components/Chat/XyneAISidebar/utils/XyneAITypes';
import type { ToolOutput as GeniusToolOutput } from '../../types/toolOutput';
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
import XyneAIStreamWorker from './xyneAIStream.worker?worker';
import type { WorkerIncomingMessage, WorkerOutgoingMessage } from './xyneAIStream.worker';
import { reactNativeBridge, NativeInboundMessageType } from '../../utils/reactNativeBridge';
import { fetchV2ConversationMessages } from './XyneAISessionsV2Service';
import { getAskAIErrorInfo } from '../../utils/askAIErrorMapping';
import {
  deriveStreamSlotKey,
  getStreamSlotKeyFromThreadId,
} from '../../utils/xyneAIStreamThreadId';
import { resolveMessagePendingAction } from '../../components/Claw/claw.utils';

// Prompt-only follow-ups run concurrently with the main answer and may finish
// after its SSE has closed. Keep reconciliation bounded but long enough to
// cover the generator's 60s timeout plus callback persistence latency.
const FOLLOW_UP_RETRY_DELAYS_MS = [500, 1_000, 2_000, 4_000, 8_000, 16_000, 32_000] as const;

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
  debugEvents: DebugEventRecord[];
  debugArtifactsReadyVersion: number;
  followUpsPending?: boolean;
  startedAt: number;
  version?: 'v1' | 'v2';
  agentSlug?: string;
  showInSidebar: boolean;
  /** Started from the full-screen /ai experience rather than the sidebar —
   *  decides where the completion toast's "View" button takes the user. */
  startedOnAIPage?: boolean;
}

/** Where a completion toast's "View" button should land the user. */
export interface CompletionToastTarget {
  sessionId: string;
  /** Stream began on the /ai page, so reopen it there instead of the sidebar. */
  fromAIPage: boolean;
}

export type CompletionToastNavigator = (target: CompletionToastTarget) => void;

export interface StreamRequest {
  query: string;
  displayQuery?: string;
  channelIds: string[];
  collectionIds?: string[];
  fileIds?: string[];
  /** Folder scopes from the composer picker. Sent to claw-auth as a single
   *  'folder' attached_context pointer per id — xyneAIControllerV2.ts does
   *  NOT expand this to a recursive file list; claw-auth resolves it itself,
   *  at Vespa-query time. */
  folderIds?: string[];
  canvasIds?: string[] | undefined;
  ticketIds?: string[] | undefined;
  callIds?: string[] | undefined;
  attachedContext?: AttachedContextItem[] | undefined;
  activities?: UserActivity[] | undefined;
  conversationId: string;
  threadConversationId?: string | undefined;
  attachmentIds?: string[] | undefined;
  canvasId?: string | null | undefined;
  webSearchEnabled: boolean;
  deepResearchEnabled?: boolean;
  createCanvasEnabled?: boolean;
  /** Single search + single answer pass instead of the full agentic tool
   *  loop — see xyne-claw-auth's run-stream.ts POST / instant branch. */
  instant?: boolean;
  /** Per-run thinking level (composer dropdown). Absent = agent default. */
  thinkingLevel?: 'off' | 'minimal' | 'low' | 'medium' | 'high';
  researchContext?: ResearchContext | null | undefined;
  attachments: MessageAttachment[];
  parentMessageId?: string | undefined;
  isRegenerate?: boolean | undefined;
  /** Branching: edit-user signals that the new user message is a sibling of
   *  `editedUserMessageId` under `parentAssistantMessageId`. claw-auth uses
   *  these to clone the PI session BEFORE the edited user msg so the LLM
   *  session reflects the new branch instead of continuing linearly. */
  isEditUserMessage?: boolean | undefined;
  editedUserMessageId?: string | undefined;
  parentAssistantMessageId?: string | undefined;
  localUserMessageId?: string | undefined;
  suppressCompletionToast?: boolean | undefined;
  draftMode?: boolean | undefined;
  version?: 'v1' | 'v2' | undefined;
  disableTools?: boolean | undefined;
  agentSlug?: string | undefined;
  /** Per-run model pin from the composer's model picker. Undefined = the
   *  agent's own default. Only meaningful on v2 (v1 resolves its model from
   *  env and ignores the field). */
  model?: string | undefined;
  /** Which provider the model pin rides ("litellm" = the agent's own
   *  credential, "spaces" = the platform allowed list). Only meaningful
   *  alongside `model`. */
  modelProvider?: 'litellm' | 'spaces';
  showInSidebar?: boolean | undefined;
}

type StreamSubscriber = (state: StreamState) => void;

const deserializeWorkerError = (
  value: Extract<WorkerOutgoingMessage, { type: 'WORKER_LOG_ERROR' }>['payload']['error'],
): Error => {
  const error = new Error(value.message);
  error.name = value.name;
  if (value.stack) error.stack = value.stack;
  return error;
};

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

/** Single-line, length-capped text for a toast title or description. */
function truncateForToast(text: string, max: number): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length > max ? `${flat.slice(0, max).trimEnd()}…` : flat;
}

class XyneAIStreamManager {
  private static instance: XyneAIStreamManager;

  /** Max number of sidebar chats allowed to stream concurrently. */
  private static readonly MAX_CONCURRENT_SIDEBAR_STREAMS = 3;

  // Active stream tracking
  private activeStreams: Map<string, StreamState> = new Map();
  private abortControllers: Map<string, AbortController> = new Map();

  // Subscribers for state updates
  private subscribers: Set<StreamSubscriber> = new Set();

  // Track which threads have pending completion notifications
  private pendingCompletionNotifications: Set<string> = new Set();

  // Track if sidebar is open for notification logic
  private isSidebarOpen: boolean = false;

  private isClawOverlayOpen: boolean = false;

  private hasClawOverlay: boolean = false;

  /** Whether the user is currently viewing the /ai page */
  private isOnAIPage: boolean = false;

  /** Which conversation the user is currently viewing (drives completion-toast targeting) */
  private visibleConversationId: string | null = null;

  /** Router-aware handler registered by AppRoot for the toast's "View" button */
  private completionToastNavigator: CompletionToastNavigator | null = null;

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

  // streamIds of live viewers whose SSE connection is CURRENTLY open. Lets the
  // attach guard tell a live viewer apart from a dead viewer's leftover state
  // (which must be replaceable, not adopted — else a return visit freezes).
  private liveViewerStreams: Set<string> = new Set();

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

      logger.info(LogEvent.INFO, {
        type: 'migrated_console_info',
        message: String('[XyneAIStreamManager] App foregrounded — restarting interrupted stream'),
        context: [state.streamId],
      });

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
      logger.error(LogEvent.FRONTEND_ERROR, {
        type: 'migrated_console_error',
        message: String('[XyneAIStreamManager] Failed to initialize from storage:'),
        error: error,
      });
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

      case 'WORKER_LOG_ERROR':
        logger.error(LogEvent.FRONTEND_ERROR, {
          type: 'migrated_console_error',
          message: payload.message,
          error: deserializeWorkerError(payload.error),
        });
        break;

      default:
        logger.error(LogEvent.FRONTEND_ERROR, {
          type: 'migrated_console_error',
          message: String('[XyneAIStreamManager] Unknown worker message type:'),
          error: type,
        });
    }
  }

  /**
   * Handle worker errors
   */
  private handleWorkerError(error: ErrorEvent): void {
    logger.error(LogEvent.FRONTEND_ERROR, {
      type: 'migrated_console_error',
      message: String('[XyneAIStreamManager] Worker error:'),
      error: error,
    });
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
      logger.error(LogEvent.FRONTEND_ERROR, {
        type: 'migrated_console_error',
        message: String('[XyneAIStreamManager] Stream not found for chunk:'),
        error: streamId,
      });
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
      logger.error(LogEvent.FRONTEND_ERROR, {
        type: 'migrated_console_error',
        message: String('[XyneAIStreamManager] No streaming bot message found for stream'),
      });
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
      logger.error(LogEvent.FRONTEND_ERROR, {
        type: 'migrated_console_error',
        message: String('[XyneAIStreamManager] Stream not found for completion:'),
        error: streamId,
      });
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
      logger.error(LogEvent.FRONTEND_ERROR, {
        type: 'migrated_console_error',
        message: String('[XyneAIStreamManager] Stream not found for error:'),
        error: streamId,
      });
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
        logger.error(LogEvent.FRONTEND_ERROR, {
          type: 'migrated_console_error',
          message: String('[XyneAIStreamManager] Subscriber error:'),
          error: error,
        });
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

  public setClawOverlayOpen(isOpen: boolean): void {
    this.isClawOverlayOpen = isOpen;
  }

  public setHasClawOverlay(hasClawOverlay: boolean): void {
    this.hasClawOverlay = hasClawOverlay;
  }

  /**
   * Set whether the user is currently on the /ai page
   */
  public setOnAIPage(isOnAIPage: boolean): void {
    this.isOnAIPage = isOnAIPage;
  }

  /**
   * Register the handler the completion toast's "View" button calls. Lives in
   * the router tree (AppRoot) since this manager has no navigation of its own.
   */
  public setCompletionToastNavigator(navigator: CompletionToastNavigator | null): void {
    this.completionToastNavigator = navigator;
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
   * Patch the persisted 👍/👎 (+ comment) for a single message across any cached
   * stream that holds it, keeping the in-memory + IndexedDB copies in sync with
   * a rating the user just submitted. Without this, switching away and back
   * WITHIN the stream TTL adopts the pre-rating snapshot from `activeStreams`
   * and the thumb shows unlit (a full reload works because it refetches from the
   * server). A message id is unique to one stream, so we stop after the match.
   * No-op when the message isn't in any cached stream.
   */
  public patchMessageFeedback(
    messageId: string,
    feedback: 0 | 1 | 2,
    ratingComment?: string | null,
  ): void {
    for (const state of this.activeStreams.values()) {
      const idx = state.messages.findIndex(m => m.id === messageId);
      if (idx < 0) continue;
      const existing = state.messages[idx]!;
      const updated: Message = { ...existing, feedback, ratingComment: ratingComment ?? null };
      state.messages = [...state.messages.slice(0, idx), updated, ...state.messages.slice(idx + 1)];
      this.notifySubscribers({ ...state });
      void xyneAIStreamStorage.updateMessages(state.streamId, state.messages);
      return;
    }
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
  public findActiveStreamBySessionId(sessionId: string, agentSlug?: string): StreamState | null {
    if (!sessionId) return null;
    const expectedAgentSlug = agentSlug ?? null;
    // Match by sessionId or slot key, regardless of status. The TTL on
    // activeStreams (set in completeStream) is now 5 minutes, so completed
    // streams within that window are intentionally retained for switch-back.
    // Restricting to status==='streaming' here was hiding those completed
    // streams from handleLoadConversation's live-state adoption path, forcing
    // a stale server fetch instead of using the in-memory rendered messages.
    // Prefer a streaming match if both a streaming and a completed match
    // exist (rare; happens during regenerate-and-switch races).
    let completed: StreamState | null = null;
    for (const state of this.activeStreams.values()) {
      if (state.sessionId !== sessionId && state.streamSlotKey !== sessionId) continue;
      if (expectedAgentSlug && (state.agentSlug ?? 'ask-ai') !== expectedAgentSlug) continue;
      if (state.status === 'streaming') return state;
      if (!completed) completed = state;
    }
    return completed;
  }

  public resolvePendingAction(
    messageId: string,
    actionIndex: number,
    resolution: PendingActionResolution,
  ): void {
    for (const state of this.activeStreams.values()) {
      const messages = resolveMessagePendingAction(
        state.messages,
        messageId,
        actionIndex,
        resolution,
      );
      if (messages === state.messages) continue;
      state.messages = messages;
      this.notifySubscribers({ ...state });
      void xyneAIStreamStorage.updateMessages(state.streamId, messages);
      return;
    }
  }

  /**
   * Session / slot keys that currently have a streaming response (for history row indicators).
   */
  public hasStreamingSidebarStreams(): boolean {
    return this.findLatestSidebarStream() !== null;
  }

  public findLatestSidebarStream(): StreamState | null {
    let latest: StreamState | null = null;
    for (const state of this.activeStreams.values()) {
      if (state.status !== 'streaming' || !state.showInSidebar) continue;
      if (!latest || state.startedAt > latest.startedAt) {
        latest = state;
      }
    }
    return latest;
  }

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

    request.version = 'v2';

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

    if (request.showInSidebar ?? true) {
      const streamingSidebar = Array.from(this.activeStreams.values())
        .filter(s => s.status === 'streaming' && s.showInSidebar && s.threadId !== threadId)
        .sort((a, b) => a.startedAt - b.startedAt);
      while (streamingSidebar.length >= XyneAIStreamManager.MAX_CONCURRENT_SIDEBAR_STREAMS) {
        const oldest = streamingSidebar.shift();
        if (oldest) this.abortStream(oldest.streamId);
      }
    }

    // Create abort controller
    const abortController = new AbortController();
    this.abortControllers.set(streamId, abortController);

    const trimmedConv = request.conversationId?.trim() ?? '';
    const slotFromThread = getStreamSlotKeyFromThreadId(threadId) ?? '';
    const initialSessionId = trimmedConv || slotFromThread;

    // Initialize stream state. Debug events arrive from the server over SSE.
    const streamState: StreamState = {
      streamId,
      threadId,
      streamSlotKey: deriveStreamSlotKey(threadId),
      sessionId: initialSessionId,
      status: 'streaming',
      messages: initialMessages,
      debugEvents: [],
      debugArtifactsReadyVersion: 0,
      startedAt: Date.now(),
      showInSidebar: request.showInSidebar ?? true,
      startedOnAIPage: this.isOnAIPage,
      ...(request.version && { version: request.version }),
      ...(request.agentSlug && { agentSlug: request.agentSlug }),
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
          ...(request.fileIds && request.fileIds.length > 0 && { fileIds: request.fileIds }),
          ...(request.folderIds &&
            request.folderIds.length > 0 && { folderIds: request.folderIds }),
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
          instant: request.instant ?? false,
          ...(request.thinkingLevel ? { thinkingLevel: request.thinkingLevel } : {}),
          researchContext: request.researchContext
            ? request.researchContext.id
              ? {
                  type: request.researchContext.type,
                  id: request.researchContext.id,
                  name: request.researchContext.name,
                }
              : { type: request.researchContext.type, name: request.researchContext.name }
            : null,
          ...(request.canvasId && { canvasId: request.canvasId }),
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
          ...(request.isEditUserMessage && { isEditUserMessage: request.isEditUserMessage }),
          ...(request.editedUserMessageId && { editedUserMessageId: request.editedUserMessageId }),
          ...(request.parentAssistantMessageId && {
            parentAssistantMessageId: request.parentAssistantMessageId,
          }),
          ...(request.draftMode && { draftMode: true }),
          ...(request.version && { version: request.version }),
          ...(request.disableTools && { disableTools: true }),
          ...(request.agentSlug && { agentSlug: request.agentSlug }),
          ...(request.model && { model: request.model }),
          ...(request.model && request.modelProvider && { modelProvider: request.modelProvider }),
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
          const newSessionId = data['sessionId'];
          result.sessionId = newSessionId;
          currentState.sessionId = newSessionId;
          // CRITICAL: also promote the streamSlotKey to the server-issued
          // sessionId if we're currently still on a draft key. Without this,
          // every notification the manager sends carries
          // `streamSlotKey = "draft-..."` while the conversation it now
          // belongs to is listening for the real sessionId — so switching
          // away mid-stream and switching back drops every subsequent chunk
          // at the subscriber filter (useXyneAIStream.ts). The sidebar's
          // migrate-effect only runs after streaming finishes, which is too
          // late to recover the in-flight events.
          //
          // Only promote when the current slot key looks like a draft (so we
          // don't clobber a real key that's already correct). Draft keys are
          // produced by newStreamSlotKey() / `draft-...` prefix; anything
          // matching the new sessionId is already aligned.
          const looksLikeDraft =
            !currentState.streamSlotKey ||
            currentState.streamSlotKey.startsWith('draft-') ||
            currentState.streamSlotKey !== newSessionId;
          if (looksLikeDraft && currentState.streamSlotKey !== newSessionId) {
            currentState.streamSlotKey = newSessionId;
          }
          // Store sessionId on the bot message for later use (e.g., action approval)
          updateMessages(prev =>
            prev.map(msg =>
              msg.id === botMessageId && msg.type === 'bot'
                ? { ...msg, sessionId: newSessionId }
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
                canvasId?: string;
                ticketId?: string;
                url?: string;
              }>;
              // Background (run_in_background) subagent lifecycle — see ToolInvocation.
              background?: boolean;
              backgroundState?: 'running' | 'completed' | 'error';
              backgroundTaskId?: string;
            }
          | undefined;

        const isInternalFollowUp =
          toolInvocation?.toolName === 'internal-follow-up-diagnostics' ||
          (toolInvocation?.toolName === 'ask-user-question' &&
            toolInvocation.args?.['purpose'] === 'follow_up_suggestions');

        if (toolInvocation && !isInternalFollowUp) {
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

      case 'debug_event': {
        const debugEvent = data['debugEvent'] as DebugEventRecord | undefined;
        if (debugEvent) {
          currentState.debugEvents = [...currentState.debugEvents, debugEvent];
          this.notifySubscribers({ ...currentState });
        }
        break;
      }

      case 'debug_artifacts_ready':
        currentState.debugArtifactsReadyVersion += 1;
        this.notifySubscribers({ ...currentState });
        break;

      case 'complete':
      case 'done':
        currentState.followUpsPending = data['followUpsPending'] === true;
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

        // Mark stream as errored so completeStream doesn't overwrite it
        currentState.status = 'error';

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
        logger.warn(LogEvent.FRONTEND_ERROR, {
          type: 'migrated_console_warn',
          message: String('Failed to parse tool input:'),
          context: [e],
        });
      }

      try {
        if (
          typeof outputStr === 'string' &&
          (outputStr.startsWith('{') || outputStr.startsWith('['))
        ) {
          parsedOutput = JSON.parse(outputStr);
        }
      } catch (e) {
        logger.warn(LogEvent.FRONTEND_ERROR, {
          type: 'migrated_console_warn',
          message: String('Failed to parse tool output:'),
          context: [e],
        });
      }

      // For create_ppt, data is in 'content' field, not 'output'
      if (toolName === 'create_ppt' && contentStr) {
        try {
          parsedOutput = JSON.parse(contentStr);
        } catch (e) {
          logger.warn(LogEvent.FRONTEND_ERROR, {
            type: 'migrated_console_warn',
            message: String('Failed to parse create_ppt content:'),
            context: [e],
          });
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

    const followUpSuggestions = Array.isArray(data['followUpSuggestions'])
      ? data['followUpSuggestions'].filter(
          (suggestion): suggestion is string =>
            typeof suggestion === 'string' && suggestion.trim().length > 0,
        )
      : undefined;
    // Extract attachments from completion data (v2)
    const completionAttachments = data['attachments'] as
      | Array<{
          fileName: string;
          mimeType: string;
          data: string;
          metadata?: MessageAttachment['metadata'];
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
      // Tool-generated metadata (e.g. the React-artifact manifest). On this live
      // path the id is a placeholder and the bytes are inline in `data`; after a
      // reload it is the reverse — a real attachment id and no bytes. Consumers
      // must handle both.
      ...(att.metadata ? { metadata: att.metadata } : {}),
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
          ...(followUpSuggestions && followUpSuggestions.length > 0 && { followUpSuggestions }),
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

    // Foreground recovery can race the worker's first chunk and start a second
    // request for the same stream. Only the first terminal event may complete it.
    if (currentState.status === 'completed' || currentState.status === 'error') {
      return;
    }

    currentState.status = 'completed';
    // Clear isStreaming on the bot message itself. The per-chunk handler also
    // does this but ONLY runs while a subscriber is alive; if the user
    // switched conversations mid-stream, that subscriber unhooked and the bot
    // message in currentState.messages still has isStreaming=true. When the
    // user switches back, handleLoadConversation reads currentState and
    // renders a permanently-spinning bot. Fix it at the source: the stream is
    // done, mark every still-streaming message done. Use streamingContent as
    // the final content when content is empty (matches the chunk handler).
    currentState.messages = currentState.messages.map(m => {
      if (!m.isStreaming) return m;
      const finalContent =
        m.content && m.content.length > 0
          ? m.content
          : typeof m.streamingContent === 'string' && m.streamingContent.length > 0
            ? m.streamingContent
            : m.content;
      return { ...m, isStreaming: false, content: finalContent };
    });
    this.notifySubscribers({ ...currentState });

    // Persist completion
    void xyneAIStreamStorage.completeStream(streamId, finalResponse);
    // Also persist the cleaned messages so a page refresh / IndexedDB rehydrate
    // doesn't bring back the streaming flag.
    void xyneAIStreamStorage.updateMessages(streamId, currentState.messages);

    // Re-fetch messages from backend to get authoritative final state
    // This fixes rendering misalignment issues caused by partial/broken markdown
    // during streaming deltas (similar to refreshRuns pattern in claw chat)
    void this.refreshMessagesFromBackend(
      streamId,
      threadId,
      currentState.followUpsPending === true,
    );

    const notifyKey = currentState.sessionId || currentState.streamSlotKey || threadId;
    const viewingThis = Boolean(
      notifyKey && this.visibleConversationId && notifyKey === this.visibleConversationId,
    );

    const shouldNotify =
      !currentState.suppressCompletionToast &&
      (!this.isSidebarOpen || !viewingThis) &&
      !this.isClawOverlayOpen &&
      !this.hasClawOverlay &&
      !this.isOnAIPage;

    if (shouldNotify) {
      this.pendingCompletionNotifications.add(notifyKey);
      this.showCompletionToast(notifyKey, finalResponse, currentState);
    }

    // Cleanup after a delay — only if this stream is still the active one for
    // this thread (a new stream may have replaced it under the same threadId
    // key). The window matters: while the entry is in `activeStreams`,
    // handleLoadConversation + the useXyneAIStream hook can re-bind to it on
    // switch-back and the user sees the completed reply immediately. After it
    // disappears the loader falls through to the backend /messages fetch,
    // which is slower and (in the current pipeline) sometimes missing the
    // last bot reply. 5s was too aggressive — a user who switches to another
    // conv to peek at it and comes back loses the reply. Keep it for 5 minutes;
    // a completed stream's memory footprint is tiny.
    setTimeout(
      () => {
        const current = this.activeStreams.get(threadId);
        if (current && current.streamId === streamId) {
          this.activeStreams.delete(threadId);
        }
        this.abortControllers.delete(streamId);
      },
      5 * 60 * 1000,
    );
  }

  /**
   * Re-fetch conversation messages from backend after streaming completes.
   * This ensures the UI renders the authoritative final state rather than
   * potentially misaligned incremental deltas from streaming.
   */
  /**
   * Attach a read-only LIVE viewer to an in-progress run after a reload. Opens
   * the Spaces `/live` SSE proxy; if its snapshot shows a live run (partial
   * answer text or in-progress tool calls), seeds a streaming bot message and
   * feeds delta/reasoning/invocation/label into it — reusing the SAME reducers
   * as the driving path — then reconciles the final transcript on `done`. If no
   * run is live (empty snapshot) or this tab is already driving/viewing one, it
   * closes immediately and the static fetched transcript stands. Returns a
   * detach fn (call on unmount).
   */
  public attachLiveViewer(
    threadId: string,
    convId: string,
    agentSlug = 'ask-ai',
    initialMessages: Message[] = [],
  ): () => void {
    if (!convId.startsWith('chat-')) {
      return () => undefined;
    }
    const existing = this.activeStreams.get(threadId);
    if (existing && existing.status === 'streaming') {
      // A genuinely live stream (driving, or a viewer whose SSE is open) owns
      // the thread — don't double-attach. But a DEAD viewer's leftover
      // 'streaming' state (detached on navigate-away before `done`) must NOT
      // block a fresh attach, or returning to the conversation freezes.
      const isDeadViewer =
        existing.streamId.startsWith('live-') && !this.liveViewerStreams.has(existing.streamId);
      if (!isDeadViewer) {
        return () => undefined;
      }
    }

    const streamId = `live-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
    const botMessageId = `bot-live-${streamId}`;
    let started = false;
    let closed = false;
    const abort = new AbortController();
    // Register so a NEW driving send in this thread (sendMessage → abortStream)
    // cleanly tears this viewer down instead of leaving its SSE open.
    this.abortControllers.set(streamId, abort);
    this.liveViewerStreams.add(streamId);

    const close = (): void => {
      if (closed) return;
      closed = true;
      abort.abort();
      this.abortControllers.delete(streamId);
      this.liveViewerStreams.delete(streamId);
      this.streamDataMap.delete(streamId);
      this.pendingDeltaMap.delete(streamId);
      const rid = this.rafIdMap.get(streamId);
      if (rid !== undefined) {
        cancelAnimationFrame(rid);
        this.rafIdMap.delete(streamId);
      }
      // Detached BEFORE `done` (navigate-away/unmount): drop our still-
      // 'streaming' state. Left in place it becomes a zombie — the adopt paths
      // (which PREFER streaming matches) adopt it and early-return, and the
      // attach guard blocks a fresh viewer → frozen bubble on return. A
      // finalized state (done/fallback set status='completed' first) is kept
      // for the 5-min switch-back adoption window.
      const st = this.activeStreams.get(threadId);
      if (st && st.streamId === streamId && st.status === 'streaming') {
        this.activeStreams.delete(threadId);
      }
    };

    const ensureViewerStream = (
      partial?: { content?: string; reasoning?: string },
      inProgress?: ToolInvocation[],
    ): void => {
      if (started) return;
      started = true;
      // Base the viewer state on the FETCHED transcript (user messages + prior
      // turns) — useXyneAIStream does setMessages(state.messages), so without it
      // the transcript would be replaced by just the streaming bot. It also keeps
      // mergeRefreshedMessages' positional bot-index reconcile aligned on `done`.
      const prevMessages = initialMessages.length
        ? initialMessages
        : (this.activeStreams.get(threadId)?.messages ?? []);
      // Parent the streaming bot under the TIP of the transcript's active path.
      // Branch-aware rendering (resolveActivePath) walks parentIds from the root
      // picking the newest child at each fork — an orphan bot (no parentId) in a
      // conversation whose messages carry parentIds becomes the sole selected
      // ROOT child and hides the entire prior transcript until `done`. (A fresh
      // conversation has no parentIds anywhere → linear mode → unaffected.)
      const activePath = prevMessages.length ? resolveActivePath(prevMessages, {}) : [];
      const parentTip = activePath.length ? activePath[activePath.length - 1] : undefined;
      const botMsg: Message = {
        id: botMessageId,
        type: 'bot',
        content: '',
        timestamp: new Date(),
        isStreaming: true,
        streamingContent: partial?.content ?? '',
        sessionId: convId,
        ...(parentTip ? { parentId: parentTip.id } : {}),
        ...(partial?.reasoning ? { reasoning: partial.reasoning } : {}),
        ...(inProgress && inProgress.length ? { toolInvocations: inProgress } : {}),
      };
      const streamState: StreamState = {
        streamId,
        threadId,
        streamSlotKey: deriveStreamSlotKey(threadId),
        sessionId: convId,
        status: 'streaming',
        messages: [...prevMessages, botMsg],
        debugEvents: [],
        debugArtifactsReadyVersion: 0,
        startedAt: Date.now(),
        showInSidebar: true,
        version: 'v2',
        agentSlug,
      };
      this.activeStreams.set(threadId, streamState);
      this.streamDataMap.set(streamId, {
        rawContent: partial?.content ?? '',
        toolOutputs: [],
        participants: [],
      });
      this.notifySubscribers({ ...streamState });
    };

    const onEvent = (type: string, data: Record<string, unknown>): void => {
      if (closed) return;
      switch (type) {
        case 'snapshot': {
          const partial = data['partial'] as { content?: string; reasoning?: string } | undefined;
          const inProgress = (data['inProgress'] as ToolInvocation[] | undefined) ?? [];
          if (!started) {
            if (!partial && inProgress.length === 0) {
              close(); // run already finished — the fetched transcript stands
              return;
            }
            ensureViewerStream(partial, inProgress);
            break;
          }
          // RECONNECT re-snapshot. If the run finished while we were
          // disconnected, finalize via the done path; else heal the missed
          // window from the persisted partial (authoritative accumulated text —
          // only ever grow, never truncate what already streamed in).
          if (!partial && inProgress.length === 0) {
            onEvent('done', {});
            return;
          }
          const sd = this.streamDataMap.get(streamId);
          const st = this.activeStreams.get(threadId);
          if (
            partial &&
            sd &&
            st &&
            st.streamId === streamId &&
            (partial.content?.length ?? 0) > sd.rawContent.length
          ) {
            sd.rawContent = partial.content ?? '';
            st.messages = st.messages.map(m =>
              m.id === botMessageId
                ? {
                    ...m,
                    streamingContent: sd.rawContent,
                    ...(partial.reasoning &&
                    (!m.reasoning || partial.reasoning.length > m.reasoning.length)
                      ? { reasoning: partial.reasoning }
                      : {}),
                  }
                : m,
            );
            this.notifySubscribers({ ...st });
          }
          for (const inv of inProgress) {
            this.processStreamEvent(
              { type: 'tool_invocation', toolInvocation: inv },
              botMessageId,
              '',
              [],
              streamId,
              threadId,
            );
          }
          break;
        }
        case 'delta': {
          if (!started) ensureViewerStream();
          const textDelta = data['textDelta'] as string | undefined;
          const reasoningDelta = data['reasoningDelta'] as string | undefined;
          if (textDelta) {
            this.pendingDeltaMap.set(
              streamId,
              (this.pendingDeltaMap.get(streamId) ?? '') + textDelta,
            );
            this.scheduleDeltaFlush(streamId);
          }
          if (reasoningDelta)
            this.processStreamEvent(
              { type: 'reasoning_delta', reasoningDelta },
              botMessageId,
              '',
              [],
              streamId,
              threadId,
            );
          break;
        }
        case 'reasoning': {
          if (!started) ensureViewerStream();
          const delta = (data['delta'] ?? data['reasoningDelta']) as string | undefined;
          if (delta)
            this.processStreamEvent(
              { type: 'reasoning_delta', reasoningDelta: delta },
              botMessageId,
              '',
              [],
              streamId,
              threadId,
            );
          break;
        }
        case 'invocation': {
          if (!started) ensureViewerStream();
          const toolInvocation = data['toolInvocation'];
          if (toolInvocation)
            this.processStreamEvent(
              { type: 'tool_invocation', toolInvocation },
              botMessageId,
              '',
              [],
              streamId,
              threadId,
            );
          break;
        }
        case 'label': {
          if (!started) ensureViewerStream();
          const toolLabel = data['toolLabel'] as string | undefined;
          const st = this.activeStreams.get(threadId);
          // streamId guard: if a NEW driving stream replaced this thread's state,
          // this stale viewer must not touch it.
          if (toolLabel && st && st.streamId === streamId) {
            st.messages = st.messages.map(m =>
              m.id === botMessageId ? { ...m, statusMessage: toolLabel } : m,
            );
            this.notifySubscribers({ ...st });
          }
          break;
        }
        case 'done':
        case 'live-disabled': {
          if (started) {
            const st = this.activeStreams.get(threadId);
            // streamId guard: skip if a newer driving stream owns this thread.
            if (st && st.streamId === streamId) {
              st.status = 'completed';
              // Promote streamingContent → content and clear isStreaming (mirror
              // completeStream), so it renders as a final message immediately —
              // not a spinner — before the reconcile lands.
              st.messages = st.messages.map(m => {
                if (m.id !== botMessageId) return m;
                const finalContent =
                  m.content && m.content.length > 0 ? m.content : (m.streamingContent ?? '');
                return { ...m, isStreaming: false, content: finalContent };
              });
              this.notifySubscribers({ ...st });
            }
            // Reconcile the now-finalized transcript (parity with the driver
            // path; internally streamId-guarded).
            void this.refreshMessagesFromBackend(
              streamId,
              threadId,
              data['followUpsPending'] === true,
            );
          }
          close();
          break;
        }
        default:
          break;
      }
    };

    // fetch-based SSE reader (credentials via cookie; the Spaces backend injects
    // x-user-id upstream) — avoids an EventSource dependency and works everywhere.
    // Reconnects on silent EOF/transport death (the reconnect snapshot heals the
    // missed window), and NEVER leaves an infinite spinner: if the stream dies
    // for good without a `done`, we finalize with what we have + reconcile.
    void (async () => {
      await consumeConversationLiveStream({
        conversationId: convId,
        agentSlug,
        signal: abort.signal,
        isClosed: () => closed,
        onEvent,
      });

      // Ended WITHOUT a `done` (transport died / retries exhausted). Don't leave
      // the bot spinning forever: finalize with the accumulated content and
      // reconcile against the backend transcript. streamId-guarded so a newer
      // driving stream is never touched.
      if (!closed) {
        if (started) {
          const st = this.activeStreams.get(threadId);
          if (st && st.streamId === streamId) {
            st.status = 'completed';
            st.messages = st.messages.map(m => {
              if (m.id !== botMessageId) return m;
              const finalContent =
                m.content && m.content.length > 0 ? m.content : (m.streamingContent ?? '');
              return { ...m, isStreaming: false, content: finalContent };
            });
            this.notifySubscribers({ ...st });
          }
          void this.refreshMessagesFromBackend(streamId, threadId);
        }
        close();
      }
    })();

    return close;
  }

  private async refreshMessagesFromBackend(
    streamId: string,
    threadId: string,
    followUpsPending = false,
    followUpRetry = 0,
  ): Promise<void> {
    const currentState = this.activeStreams.get(threadId);
    if (!currentState) return;

    // Only refresh for v2 (claw-backed) streams that have a sessionId
    const conversationId = currentState.sessionId;
    if (!conversationId || !conversationId.startsWith('chat-')) {
      return;
    }

    try {
      const refreshedMessages = await fetchV2ConversationMessages(
        conversationId,
        currentState.agentSlug ?? 'ask-ai',
      );

      const latestRefreshedBot = [...refreshedMessages]
        .reverse()
        .find(message => message.type === 'bot');
      // Merge refreshed messages with current state, preserving streaming state
      // and ensuring we don't overwrite messages that are still being processed
      this.mergeRefreshedMessages(streamId, threadId, refreshedMessages);

      // The stream's done frame and AgentRun persistence finish on adjacent
      // async hops. A first history read can therefore see the assistant text
      // before its internal follow-up recorder has been linked. Retry only
      // while the authoritative latest bot still lacks suggestions.
      if (
        followUpsPending &&
        !latestRefreshedBot?.followUpSuggestions?.length &&
        followUpRetry < FOLLOW_UP_RETRY_DELAYS_MS.length
      ) {
        const delayMs = FOLLOW_UP_RETRY_DELAYS_MS[followUpRetry];
        window.setTimeout(() => {
          const latestState = this.activeStreams.get(threadId);
          if (latestState?.streamId === streamId) {
            void this.refreshMessagesFromBackend(streamId, threadId, true, followUpRetry + 1);
          }
        }, delayMs);
      }
    } catch (error) {
      logger.warn(LogEvent.FRONTEND_ERROR, {
        type: 'migrated_console_warn',
        message: String('[XyneAIStreamManager] Failed to refresh messages from backend:'),
        context: [error],
      });
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

          const mergedReasoning = finalRefreshed.reasoning ?? localMsg.reasoning;
          const mergedMsg: Message = {
            ...finalRefreshed,
            // Keep local traceId if it was set during streaming
            ...(localMsg.traceId && { traceId: localMsg.traceId }),
            // Preserve the stable render key so the bubble doesn't remount when a
            // post-completion refresh replaces content (server rows carry none).
            ...(localMsg.stableKey && { stableKey: localMsg.stableKey }),
            // Preserve locally accumulated content over potentially incomplete backend content
            content: finalContent,
            streamingContent: finalStreamingContent || finalContent,
            // Preserve locally accumulated reasoning if backend didn't return it
            ...(mergedReasoning !== undefined && { reasoning: mergedReasoning }),
            ...(localMsg.pendingActions?.length && { pendingActions: localMsg.pendingActions }),
            // Keep the local ID to avoid breaking React keys and parent references
            id: localMsg.id,
            // Tree topology is owned LOCALLY during a stream's lifetime.
            // Server-side parentId for run-stream conversations is null and
            // gets synthesized chronologically by XyneAISessionsV2Service on
            // reload (a server msg id). If we let the spread above clobber
            // local parentId with a server id, follow-up bot messages become
            // orphans (their parent points to a server id that doesn't exist
            // in local state), which strands them outside resolveActivePath
            // and they vanish from display until reload re-fetches the tree.
            // Spread conditionally — exactOptionalPropertyTypes rejects an
            // explicit `undefined` on an optional field.
            ...(localMsg.parentId !== undefined && { parentId: localMsg.parentId }),
          };
          return mergedMsg;
        }
      }
      return localMsg;
    });

    // Check if we have any user messages that need to be synced with server IDs.
    // Branching makes content matching ambiguous: a user can ask the same
    // question ("repeat the above math") in two different branches, and the
    // server returns BOTH copies — keyed differently in the tree. Match on
    // (parentId, content) so a local user msg in branch A doesn't get its
    // id rewritten to point at a same-content msg in branch B (which then
    // makes the next turn's parentMessageId resolve to the wrong branch).
    //
    // Reserve each server id at most once, and only swap when the local id
    // doesn't already match — both guards prevent the corruption that put
    // the second "repeat" in the wrong branch chain on reload.
    const usedRefreshedIds = new Set<string>(
      currentState.messages.filter(m => m.type === 'user').map(m => m.id),
    );
    const localUserMsgs = currentState.messages.filter(m => m.type === 'user');
    for (const localUserMsg of localUserMsgs) {
      const matchingRefreshed = refreshedMessages.find(
        rm =>
          rm.type === 'user' &&
          rm.content === localUserMsg.content &&
          (rm.parentId ?? null) === (localUserMsg.parentId ?? null) &&
          !usedRefreshedIds.has(rm.id),
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
            usedRefreshedIds.add(matchingRefreshed.id);
            // Also update parent references pointing to this message
            for (let i = 0; i < updatedMessages.length; i++) {
              const msg = updatedMessages[i];
              if (msg && msg.parentId === localUserMsg.id) {
                updatedMessages[i] = { ...msg, parentId: matchingRefreshed.id };
              }
            }
          }
        }
      } else if (matchingRefreshed) {
        // Already aligned — still record the id so a later same-content
        // local user can't collide with it.
        usedRefreshedIds.add(matchingRefreshed.id);
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
   * Abort a stream.
   *
   * Send the upstream cancel (so the agent stops and the cancelled `done`
   * frame persists partial state to chat_messages), then abort the local
   * fetch / worker. We deliberately use `state.traceId` — not
   * `state.sessionId` — because the backend looks up agent_runs by claw's
   * run UUID, which lives on traceId; sessionId here is the conversation id.
   */
  public abortStream(streamId: string): void {
    // Snapshot the cancel key before we mutate state below. The state lookup
    // below may not happen if the stream is no longer in activeStreams (e.g.
    // late retry), but we still want to fire the backend cancel.
    let cancelRunId: string | null = null;
    for (const state of this.activeStreams.values()) {
      if (state.streamId === streamId) {
        cancelRunId = state.traceId?.trim() || null;
        break;
      }
    }
    if (cancelRunId) {
      // Fire-and-forget; never block the UI on this. If traceId is empty
      // (very early abort before the upstream `run` event arrived), skip —
      // there's no claw sessionId for the backend to cancel yet. The
      // backend's res.on('close') safety net still tears down upstream when
      // we abort the fetch below.
      void apiInstance.post(`/xyne-ai/v2/cancel/${encodeURIComponent(cancelRunId)}`).catch(() => {
        // Best-effort. The local abort still happens; the backend's
        // res.on('close') safety net will tear down upstream too.
      });
    }

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

        // Preserve whatever was streamed so far — tool rows + partial assistant
        // text. The backend persists the same content to chat_messages with
        // status="cancelled", so reload-from-server matches.
        state.messages = state.messages.map(msg =>
          msg.isStreaming
            ? {
                ...msg,
                // Keep streamed content; fall back to streamingContent if
                // content hasn't been finalized yet.
                content: msg.content || msg.streamingContent || '',
                isStreaming: false,
                isAborted: true,
                streamingContent: '',
              }
            : msg,
        );

        this.notifySubscribers({ ...state });

        // Persist abort (with whatever partial content lives in messages now)
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
   * Abort every streaming session EXCEPT the ones whose session id / slot key /
   * thread-slot matches one of `keepKeys`. Used by the sidebar's "Abort others"
   * action so a user can stop all background chats but the one they're viewing.
   */
  public abortAllExcept(keepKeys: string[]): void {
    const keep = new Set(keepKeys.filter(k => k && k.trim().length > 0));
    const toAbort: string[] = [];
    for (const state of this.activeStreams.values()) {
      if (state.status !== 'streaming') continue;
      const keys = [
        state.sessionId,
        state.streamSlotKey,
        getStreamSlotKeyFromThreadId(state.threadId),
      ].filter((k): k is string => !!k && k.trim().length > 0);
      if (keys.some(k => keep.has(k))) continue;
      toAbort.push(state.streamId);
    }
    for (const id of toAbort) this.abortStream(id);
  }

  /**
   * Toast for a stream that finished while the user was elsewhere. Shaped like
   * the chat-notification toast (title + preview + a "View" button) so the
   * answer is identifiable and one click away — the bare snippet it replaced
   * said neither which thread had replied nor how to get back to it.
   */
  private showCompletionToast(notifyKey: string, response: string, state: StreamState): void {
    const question = [...state.messages].reverse().find(m => m.type === 'user')?.content ?? '';
    const title = question
      ? `Ask AI · ${truncateForToast(question, 60)}`
      : 'Ask AI finished replying';
    const preview = truncateForToast(response, 140);

    const sessionId = state.sessionId?.trim() ?? '';
    const openThread = this.completionToastNavigator;
    const clear = (): void => {
      this.pendingCompletionNotifications.delete(notifyKey);
    };

    toast(title, {
      id: `xyne-ai-completion-${notifyKey}`,
      description: preview,
      duration: 8000,
      closeButton: true,
      ...(sessionId && openThread
        ? {
            action: {
              label: 'View',
              onClick: (): void => {
                clear();
                openThread({ sessionId, fromAIPage: state.startedOnAIPage === true });
              },
            },
          }
        : {}),
      // Sonner lays the toast out as a row, so the action button sits beside
      // the text by default. Wrapping the card and giving the title/description
      // block the full basis drops the button onto its own line under the
      // preview. Spacing goes through actionButtonStyle rather than a class:
      // per-toast classNames are appended to the Toaster-level ones (App.tsx
      // sets `!mt-8`), and between two equally-specific utilities CSS source
      // order decides — an inline style is the only reliable override.
      classNames: { toast: '!flex-wrap', content: '!basis-full' },
      actionButtonStyle: { marginTop: 8, marginLeft: 'auto' },
      onAutoClose: clear,
      onDismiss: clear,
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
