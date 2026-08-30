/**
 * Web Worker for XyneAI Streaming
 * Runs API calls on a separate thread to avoid blocking the main UI thread
 */

// Worker message types
export interface WorkerStartStreamMessage {
  type: 'START_STREAM';
  payload: {
    streamId: string;
    url: string;
    requestBody: {
      query: string;
      displayQuery?: string;
      channelIds: string[];
      collectionIds?: string[];
      fileIds?: string[];
      folderIds?: string[];
      canvasIds?: string[];
      ticketIds?: string[];
      callIds?: string[];
      attachedContext?: Array<{
        type: 'channel' | 'ticket' | 'canvas' | 'call' | 'activity';
        id: string;
        title: string;
        threadId?: string;
        eventName?: string;
        eventCategory?: string;
        timestamp?: string;
        metadata?: Record<string, unknown>;
        relatedData?: Record<string, unknown>;
      }>;
      conversationId: string;
      sessionId: string;
      webSearchEnabled: boolean;
      deepResearchEnabled?: boolean;
      createCanvasEnabled?: boolean;
      /** Single search + single answer pass instead of the full agentic tool
       *  loop — see xyne-claw-auth's run-stream.ts POST / instant branch. */
      instant?: boolean;
      /** Per-run thinking level (composer dropdown). Absent = agent default. */
      thinkingLevel?: 'off' | 'minimal' | 'low' | 'medium' | 'high';
      researchContext?: { type: string; id?: string; name: string } | null;
      canvasId?: string;
      messageAttachmentIds?: string[];
      attachments?: Array<{
        data: string;
        mimeType: string;
        filename: string;
      }>;
      parentMessageId?: string;
      isRegenerate?: boolean;
      // Branching: edit-user signals that the new user message is a sibling
      // of `editedUserMessageId` under `parentAssistantMessageId` (the
      // assistant parent the original lived under). claw-auth uses these to
      // clone the PI session BEFORE the original user msg so the LLM session
      // doesn't include the old turn as context.
      isEditUserMessage?: boolean;
      editedUserMessageId?: string;
      parentAssistantMessageId?: string;
      draftMode?: boolean;
      version?: 'v1' | 'v2';
      disableTools?: boolean;
      agentSlug?: string;
      /** Per-run model pin from the composer's model picker. */
      model?: string;
      /** pinProvider for `model` — which provider the pin rides. */
      modelProvider?: 'litellm' | 'spaces';
    };
  };
}

export interface WorkerAbortStreamMessage {
  type: 'ABORT_STREAM';
  payload: {
    streamId: string;
  };
}

export type WorkerIncomingMessage = WorkerStartStreamMessage | WorkerAbortStreamMessage;

// Worker response types
export interface WorkerStreamChunkMessage {
  type: 'STREAM_CHUNK';
  payload: {
    streamId: string;
    data: Record<string, unknown>;
  };
}

export interface WorkerStreamCompleteMessage {
  type: 'STREAM_COMPLETE';
  payload: {
    streamId: string;
  };
}

export interface WorkerStreamErrorMessage {
  type: 'STREAM_ERROR';
  payload: {
    streamId: string;
    error: string;
  };
}

export interface WorkerLogErrorMessage {
  type: 'WORKER_LOG_ERROR';
  payload: {
    message: string;
    error: {
      name: string;
      message: string;
      stack?: string;
    };
  };
}

export type WorkerOutgoingMessage =
  | WorkerStreamChunkMessage
  | WorkerStreamCompleteMessage
  | WorkerStreamErrorMessage
  | WorkerLogErrorMessage;

// Track active streams
const activeStreams = new Map<string, AbortController>();

const reportWorkerError = (message: string, value: unknown): void => {
  const error = value instanceof Error ? value : new Error(String(value));
  const serializedError: WorkerLogErrorMessage['payload']['error'] = {
    name: error.name,
    message: error.message,
  };
  if (error.stack) serializedError.stack = error.stack;

  const logMessage: WorkerLogErrorMessage = {
    type: 'WORKER_LOG_ERROR',
    payload: {
      message,
      error: serializedError,
    },
  };
  self.postMessage(logMessage);
};

/**
 * Execute a streaming request
 */
