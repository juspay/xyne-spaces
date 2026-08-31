import type { Todo } from "../flow/plan-flow.js";
import type { UiWidget } from "../types/ui-widget.js";

// Wire contract for the claw → claw-auth streaming channel.
//
// Today claw POSTs each chunk to a `progressUrl` on claw-auth. The migration
// keeps a single SSE response open instead, framing each event below as one
// SSE message. The legacy POST path still produces the same logical events —
// it just maps them to per-chunk HTTP requests.
//
// Both sides import these types. Adding a new event variant breaks compile
// at every dispatch site, which is the point.

export interface ClawAttachmentPayload {
  fileName: string;
  mimeType: string;
  data: string;
  metadata?: Record<string, unknown>;
}

export interface ClawStreamMeta {
  conversationId?: string | null;
  agentSlug?: string | null;
}

export interface ClawSandboxPreviewPayload extends ClawStreamMeta {
  sandboxId: string;
  sandboxPreviewUrl: string;
  sandboxCodePreviewUrl: string;
}

export interface ClawProgressLabelPayload extends ClawStreamMeta {
  toolLabel: string;
}

// The `done` payload is the legacy sendCallback body verbatim. We do NOT
// filter to a known subset — many downstream consumers (e.g. /webhook/result)
// read fields like userId, conversationId, agentSlug, toolsUsed, tokenUsage,
// provider, model, reasoning, latency, pendingResponses, pendingGoalSuggestion
// for session-context fallback lookup, Control Center finalize, digital-twin
// suffix append, etc. Filtering on the wire silently breaks those consumers.
//
// `status` stays typed so the consumer's status branching is type-safe; every
// other field flows through unconstrained.
export type ClawDoneStatus = {
  status: "completed" | "failed" | "cancelled";
} & Record<string, unknown>;

// Discriminated union. `seq` is monotonically increasing per session — used
// to detect drops on the consumer side and to replay after a reconnect if we
// ever add Last-Event-ID support.
export type ClawStreamEvent =
  | { event: "started";         seq: number; sessionId: string }
  | { event: "invocation";      seq: number; sessionId: string; toolInvocation: unknown; toolLabel?: string | undefined; meta?: ClawStreamMeta | undefined }
  | { event: "reasoning";       seq: number; sessionId: string; reasoningDelta: string }
  | { event: "delta";           seq: number; sessionId: string; textDelta: string }
  | { event: "attachment";      seq: number; sessionId: string; attachment: ClawAttachmentPayload }
  | { event: "sandbox-preview"; seq: number; sessionId: string; payload: ClawSandboxPreviewPayload }
  /** @deprecated Rolling-deploy compatibility for claw pods predating ui-widget. */
  | { event: "plan";            seq: number; sessionId: string; todos: Todo[] }
  | { event: "pr";              seq: number; sessionId: string; pr: Record<string, unknown> }
  | { event: "ui-widget";       seq: number; sessionId: string; widget: UiWidget }
  | { event: "progress-label";  seq: number; sessionId: string; payload: ClawProgressLabelPayload }
  | { event: "debug";           seq: number; sessionId: string; debugEvent: unknown }
  | { event: "cancelled";       seq: number; sessionId: string; reason?: string | undefined }
  | { event: "done";            seq: number; sessionId: string; result: ClawDoneStatus }
  | { event: "error";           seq: number; sessionId: string; error: string };

export type ClawStreamEventName = ClawStreamEvent["event"];

// SSE keepalive — sent as a comment line, ignored by the spec-compliant
// parser. Used so we get a periodic byte on the wire to detect dead
// connections and to keep middleboxes from idling the TCP socket.
export const KEEPALIVE_FRAME = ": keepalive\n\n";

// Produces a complete SSE message:
//   event: <name>\n
//   data: <json>\n
//   \n
// The blank line is the message terminator per the spec.
export function frameSseEvent(event: ClawStreamEvent): string {
  const { event: name, ...rest } = event;
  return `event: ${name}\ndata: ${JSON.stringify(rest)}\n\n`;
}

// Streaming SSE parser. Pass it raw chunks of bytes (or strings); it
// accumulates a buffer, slices off complete messages at the blank-line
// delimiter, JSON-parses the data line, and yields typed events.
//
// Intentionally minimal — no Last-Event-ID, no retry directive, no
// multi-line data fields. We're consuming streams we produce, so the parser
// only has to handle what `frameSseEvent` emits.
export class ClawSseParser {
  private buffer = "";

  feed(chunk: string): ClawStreamEvent[] {
    this.buffer += chunk;
    const out: ClawStreamEvent[] = [];
    let idx: number;
    while ((idx = this.buffer.indexOf("\n\n")) !== -1) {
      const block = this.buffer.slice(0, idx);
      this.buffer = this.buffer.slice(idx + 2);
      const parsed = parseBlock(block);
      if (parsed) out.push(parsed);
    }
    return out;
  }

  // For shutdown — surfaces any half-buffered bytes for logging.
  remainder(): string {
    const rest = this.buffer;
    this.buffer = "";
    return rest;
  }
}

function parseBlock(block: string): ClawStreamEvent | null {
  if (block.startsWith(":")) return null;
  let eventName: string | null = null;
  let dataLine: string | null = null;
  for (const line of block.split("\n")) {
    if (line.startsWith("event:")) {
      eventName = line.slice(6).trim();
    } else if (line.startsWith("data:")) {
      const piece = line.slice(5).trim();
      dataLine = dataLine === null ? piece : `${dataLine}\n${piece}`;
    }
  }
  if (!eventName || dataLine === null) return null;
  try {
    const data = JSON.parse(dataLine) as Record<string, unknown>;
    return { event: eventName, ...data } as ClawStreamEvent;
  } catch {
    return null;
  }
}
