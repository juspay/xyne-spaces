/**
 * The client half of the change-notification stream.
 *
 * Opens one multiplexed SSE connection for every topic the caller is watching and
 * keeps it open, reconnecting with backoff for as long as the subscription lives.
 *
 * ## What a subscriber must do with this
 *
 * Frames are notifications, never payloads: `workflow_changed` says only *that* a
 * workflow changed. Re-read it through the ordinary authorized GET — that is what
 * keeps access control on the read path, where it already works, rather than at a
 * fan-out layer that knows nothing about who is listening.
 *
 * Delivery is at-most-once. Anything published while the connection was down is
 * gone, with no replay, so `onOpen` reports `reconnected: true` and a subscriber
 * must treat that as "re-read everything you are watching". The recovery path and
 * the happy path are then the same code.
 */

import type { BusEvent } from '../events/types.js';
import type { WorkflowClientConfig } from './types.js';
import { buildUrl } from './url.js';
import { readSSE } from './sse.js';

/**
 * Which entities to watch. A workflow topic carries that definition's changes
 * and its runs; a folder topic carries the runs of every workflow inside it.
 */
export interface EventSubscription {
  workflows?: readonly string[];
  folders?: readonly string[];
  /**
   * Watch every run under the caller's own root scope — the feed behind the
   * unscoped Executions list. The server derives the root id from the
   * authenticated principal, so no id is passed here.
   */
  root?: boolean;
}

export interface EventStreamHandlers {
  /** A change notification arrived. Re-read the entity it names. */
  onEvent: (event: BusEvent) => void;
  /**
   * The connection is live and the server has confirmed its topics.
   *
   * `rejected` lists ids the caller may not read — the connection stays up for
   * the rest rather than failing wholesale, so a revoked permission cannot blind
   * a client to everything else it was watching.
   *
   * `reconnected` is true for every open after the first. Because the stream
   * cannot replay, that means events may have been missed: re-read.
   */
  onOpen?: (info: { subscribed: string[]; rejected: string[]; reconnected: boolean }) => void;
  /** The connection dropped; a retry is scheduled. Informational. */
  onError?: (err: unknown) => void;
}

/** Backoff bounds for reconnection. */
const BASE_RETRY_MS = 500;
const MAX_RETRY_MS = 30_000;

/**
 * Exponential backoff with jitter.
 *
 * The jitter is the point: without it, a deploy that drops every stream at once
 * brings them all back at the same instant, and the thundering herd finishes what
 * the restart started.
 */
function retryDelay(attempt: number): number {
  const capped = Math.min(MAX_RETRY_MS, BASE_RETRY_MS * 2 ** (attempt - 1));
  return Math.round(capped * (0.75 + Math.random() * 0.5));
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    signal.addEventListener(
      'abort',
      () => {
        clearTimeout(timer);
        resolve();
      },
      { once: true },
    );
  });
}

export interface EventsClient {
  /**
   * Watch the given entities until the returned function is called.
   *
   * Returns synchronously — the connection is established in the background, and
   * `onOpen` fires once it is live. Callers are usually React effects, whose
   * cleanup must be synchronous.
   */
  subscribe(topics: EventSubscription, handlers: EventStreamHandlers): () => void;
}

export function createEventsClient(config: WorkflowClientConfig): EventsClient {
  return {
    subscribe(topics, handlers) {
      const workflows = [...new Set(topics.workflows ?? [])];
      const folders = [...new Set(topics.folders ?? [])];
      const root = topics.root === true;
      const controller = new AbortController();
      const { signal } = controller;

      // Nothing to watch: hand back a no-op rather than opening a connection the
      // server would reject for an empty topic set.
      if (workflows.length === 0 && folders.length === 0 && !root) {
        return () => {};
      }

      const url = buildUrl(config.baseUrl, '/events', {
        ...(workflows.length > 0 ? { workflows: workflows.join(',') } : {}),
        ...(folders.length > 0 ? { folders: folders.join(',') } : {}),
        ...(root ? { root: '1' } : {}),
      });

      const run = async (): Promise<void> => {
        let attempt = 0;
        let reconnected = false;

        while (!signal.aborted) {
          try {
            const fetchFn = config.fetch ?? globalThis.fetch;
            const headers = await config.getHeaders();
            const response = await fetchFn(url, {
              method: 'GET',
              headers: { ...headers, Accept: 'text/event-stream' },
              signal,
            });

            if (!response.ok || !response.body) {
              throw new Error(`Event stream failed: HTTP ${String(response.status)}`);
            }

            attempt = 0;
            for await (const frame of readSSE(response.body)) {
              if (signal.aborted) break;

              if (frame.event === 'ready') {
                const info = JSON.parse(frame.data) as {
                  subscribed: string[];
                  rejected: string[];
                };
                handlers.onOpen?.({ ...info, reconnected });
                continue;
              }

              handlers.onEvent({
                event: frame.event,
                data: JSON.parse(frame.data) as unknown,
              } as BusEvent);
            }
          } catch (err) {
            if (signal.aborted) return;
            handlers.onError?.(err);
          }

          if (signal.aborted) return;
          // The server closes an idle stream on deploy, and a proxy may cut one
          // at any time; neither is an error worth surfacing as a failure.
          reconnected = true;
          attempt += 1;
          await sleep(retryDelay(attempt), signal);
        }
      };

      void run();

      return () => {
        controller.abort();
      };
    },
  };
}
