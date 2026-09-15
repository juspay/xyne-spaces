// Consume an SSE stream from claw and dispatch each event to a per-caller
// handler. This is the single point of contact for the new claw → claw-auth
// transport — used today by run-stream.ts, and shaped so the webhook and
// agent-chat flows can migrate by supplying the same dispatch logic they run
// in their current `/progress` handlers.
//
// Contract guarantees:
//   - Frames arrive in seq order (TCP), and we surface the seq so callers can
//     hard-fail on a gap if they want strict no-loss semantics.
//   - The consumer never blocks the agent loop: each handler is fire-and-forget
//     from the parser's perspective. If a handler throws, we log and continue
//     so a single bad event doesn't kill the whole stream.
//   - On close (normal `done`, network error, or AbortSignal), we resolve with
//     the final `done` payload if we got one, else reject so the caller can
//     decide whether to mark the run failed.
//
// Auth: same `x-s2s-key` header that the legacy POST path uses. No handshake.

import { Agent } from "undici";
import { errMsg } from "./errors.js";
import { ClawSseParser, type ClawStreamEvent, type ClawDoneStatus, type Todo, type UiWidget } from "xyne-claw-shared";

// An SSE run goes silent between frames while the model composes; undici's
// default 300s bodyTimeout severs the socket mid-stream ("terminated"). Every
// claw-auth → claw streaming fetch must use this dispatcher. connectTimeout
// stays so a dead engine still fails fast.
export const streamDispatcher = new Agent({ headersTimeout: 0, bodyTimeout: 0, connectTimeout: 10_000 });

export interface ClawStreamHandlers {
  onStarted?: (sessionId: string) => void | Promise<void>;
  onInvocation?: (sessionId: string, toolInvocation: unknown) => void | Promise<void>;
  onReasoning?: (sessionId: string, delta: string) => void | Promise<void>;
  onTextDelta?: (sessionId: string, delta: string) => void | Promise<void>;
  onAttachment?: (sessionId: string, attachment: Extract<ClawStreamEvent, { event: "attachment" }>["attachment"]) => void | Promise<void>;
  onSandboxPreview?: (sessionId: string, payload: Extract<ClawStreamEvent, { event: "sandbox-preview" }>["payload"]) => void | Promise<void>;
  onPlan?: (sessionId: string, todos: Todo[]) => void | Promise<void>;
  onPr?: (sessionId: string, pr: Extract<ClawStreamEvent, { event: "pr" }>["pr"]) => void | Promise<void>;
  onUiWidget?: (sessionId: string, widget: UiWidget) => void | Promise<void>;
  onProgressLabel?: (sessionId: string, payload: Extract<ClawStreamEvent, { event: "progress-label" }>["payload"]) => void | Promise<void>;
  onDebug?: (sessionId: string, debugEvent: unknown) => void | Promise<void>;
  onCancelled?: (sessionId: string, reason: string | undefined) => void | Promise<void>;
  /** A terminal `error` frame. The /internal/run proxy injects one of these
   *  (carrying the real ECONNRESET / body-timeout / pod-death reason) when the
   *  upstream claw stream breaks, then still closes the response cleanly — so
   *  without an explicit handler the failure reason is silently discarded and
   *  the stream just looks like it "ended without a done frame". */
  onError?: (sessionId: string | undefined, error: string) => void | Promise<void>;
  /** Called for every frame regardless of type — useful for seq tracking /
   *  drop detection / observability sinks that want everything. */
  onAny?: (event: ClawStreamEvent) => void;
}

export interface ConsumeClawStreamOptions {
  url: string;
  body: Record<string, unknown>;
  s2sKey?: string | undefined;
  extraHeaders?: Record<string, string>;
  handlers: ClawStreamHandlers;
  signal?: AbortSignal;
  /** Emitted when the consumer detects a sequence gap (received seq is not
   *  the expected next value). Default: log and continue. Override to fail
   *  the run hard if your caller needs strict ordering. */
  onSeqGap?: (expected: number, got: number) => void;
}

export interface ConsumeClawStreamResult {
  /** The `done` payload from claw. Undefined if the stream closed without
   *  emitting `done` (network error, abort, or claw crashed). */
  result: ClawDoneStatus | undefined;
  /** Total events received, including non-data frames. */
  eventCount: number;
  /** Highest seq observed. -1 if no frames arrived. */
  lastSeq: number;
  /** The reason from a terminal `error` frame, if one arrived before EOF (the
   *  real transport/lifecycle failure the /internal/run proxy injects). This is
   *  what lets a missing-`done` close be reported with its actual cause instead
   *  of the generic "ended without a done frame". Undefined if no error frame. */
  errorReason: string | undefined;
  /** The `event` name of the last frame parsed before EOF. Lets a caller tell
   *  "ended right after started" from "ended after an error frame" from "ended
   *  mid-delta" without re-plumbing every event. Undefined if no frames. */
  lastEventName: string | undefined;
}

