import { RequestAbortedError } from './request-errors';
import { createSseParser, type SseMessage } from './sseParser';

type RequestHeaders = Record<string, string>;

export class EventStreamHttpError extends Error {
  readonly status: number;
  readonly body: string;

  constructor(status: number, body: string) {
    super(`Event stream request failed with status ${status}`);
    this.name = 'EventStreamHttpError';
    this.status = status;
    this.body = body;
  }
}

export class EventStreamNetworkError extends Error {
  /** React Native reports the native failure reason in place of the response text. */
  constructor(reason: string) {
    super(reason ? `Event stream network error: ${reason}` : 'Event stream network error');
    this.name = 'EventStreamNetworkError';
  }
}

export interface EventStreamOptions {
  method?: 'GET' | 'POST';
  headers?: RequestHeaders;
  body?: string;
  signal?: AbortSignal | undefined;
  prepareHeaders: (headers: RequestHeaders) => Promise<RequestHeaders>;
  onMessage: (message: SseMessage) => void;
}

const isSuccess = (status: number): boolean => status >= 200 && status < 300;

/**
 * Reads Server-Sent Events through XHR: React Native's `fetch` cannot stream a
 * body, and XHR keeps requests on the app's mTLS networking stack.
 * Resolves when the server closes the stream; there is no timeout.
 */
export async function openEventStream(url: string, options: EventStreamOptions): Promise<void> {
  const { method = 'GET', body = null, signal, prepareHeaders, onMessage } = options;

  const headers = await prepareHeaders({ ...options.headers, Accept: 'text/event-stream' });
  if (signal?.aborted) throw new RequestAbortedError();

  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    const parser = createSseParser(onMessage);
    let received = 0;
    let settled = false;

    const settle = (error?: unknown): void => {
      if (settled) return;
      settled = true;
      signal?.removeEventListener('abort', onAbort);
      if (error === undefined) resolve();
      else reject(error);
    };

    function onAbort(): void {
      xhr.abort();
      settle(new RequestAbortedError());
    }

    function readNewText(): void {
      if (settled || !isSuccess(xhr.status)) return;
      const text = xhr.responseText;
      try {
        parser.push(text.slice(received));
        received = text.length;
      } catch (error) {
        xhr.abort();
        settle(error);
      }
    }

    // A progress listener is what makes React Native deliver `responseText` incrementally.
    xhr.onprogress = readNewText;
    xhr.onload = (): void => {
      readNewText();
      settle(
        isSuccess(xhr.status) ? undefined : new EventStreamHttpError(xhr.status, xhr.responseText),
      );
    };
    xhr.onerror = (): void => settle(new EventStreamNetworkError(xhr.responseText));

    xhr.open(method, url);
    Object.entries(headers).forEach(([name, value]) => xhr.setRequestHeader(name, value));
    signal?.addEventListener('abort', onAbort, { once: true });
    xhr.send(body);
  });
}
