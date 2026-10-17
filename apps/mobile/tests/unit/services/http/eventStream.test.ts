import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';

import { EventStreamHttpError, openEventStream } from '@/src/services/http/eventStream';
import { RequestAbortedError } from '@/src/services/http/request-errors';

/** Minimal stand-in for React Native's XHR: tests drive it by hand. */
class FakeXhr {
  static instances: FakeXhr[] = [];

  status = 0;
  responseText = '';
  aborted = false;
  method = '';
  url = '';
  sent: unknown;
  requestHeaders: Record<string, string> = {};
  onprogress: (() => void) | null = null;
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;

  constructor() {
    FakeXhr.instances.push(this);
  }

  open(method: string, url: string): void {
    this.method = method;
    this.url = url;
  }

  setRequestHeader(name: string, value: string): void {
    this.requestHeaders[name] = value;
  }

  send(body: unknown): void {
    this.sent = body;
  }

  abort(): void {
    this.aborted = true;
  }

  /** Server sends headers, then appends text to the body. */
  receive(status: number, text: string): void {
    this.status = status;
    this.responseText += text;
    this.onprogress?.();
  }

  finish(): void {
    this.onload?.();
  }
}

const originalXhr = globalThis.XMLHttpRequest;
const passthrough = async (headers: Record<string, string>): Promise<Record<string, string>> => ({
  ...headers,
  'x-test': '1',
});

function lastXhr(): FakeXhr {
  const xhr = FakeXhr.instances.at(-1);
  assert.ok(xhr, 'expected a request to have been created');
  return xhr;
}

/** Lets the async header preparation run so the XHR exists. */
const tick = (): Promise<void> => new Promise(resolve => setImmediate(resolve));