async function executeStream(
  streamId: string,
  url: string,
  requestBody: WorkerStartStreamMessage['payload']['requestBody'],
): Promise<void> {
  const abortController = new AbortController();
  activeStreams.set(streamId, abortController);

  try {
    // eslint-disable-next-line local-rules/no-fetch-use-axios
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        // eslint-disable-next-line @typescript-eslint/naming-convention
        'Content-Type': 'application/json',
        Accept: 'text/event-stream',
      },
      credentials: 'include',
      // eslint-disable-next-line @typescript-eslint/naming-convention
      body: JSON.stringify({
        query: requestBody.query,
        ...(requestBody.displayQuery && { display_query: requestBody.displayQuery }),
        /* eslint-disable @typescript-eslint/naming-convention */
        channel_ids: requestBody.channelIds,
        ...(requestBody.collectionIds &&
          requestBody.collectionIds.length > 0 && { collection_ids: requestBody.collectionIds }),
        ...(requestBody.fileIds &&
          requestBody.fileIds.length > 0 && { file_ids: requestBody.fileIds }),
        ...(requestBody.folderIds &&
          requestBody.folderIds.length > 0 && { folder_ids: requestBody.folderIds }),
        ...(requestBody.canvasIds &&
          requestBody.canvasIds.length > 0 && { canvas_ids: requestBody.canvasIds }),
        ...(requestBody.ticketIds &&
          requestBody.ticketIds.length > 0 && { ticket_ids: requestBody.ticketIds }),
        ...(requestBody.callIds &&
          requestBody.callIds.length > 0 && { call_ids: requestBody.callIds }),
        ...(requestBody.attachedContext &&
          requestBody.attachedContext.length > 0 && {
            attached_context: requestBody.attachedContext,
          }),
        conversation_id: requestBody.conversationId,
        session_id: requestBody.sessionId,
        web_search_enabled: requestBody.webSearchEnabled,
        deep_research_enabled: requestBody.deepResearchEnabled ?? false,
        create_canvas_enabled: requestBody.createCanvasEnabled ?? false,
        instant: requestBody.instant ?? false,
        ...(requestBody.thinkingLevel ? { thinkingLevel: requestBody.thinkingLevel } : {}),
        research_context: requestBody.researchContext ?? null,
        ...(requestBody.canvasId && {
          canvas_id: requestBody.canvasId,
        }),
        ...(requestBody.messageAttachmentIds &&
          requestBody.messageAttachmentIds.length > 0 && {
            message_attachment_ids: requestBody.messageAttachmentIds,
          }),
        ...(requestBody.attachments &&
          requestBody.attachments.length > 0 && {
            attachments: requestBody.attachments.map(a => ({
              data: a.data,
              mime_type: a.mimeType,
              filename: a.filename,
            })),
          }),
        ...(requestBody.parentMessageId && {
          parent_message_id: requestBody.parentMessageId,
        }),
        ...(requestBody.isRegenerate && { is_regenerate: requestBody.isRegenerate }),
        ...(requestBody.isEditUserMessage && {
          is_edit_user_message: requestBody.isEditUserMessage,
        }),
        ...(requestBody.editedUserMessageId && {
          edited_user_message_id: requestBody.editedUserMessageId,
        }),
        ...(requestBody.parentAssistantMessageId && {
          parent_assistant_message_id: requestBody.parentAssistantMessageId,
        }),
        ...(requestBody.draftMode && { draft_mode: true }),
        ...(requestBody.version && { version: requestBody.version }),
        ...(requestBody.disableTools && { disable_tools: true }),
        ...(requestBody.agentSlug && { agentSlug: requestBody.agentSlug }),
        ...(requestBody.model && { model: requestBody.model }),
        ...(requestBody.model &&
          requestBody.modelProvider && { modelProvider: requestBody.modelProvider }),
        /* eslint-enable @typescript-eslint/naming-convention */
      }),
      signal: abortController.signal,
    });

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const reader = response.body?.getReader();
    const decoder = new TextDecoder();
    if (!reader) {
      throw new Error('No response body');
    }

    let buffer = '';

    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition, no-constant-condition
    while (true) {
      if (abortController.signal.aborted) {
        void reader.cancel();
        return;
      }

      const { done, value } = await reader.read();
      if (done) break;

      const chunk = decoder.decode(value, { stream: true });
      buffer += chunk;
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        if (line.startsWith('data: ')) {
          try {
            const parsed: unknown = JSON.parse(line.slice(6));
            if (typeof parsed !== 'object' || parsed === null) continue;

            const data = parsed as Record<string, unknown>;

            // Ignore heartbeat pings sent to keep the connection alive
            if (data['type'] === 'ping') continue;

            // Send chunk to main thread
            const message: WorkerStreamChunkMessage = {
              type: 'STREAM_CHUNK',
              payload: {
                streamId,
                data,
              },
            };
            self.postMessage(message);
          } catch (err) {
            reportWorkerError('[XyneAIWorker] Failed to parse SSE event', err);
          }
        }
      }
    }

    // Stream completed successfully
    const completeMessage: WorkerStreamCompleteMessage = {
      type: 'STREAM_COMPLETE',
      payload: { streamId },
    };
    self.postMessage(completeMessage);
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      // Stream was aborted - don't send error
      return;
    }

    const errorMessage: WorkerStreamErrorMessage = {
      type: 'STREAM_ERROR',
      payload: {
        streamId,
        error: err instanceof Error ? err.message : 'Unknown error',
      },
    };
    self.postMessage(errorMessage);
  } finally {
    activeStreams.delete(streamId);
  }
}

/**
 * Abort a stream
 */
function abortStream(streamId: string): void {
  const abortController = activeStreams.get(streamId);
  if (abortController) {
    abortController.abort();
    activeStreams.delete(streamId);
  }
}

/**
 * Message handler
 */
self.addEventListener('message', (event: MessageEvent<WorkerIncomingMessage>) => {
  const { type, payload } = event.data;

  switch (type) {
    case 'START_STREAM':
      void executeStream(payload.streamId, payload.url, payload.requestBody);
      break;

    case 'ABORT_STREAM':
      abortStream(payload.streamId);
      break;

    default:
      reportWorkerError(
        '[XyneAIWorker] Unknown message type',
        new Error(`Unknown message type: ${String(type)}`),
      );
  }
});

// Export empty object to make this a module
export {};