export async function consumeClawStream(opts: ConsumeClawStreamOptions): Promise<ConsumeClawStreamResult> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Accept: "text/event-stream",
    ...(opts.s2sKey ? { "x-s2s-key": opts.s2sKey } : {}),
    ...(opts.extraHeaders ?? {}),
  };

  const fetchInit = {
    method: "POST",
    headers,
    body: JSON.stringify(opts.body),
    // `dispatcher` is an undici extension not in the DOM RequestInit type.
    dispatcher: streamDispatcher,
    ...(opts.signal ? { signal: opts.signal } : {}),
  } as unknown as RequestInit;

  const response = await fetch(opts.url, fetchInit);
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`Claw SSE upstream returned ${response.status}: ${text.slice(0, 500)}`);
  }
  if (!response.body) {
    throw new Error("Claw SSE response has no body");
  }

  return consumeAlreadyOpenStream(response.body as ReadableStream<Uint8Array>, opts.handlers, opts.onSeqGap);
}

// Consume an already-open SSE body stream. Used when the caller already has
// a Response in hand (e.g. the proxy did a probe fetch and wants to hand the
// same body to a background bridge) — saves a second roundtrip to claw.
export async function consumeAlreadyOpenStream(
  body: ReadableStream<Uint8Array>,
  handlers: ClawStreamHandlers,
  onSeqGap?: (expected: number, got: number) => void,
): Promise<ConsumeClawStreamResult> {
  const parser = new ClawSseParser();
  const decoder = new TextDecoder("utf-8");
  let eventCount = 0;
  let lastSeq = -1;
  let expectedSeq = 0;
  let result: ClawDoneStatus | undefined;
  let errorReason: string | undefined;
  let lastEventName: string | undefined;

  const reader = body.getReader();
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      const text = decoder.decode(value, { stream: true });
      const events = parser.feed(text);
      for (const event of events) {
        eventCount++;
        if (typeof event.seq === "number") {
          if (event.seq !== expectedSeq && onSeqGap) {
            try { onSeqGap(expectedSeq, event.seq); } catch { /* swallow */ }
          }
          lastSeq = event.seq;
          expectedSeq = event.seq + 1;
        }
        lastEventName = event.event;
        try { handlers.onAny?.(event); } catch (err) { logHandlerError("onAny", err); }
        await dispatch(event, handlers);
        if (event.event === "done") {
          result = event.result;
        } else if (event.event === "error") {
          errorReason = event.error;
        }
      }
    }
  } finally {
    try { reader.releaseLock(); } catch { /* ignore */ }
  }

  return { result, eventCount, lastSeq, errorReason, lastEventName };
}

async function dispatch(event: ClawStreamEvent, handlers: ClawStreamHandlers): Promise<void> {
  try {
    switch (event.event) {
      case "started":
        await handlers.onStarted?.(event.sessionId);
        return;
      case "invocation":
        await handlers.onInvocation?.(event.sessionId, event.toolInvocation);
        return;
      case "reasoning":
        await handlers.onReasoning?.(event.sessionId, event.reasoningDelta);
        return;
      case "delta":
        await handlers.onTextDelta?.(event.sessionId, event.textDelta);
        return;
      case "attachment":
        await handlers.onAttachment?.(event.sessionId, event.attachment);
        return;
      case "sandbox-preview":
        await handlers.onSandboxPreview?.(event.sessionId, event.payload);
        return;
      case "plan":
        await handlers.onPlan?.(event.sessionId, event.todos);
        return;
      case "pr":
        await handlers.onPr?.(event.sessionId, event.pr);
        return;
      case "ui-widget":
        await handlers.onUiWidget?.(event.sessionId, event.widget);
        return;
      case "progress-label":
        await handlers.onProgressLabel?.(event.sessionId, event.payload);
        return;
      case "debug":
        await handlers.onDebug?.(event.sessionId, event.debugEvent);
        return;
      case "cancelled":
        await handlers.onCancelled?.(event.sessionId, event.reason);
        return;
      case "error":
        await handlers.onError?.(event.sessionId, event.error);
        return;
      case "done":
        return;
    }
  } catch (err) {
    logHandlerError(event.event, err);
  }
}

function logHandlerError(eventName: string, err: unknown): void {
  console.warn(`[consume-claw-stream] handler for "${eventName}" threw: ${errMsg(err)}`);
}

// ── SSE-to-legacy-POSTs bridge ─────────────────────────────────────────────
//
// Used by the /internal/run proxy when the caller did NOT request SSE itself
// (i.e. it's webhook.ts / agent-chat.ts / flow-action.ts / chain-workflows.ts /
// flow-action.ts / scheduled-jobs-worker / run-recovery-worker). The proxy
// still opens SSE to claw (so the wire from claw-auth → claw is unified) and
// this helper translates each SSE frame back into the JSON POST body the
// caller's legacy /progress handler already understands. ZERO caller-side
// changes: their /webhook/progress, /internal/agent-chat/.../progress, etc.,
// keep getting the exact same shapes they got from claw's old fire-and-forget
// POSTs — only the order is now guaranteed (TCP-serial via the SSE consumer's
// awaited dispatch).

