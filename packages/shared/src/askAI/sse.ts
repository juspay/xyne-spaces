/**
 * Platform-agnostic SSE frame parser for the Ask AI stream.
 *
 * Turns raw decoded text chunks (as they arrive off the wire) into decoded,
 * non-ping {@link AskAIStreamEvent}s. This is a faithful port of the dashboard
 * Web Worker's inline parsing loop, extracted so web and native share ONE
 * framing/JSON/heartbeat implementation.
 *
 * Behaviour (must stay identical across platforms):
 *  - Chunks are accumulated into an internal buffer; the buffer is split on
 *    "\n" and the trailing (possibly partial) segment is retained for the next
 *    push. So a `data:` line split across two network chunks is handled.
 *  - Only lines beginning with the exact prefix "data: " are considered; the
 *    JSON is `line.slice(6)`.
 *  - Non-object / null JSON is skipped.
 *  - `type: "ping"` heartbeat frames are dropped.
 *  - Malformed JSON does NOT throw; it is reported via the optional `onError`
 *    callback (the dashboard passes a console.error to preserve its old log).
 *
 * This module is pure: no `fetch`, no `TextDecoder`, no globals. The caller owns
 * byte decoding (`TextDecoder`) and the read loop, and feeds decoded strings in.
 */

import type { AskAIStreamEvent } from "./types";

/** The exact SSE field prefix the Ask AI stream uses. */
export const ASK_AI_SSE_DATA_PREFIX = "data: ";

/** A stateful, incremental SSE parser. Create one per stream. */
export interface AskAISSEParser {
  /**
   * Feed one decoded text chunk. Returns the decoded, non-ping events found in
   * completed lines within this (and any buffered previous) chunk.
   *
   * @param chunk   Decoded text off the wire.
   * @param onError Optional; called once per malformed `data:` line with the
   *                thrown error and the offending line. Never throws.
   */
  push(
    chunk: string,
    onError?: (err: unknown, line: string) => void,
  ): AskAIStreamEvent[];
}

/**
 * Create an incremental Ask AI SSE parser. Hold one instance for the lifetime of
 * a single stream and call {@link AskAISSEParser.push} for every decoded chunk.
 */
export function createAskAISSEParser(): AskAISSEParser {
  let buffer = "";

  return {
    push(
      chunk: string,
      onError?: (err: unknown, line: string) => void,
    ): AskAIStreamEvent[] {
      buffer += chunk;
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";

      const events: AskAIStreamEvent[] = [];

      for (const line of lines) {
        if (!line.startsWith(ASK_AI_SSE_DATA_PREFIX)) continue;
        try {
          const parsed: unknown = JSON.parse(
            line.slice(ASK_AI_SSE_DATA_PREFIX.length),
          );
          if (typeof parsed !== "object" || parsed === null) continue;

          const data = parsed as AskAIStreamEvent;

          // Ignore heartbeat pings sent to keep the connection alive.
          if (data.type === "ping") continue;

          events.push(data);
        } catch (err) {
          onError?.(err, line);
        }
      }

      return events;
    },
  };
}
