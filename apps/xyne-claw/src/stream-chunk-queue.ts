/**
 * Ordered delivery of streamed text and reasoning deltas to an HTTP progress
 * endpoint.
 *
 * Each delta used to go out as its own fire-and-forget POST. A fast model sends
 * well over a thousand reasoning deltas in a turn, so many POSTs were in flight
 * at once, and the endpoint saw them in arrival order, not send order: the
 * reasoning on screen read "Let me- parse:" and "given directly in in message
 * the". The answer text has far fewer deltas, so it rarely showed it.
 *
 * Here one POST per destination and session is out at a time. Deltas that
 * arrive while it is out are joined and go together in the next one, so a fast
 * model costs a handful of POSTs in flight rather than hundreds, and the text
 * arrives in the order it was produced.
 */

export interface StreamChunkPayload {
  reasoningDelta?: string;
  textDelta?: string;
}

export interface OutgoingStreamChunk {
  sessionId: string;
  reasoningDelta?: string;
  textDelta?: string;
}

interface ChunkQueue {
  reasoningDelta: string;
  textDelta: string;
  inFlight: boolean;
}

export interface ChunkSender {
  push(destination: string, sessionId: string, payload: StreamChunkPayload): void;
}

/**
 * `post` delivers one body; it must never throw synchronously and its rejection
 * is swallowed, so a failed or slow POST only delays what came after it.
 */
export function createChunkSender(
  post: (destination: string, body: OutgoingStreamChunk) => Promise<unknown>,
): ChunkSender {
  const queues = new Map<string, ChunkQueue>();

  const flush = async (destination: string, key: string, queue: ChunkQueue): Promise<void> => {
    queue.inFlight = true;
    try {
      while (queue.reasoningDelta || queue.textDelta) {
        const body: OutgoingStreamChunk = { sessionId: key.slice(destination.length + 1) };
        if (queue.reasoningDelta) body.reasoningDelta = queue.reasoningDelta;
        if (queue.textDelta) body.textDelta = queue.textDelta;
        queue.reasoningDelta = "";
        queue.textDelta = "";
        await post(destination, body).catch(() => {
          // Best-effort — the next batch still goes.
        });
      }
    } finally {
      queue.inFlight = false;
      // Nothing pending (checked just above, and nothing ran in between), so the
      // session's queue can go until the next delta.
      if (queues.get(key) === queue) queues.delete(key);
    }
  };

  return {
    push(destination, sessionId, payload) {
      if (!payload.reasoningDelta && !payload.textDelta) return;
      const key = `${destination}\n${sessionId}`;
      let queue = queues.get(key);
      if (!queue) {
        queue = { reasoningDelta: "", textDelta: "", inFlight: false };
        queues.set(key, queue);
      }
      if (payload.reasoningDelta) queue.reasoningDelta += payload.reasoningDelta;
      if (payload.textDelta) queue.textDelta += payload.textDelta;
      if (!queue.inFlight) void flush(destination, key, queue);
    },
  };
}