export interface BridgeOptions {
  /** Full URL to claw's /run (NOT through the proxy — the actual port-3002 host). */
  url: string;
  /** Forward body — sessionId, sessionToken, task, etc. */
  body: Record<string, unknown>;
  /** S2S key for claw + the caller's progress/callback endpoints. */
  s2sKey?: string | undefined;
  /** Caller-supplied progress endpoint. Per-event POSTs land here. */
  progressUrl?: string | undefined;
  /** Caller-supplied final-result endpoint. The `done` SSE event POSTs here. */
  callbackUrl?: string | undefined;
  /** Logging tag — surfaces which caller this bridge belongs to. */
  tag?: string;
  /** Abort to tear down the upstream consumer. */
  signal?: AbortSignal;
}

export async function bridgeClawSseToLegacyPosts(opts: BridgeOptions): Promise<void> {
  const tag = opts.tag ?? "claw-bridge";
  const sid = (opts.body["sessionId"] as string | undefined) ?? "?";

  const sharedHeaders: Record<string, string> = {
    "Content-Type": "application/json",
    ...(opts.s2sKey ? { "x-s2s-key": opts.s2sKey } : {}),
  };

  // Per-event POSTs are serial (the SSE consumer awaits each handler) so the
  // legacy receiver sees events in the exact same order they were produced —
  // which is the whole point of the SSE migration.
  const postProgress = async (body: Record<string, unknown>): Promise<void> => {
    if (!opts.progressUrl) return;
    try {
      await fetch(opts.progressUrl, {
        method: "POST",
        headers: sharedHeaders,
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(15_000),
      });
    } catch (err) {
      console.warn(`[${tag}] progress POST failed (session=${sid}): ${errMsg(err)}`);
    }
  };

  try {
    const result = await consumeClawStream({
      url: opts.url,
      body: opts.body,
      ...(opts.s2sKey ? { s2sKey: opts.s2sKey } : {}),
      ...(opts.signal ? { signal: opts.signal } : {}),
      handlers: {
        onInvocation: async (sessionId, toolInvocation) => {
          await postProgress({ sessionId, toolInvocation });
        },
        onReasoning: async (sessionId, reasoningDelta) => {
          await postProgress({ sessionId, reasoningDelta });
        },
        onTextDelta: async (sessionId, textDelta) => {
          await postProgress({ sessionId, textDelta });
        },
        onAttachment: async (sessionId, attachment) => {
          await postProgress({ sessionId, attachment });
        },
        onSandboxPreview: async (sessionId, payload) => {
          await postProgress({ sessionId, ...payload });
        },
        onPlan: async (sessionId, todos) => {
          await postProgress({ sessionId, kind: "plan", todos });
        },
        onPr: async (sessionId, pr) => {
          await postProgress({ sessionId, kind: "pr", pr });
        },
        onUiWidget: async (sessionId, widget) => {
          await postProgress({ sessionId, kind: "ui-widget", widget });
        },
        onProgressLabel: async (sessionId, payload) => {
          await postProgress({ sessionId, ...payload });
        },
        onDebug: async (sessionId, debugEvent) => {
          await postProgress({ sessionId, debugEvent });
        },
      },
    });

    // Final result → POST to callbackUrl verbatim. The done payload IS the
    // legacy sendCallback body claw's run.ts built — userId, conversationId,
    // agentSlug, toolsUsed, tokenUsage, provider, model, etc. — and consumers
    // depend on every field. We tried filtering once; it silently broke
    // Spaces summarize replies and the typing animation.
    if (opts.callbackUrl && result.result) {
      try {
        await fetch(opts.callbackUrl, {
          method: "POST",
          headers: sharedHeaders,
          body: JSON.stringify({ ...result.result, sessionId: sid }),
        });
      } catch (err) {
        console.warn(`[${tag}] callback POST failed (session=${sid}): ${errMsg(err)}`);
      }
    }
  } catch (err) {
    console.error(`[${tag}] bridge failed (session=${sid}): ${errMsg(err)}`);
    // Surface failure to the caller as a final callback POST so their run
    // tracker doesn't hang in "running" forever. Matches the failure-callback
    // claw's catch handler would have sent in the legacy path.
    if (opts.callbackUrl) {
      try {
        await fetch(opts.callbackUrl, {
          method: "POST",
          headers: sharedHeaders,
          body: JSON.stringify({
            sessionId: sid,
            status: "failed",
            error: err instanceof Error ? err.message : "SSE bridge failed",
          }),
        });
      } catch { /* exhausted */ }
    }
  }
}