describe('openEventStream', () => {
  beforeEach(() => {
    FakeXhr.instances = [];
    globalThis.XMLHttpRequest = FakeXhr as unknown as typeof XMLHttpRequest;
  });

  afterEach(() => {
    globalThis.XMLHttpRequest = originalXhr;
  });

  it('delivers messages incrementally before the response completes', async () => {
    const messages: string[] = [];
    const promise = openEventStream('https://example.test/stream', {
      prepareHeaders: passthrough,
      onMessage: message => messages.push(message),
    });
    await tick();
    const xhr = lastXhr();

    xhr.receive(200, 'data: one\n\ndata: tw');
    assert.deepEqual(messages, ['one']);

    xhr.receive(200, 'o\n\n');
    assert.deepEqual(messages, ['one', 'two']);

    xhr.finish();
    await promise;
    assert.equal(messages.length, 2);
  });

  it('aborts and rejects with the error when a message handler throws', async () => {
    const failure = new Error('handler failed');
    const promise = openEventStream('https://example.test/stream', {
      prepareHeaders: passthrough,
      onMessage: () => {
        throw failure;
      },
    });
    await tick();
    const xhr = lastXhr();

    xhr.receive(200, 'data: one\n\n');
    xhr.finish();

    await assert.rejects(promise, error => error === failure);
    assert.equal(xhr.aborted, true);
  });

  it('gets without a body', async () => {
    const promise = openEventStream('https://example.test/live', {
      prepareHeaders: passthrough,
      onMessage: () => {},
    });
    await tick();
    const xhr = lastXhr();
    xhr.receive(200, '');
    xhr.finish();
    await promise;

    assert.equal(xhr.method, 'GET');
    assert.equal(xhr.sent, null);
  });

  it('posts the merged headers and body', async () => {
    const promise = openEventStream('https://example.test/stream', {
      headers: { 'Content-Type': 'application/json' },
      body: '{"a":1}',
      prepareHeaders: passthrough,
      onMessage: () => {},
    });
    await tick();
    const xhr = lastXhr();
    xhr.receive(200, '');
    xhr.finish();
    await promise;

    assert.equal(xhr.method, 'POST');
    assert.equal(xhr.url, 'https://example.test/stream');
    assert.equal(xhr.sent, '{"a":1}');
    assert.deepEqual(xhr.requestHeaders, {
      'Content-Type': 'application/json',
      Accept: 'text/event-stream',
      'x-test': '1',
    });
  });

  it('sends no body unless given one', async () => {
    const promise = openEventStream('https://example.test/stream', {
      prepareHeaders: passthrough,
      onMessage: () => {},
    });
    await tick();
    const xhr = lastXhr();
    xhr.receive(200, '');
    xhr.finish();
    await promise;
    assert.equal(xhr.sent, null);
  });

  it('rejects non-2xx responses without putting the body in the message', async () => {
    const messages: string[] = [];
    const promise = openEventStream('https://example.test/stream', {
      prepareHeaders: passthrough,
      onMessage: message => messages.push(message),
    });
    await tick();
    const xhr = lastXhr();
    xhr.receive(401, 'data: secret\n\n');
    xhr.finish();

    await assert.rejects(promise, (error: unknown) => {
      assert.ok(error instanceof EventStreamHttpError);
      assert.equal(error.status, 401);
      assert.equal(error.body, 'data: secret\n\n');
      assert.equal(error.message.includes('secret'), false);
      return true;
    });
    assert.deepEqual(messages, []);
  });

  it('rejects with a network error', async () => {
    const promise = openEventStream('https://example.test/stream', {
      prepareHeaders: passthrough,
      onMessage: () => {},
    });
    await tick();
    lastXhr().onerror?.();
    await assert.rejects(promise, { message: 'Event stream network error' });
  });

  it('carries the native failure reason React Native reports as the response text', async () => {
    const promise = openEventStream('https://example.test/stream', {
      prepareHeaders: passthrough,
      onMessage: () => {},
    });
    await tick();
    const xhr = lastXhr();
    xhr.responseText = 'The certificate for this server is invalid.';
    xhr.onerror?.();
    await assert.rejects(promise, {
      message: 'Event stream network error: The certificate for this server is invalid.',
    });
  });

  it('rejects without starting a request when already aborted', async () => {
    const controller = new AbortController();
    controller.abort();
    await assert.rejects(
      openEventStream('https://example.test/stream', {
        signal: controller.signal,
        prepareHeaders: passthrough,
        onMessage: () => {},
      }),
      RequestAbortedError,
    );
    assert.equal(FakeXhr.instances.length, 0);
  });

  it('rejects without starting a request when aborted while preparing headers', async () => {
    const controller = new AbortController();
    const promise = openEventStream('https://example.test/stream', {
      signal: controller.signal,
      prepareHeaders: async headers => {
        controller.abort();
        return headers;
      },
      onMessage: () => {},
    });
    await assert.rejects(promise, RequestAbortedError);
    assert.equal(FakeXhr.instances.length, 0);
  });

  it('aborts the request mid-stream and stops delivering messages', async () => {
    const controller = new AbortController();
    const messages: string[] = [];
    const promise = openEventStream('https://example.test/stream', {
      signal: controller.signal,
      prepareHeaders: passthrough,
      onMessage: message => messages.push(message),
    });
    await tick();
    const xhr = lastXhr();
    xhr.receive(200, 'data: one\n\n');

    controller.abort();
    await assert.rejects(promise, RequestAbortedError);
    assert.equal(xhr.aborted, true);

    xhr.receive(200, 'data: late\n\n');
    xhr.finish();
    assert.deepEqual(messages, ['one']);
  });

  it('does not react to the signal after the stream has settled', async () => {
    const controller = new AbortController();
    const promise = openEventStream('https://example.test/stream', {
      signal: controller.signal,
      prepareHeaders: passthrough,
      onMessage: () => {},
    });
    await tick();
    const xhr = lastXhr();
    xhr.receive(200, '');
    xhr.finish();
    await promise;

    controller.abort();
    assert.equal(xhr.aborted, false);
  });

  it('ignores errors and further data after settling', async () => {
    const messages: string[] = [];
    const promise = openEventStream('https://example.test/stream', {
      prepareHeaders: passthrough,
      onMessage: message => messages.push(message),
    });
    await tick();
    const xhr = lastXhr();
    xhr.onerror?.();
    await assert.rejects(promise, { message: 'Event stream network error' });

    xhr.receive(200, 'data: late\n\n');
    xhr.finish();
    assert.deepEqual(messages, []);
  });
});
