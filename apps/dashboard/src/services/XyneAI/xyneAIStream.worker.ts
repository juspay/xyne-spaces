/**
 * Web Worker for XyneAI Streaming
 * Runs API calls on a separate thread to avoid blocking the main UI thread
 *
 * The wire-body serialization and SSE framing now live in the platform-agnostic
 * Ask AI stream core (`@xyne/shared/askAI`) so the dashboard (web) and the native
 * mobile app share ONE serializer + parser and can't drift. This worker keeps the
 * web-specific transport concerns: `fetch`, cookie credentials, the read loop,
 * abort handling, and the worker<->main postMessage protocol.
 */

import {
  buildAskAIRequestBody,
  createAskAISSEParser,
  type AskAIRequestInput,
} from '@xyne/shared/askAI';

// Worker message types
export interface WorkerStartStreamMessage {
  type: 'START_STREAM';
  payload: {
    streamId: string;
    url: string;
    // The camelCase Ask AI request shape is defined once in the shared core.
    requestBody: AskAIRequestInput;
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

export type WorkerOutgoingMessage =
  | WorkerStreamChunkMessage
  | WorkerStreamCompleteMessage
  | WorkerStreamErrorMessage;

// Track active streams
const activeStreams = new Map<string, AbortController>();

/**
 * Execute a streaming request
 */
async function executeStream(
  streamId: string,
  url: string,
  requestBody: AskAIRequestInput,
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
      // Serialization is shared with native via @xyne/shared/askAI.
      body: JSON.stringify(buildAskAIRequestBody(requestBody)),
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

    // SSE framing/JSON/heartbeat handling is shared with native.
    const parser = createAskAISSEParser();

    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition, no-constant-condition
    while (true) {
      if (abortController.signal.aborted) {
        void reader.cancel();
        return;
      }

      const { done, value } = await reader.read();
      if (done) break;

      const chunk = decoder.decode(value, { stream: true });
      const events = parser.push(chunk, err => {
        // eslint-disable-next-line no-console
        console.error('[XyneAIWorker] Failed to parse SSE event:', err);
      });

      for (const data of events) {
        // Send chunk to main thread
        const message: WorkerStreamChunkMessage = {
          type: 'STREAM_CHUNK',
          payload: {
            streamId,
            data: data as Record<string, unknown>,
          },
        };
        self.postMessage(message);
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
      // eslint-disable-next-line no-console
      console.error('[XyneAIWorker] Unknown message type:', type);
  }
});

// Export empty object to make this a module
export {};
