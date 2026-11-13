/**
 * Server-sent events, read from a `fetch` response body.
 *
 * Why not `EventSource`: it cannot set request headers. This client's whole auth
 * contract is `getHeaders()` — `Authorization: Bearer …` for a host that uses
 * tokens — and `EventSource` would silently ignore it, leaving the stream as the
 * one endpoint a token-authenticated host cannot reach. It also can't be routed
 * through a caller's `config.fetch`, which is how a host adds `credentials:
 * 'include'` for a cross-origin dev server.
 *
 * The cost is reconnection, which `EventSource` does for free and which
 * {@link createEventsClient} therefore has to implement. Worth it: everything
 * else about this transport then obeys the same rules as every other request the
 * client makes.
 */

/** One parsed SSE frame. */
export interface SSEFrame {
  /** The `event:` field, or `message` when the server omitted it. */
  event: string;
  /** The `data:` field(s), multi-line values joined with newlines. */
  data: string;
}

/**
 * Parse one frame's worth of raw text.
 *
 * Returns null for anything carrying no data — notably keepalive comments, which
 * exist to hold the connection open and must not surface as events.
 */
function parseFrame(raw: string): SSEFrame | null {
  let event = 'message';
  const data: string[] = [];

  for (const line of raw.split('\n')) {
    // Blank line, or a comment (`: keepalive`).
    if (line === '' || line.startsWith(':')) continue;

    const colon = line.indexOf(':');
    const field = colon === -1 ? line : line.slice(0, colon);
    let value = colon === -1 ? '' : line.slice(colon + 1);
    // A single leading space after the colon is separator, not content.
    if (value.startsWith(' ')) value = value.slice(1);

    if (field === 'event') event = value;
    else if (field === 'data') data.push(value);
    // `id` and `retry` are ignored: this stream cannot replay, so a last-event-id
    // would promise a resume it could not honour. Recovery is a re-read instead.
  }

  return data.length > 0 ? { event, data: data.join('\n') } : null;
}

/**
 * Yield SSE frames from a response body until it ends or the read is aborted.
 *
 * Buffers across chunk boundaries — a frame is not obliged to arrive in one read,
 * and a large one routinely does not.
 */
export async function* readSSE(body: ReadableStream<Uint8Array>): AsyncGenerator<SSEFrame> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;

      // `stream: true` keeps a multi-byte character split across chunks intact.
      buffer += decoder.decode(value, { stream: true }).replace(/\r\n/g, '\n');

      let boundary = buffer.indexOf('\n\n');
      while (boundary !== -1) {
        const raw = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);
        const frame = parseFrame(raw);
        if (frame) yield frame;
        boundary = buffer.indexOf('\n\n');
      }
    }
  } finally {
    reader.releaseLock();
  }
}
