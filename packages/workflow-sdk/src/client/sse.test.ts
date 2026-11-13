import { describe, it, expect } from 'vitest';
import { readSSE } from './sse.js';
import type { SSEFrame } from './sse.js';

/** A response body delivering exactly these chunks, in order. */
function streamOf(...chunks: Array<string | Uint8Array>): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(typeof chunk === 'string' ? encoder.encode(chunk) : chunk);
      }
      controller.close();
    },
  });
}

async function collect(stream: ReadableStream<Uint8Array>): Promise<SSEFrame[]> {
  const frames: SSEFrame[] = [];
  for await (const frame of readSSE(stream)) frames.push(frame);
  return frames;
}

describe('readSSE', () => {
  it('parses a named frame', async () => {
    const frames = await collect(streamOf('event: ready\ndata: {"ok":true}\n\n'));
    expect(frames).toEqual([{ event: 'ready', data: '{"ok":true}' }]);
  });

  it('defaults the event name to `message` when the server omits it', async () => {
    const frames = await collect(streamOf('data: hello\n\n'));
    expect(frames).toEqual([{ event: 'message', data: 'hello' }]);
  });

  it('parses several frames from one chunk', async () => {
    const frames = await collect(streamOf('event: a\ndata: 1\n\nevent: b\ndata: 2\n\n'));
    expect(frames.map((f) => f.event)).toEqual(['a', 'b']);
  });

  it('reassembles a frame split across chunk boundaries', async () => {
    // The boundary falls mid-field, mid-value and mid-terminator in turn.
    const frames = await collect(streamOf('eve', 'nt: rea', 'dy\nda', 'ta: {"ok":true}\n', '\n'));
    expect(frames).toEqual([{ event: 'ready', data: '{"ok":true}' }]);
  });

  it('reassembles a multi-byte character split across chunks', async () => {
    const encoded = new TextEncoder().encode('data: café\n\n');
    // Split inside the two-byte é.
    const cut = encoded.length - 4;
    const frames = await collect(streamOf(encoded.slice(0, cut), encoded.slice(cut)));
    expect(frames).toEqual([{ event: 'message', data: 'café' }]);
  });

  it('joins repeated data fields with newlines, per the SSE spec', async () => {
    const frames = await collect(streamOf('data: line one\ndata: line two\n\n'));
    expect(frames[0]?.data).toBe('line one\nline two');
  });

  it('drops keepalive comments rather than surfacing them as events', async () => {
    const frames = await collect(streamOf(': keepalive\n\ndata: real\n\n'));
    expect(frames).toEqual([{ event: 'message', data: 'real' }]);
  });

  it('drops a frame that carries no data', async () => {
    const frames = await collect(streamOf('event: lonely\n\ndata: real\n\n'));
    expect(frames).toEqual([{ event: 'message', data: 'real' }]);
  });

  it('strips exactly one space after the colon', async () => {
    const frames = await collect(streamOf('data:  two spaces\n\n'));
    expect(frames[0]?.data).toBe(' two spaces');
  });

  it('accepts CRLF line endings', async () => {
    const frames = await collect(streamOf('event: ready\r\ndata: {"ok":true}\r\n\r\n'));
    expect(frames).toEqual([{ event: 'ready', data: '{"ok":true}' }]);
  });

  it('ignores a trailing partial frame when the stream ends mid-message', async () => {
    const frames = await collect(streamOf('data: complete\n\ndata: truncated'));
    expect(frames).toEqual([{ event: 'message', data: 'complete' }]);
  });
});
