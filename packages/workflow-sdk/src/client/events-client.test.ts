import { describe, it, expect, vi } from 'vitest';
import { createEventsClient } from './events-client.js';
import type { BusEvent } from '../events/types.js';

function sseBody(...chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  });
}

const sseResponse = (...chunks: string[]): Response =>
  new Response(sseBody(...chunks), {
    status: 200,
    headers: { 'Content-Type': 'text/event-stream' },
  });

const READY = 'event: ready\ndata: {"subscribed":["wf_1"],"rejected":[]}\n\n';

/** Poll until `predicate` holds, so a test never sleeps longer than it must. */
async function waitFor(predicate: () => boolean, timeoutMs = 3_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error('waitFor timed out');
    await new Promise((r) => setTimeout(r, 10));
  }
}

describe('createEventsClient', () => {
  it('delivers events and reports the topics the server accepted', async () => {
    const fetchMock = vi.fn(() =>
      Promise.resolve(
        sseResponse(
          READY,
          'event: workflow_changed\ndata: {"workflowId":"wf_1","change":"updated","at":"t"}\n\n',
        ),
      ),
    );
    const client = createEventsClient({
      baseUrl: '/api/wf',
      getHeaders: () => ({}),
      fetch: fetchMock as unknown as typeof globalThis.fetch,
    });

    const events: BusEvent[] = [];
    const opens: Array<{ subscribed: string[]; reconnected: boolean }> = [];
    const stop = client.subscribe(
      { workflows: ['wf_1'] },
      { onEvent: (e) => events.push(e), onOpen: (i) => opens.push(i) },
    );

    await waitFor(() => events.length > 0);
    stop();

    expect(opens[0]).toMatchObject({ subscribed: ['wf_1'], reconnected: false });
    expect(events[0]).toEqual({
      event: 'workflow_changed',
      data: { workflowId: 'wf_1', change: 'updated', at: 't' },
    });
  });

  it('puts the topics in the URL, so any pod can serve the connection', async () => {
    const fetchMock = vi.fn(() => Promise.resolve(sseResponse(READY)));
    const client = createEventsClient({
      baseUrl: '/api/wf/',
      getHeaders: () => ({ Authorization: 'Bearer tok' }),
      fetch: fetchMock as unknown as typeof globalThis.fetch,
    });

    const stop = client.subscribe({ workflows: ['wf_1', 'wf_2'] }, { onEvent: () => {} });
    await waitFor(() => fetchMock.mock.calls.length > 0);
    stop();

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/wf/events?workflows=wf_1%2Cwf_2');
    // Auth travels through `getHeaders`, which is exactly what EventSource
    // could not have done.
    expect(init.headers).toMatchObject({
      Authorization: 'Bearer tok',
      Accept: 'text/event-stream',
    });
  });

  it('reconnects when the stream ends, and flags the reopen as a reconnect', async () => {
    // Every response ends immediately, so the client must dial again.
    const fetchMock = vi.fn(() => Promise.resolve(sseResponse(READY)));
    const client = createEventsClient({
      baseUrl: '/api/wf',
      getHeaders: () => ({}),
      fetch: fetchMock as unknown as typeof globalThis.fetch,
    });

    const opens: Array<{ reconnected: boolean }> = [];
    const stop = client.subscribe(
      { workflows: ['wf_1'] },
      { onEvent: () => {}, onOpen: (i) => opens.push(i) },
    );

    await waitFor(() => opens.length >= 2);
    stop();

    // The second open must announce itself as a reconnect: the stream cannot
    // replay, so the subscriber has to re-read to cover the gap.
    expect(opens[0]?.reconnected).toBe(false);
    expect(opens[1]?.reconnected).toBe(true);
  });

  it('stops dialling once unsubscribed', async () => {
    const fetchMock = vi.fn(() => Promise.resolve(sseResponse(READY)));
    const client = createEventsClient({
      baseUrl: '/api/wf',
      getHeaders: () => ({}),
      fetch: fetchMock as unknown as typeof globalThis.fetch,
    });

    const stop = client.subscribe({ workflows: ['wf_1'] }, { onEvent: () => {} });
    await waitFor(() => fetchMock.mock.calls.length > 0);
    stop();

    const callsAtStop = fetchMock.mock.calls.length;
    await new Promise((r) => setTimeout(r, 1_200));
    expect(fetchMock.mock.calls.length).toBe(callsAtStop);
  });

  it('surfaces a failed connection and keeps retrying', async () => {
    const fetchMock = vi.fn(() =>
      Promise.resolve(new Response('nope', { status: 503 })),
    );
    const client = createEventsClient({
      baseUrl: '/api/wf',
      getHeaders: () => ({}),
      fetch: fetchMock as unknown as typeof globalThis.fetch,
    });

    const errors: unknown[] = [];
    const stop = client.subscribe(
      { workflows: ['wf_1'] },
      { onEvent: () => {}, onError: (e) => errors.push(e) },
    );

    await waitFor(() => errors.length > 0);
    stop();
    expect(errors.length).toBeGreaterThan(0);
  });

  it('opens no connection at all when there is nothing to watch', () => {
    const fetchMock = vi.fn();
    const client = createEventsClient({
      baseUrl: '/api/wf',
      getHeaders: () => ({}),
      fetch: fetchMock as unknown as typeof globalThis.fetch,
    });

    const stop = client.subscribe({ workflows: [] }, { onEvent: () => {} });
    stop();

    expect(fetchMock).not.toHaveBeenCalled();
  });
});
