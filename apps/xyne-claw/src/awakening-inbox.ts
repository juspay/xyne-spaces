/**
 * Live event injection for awakened runs — the claw side.
 *
 * While an awakened agent is working, new events keep arriving in the channels
 * it watches. Once enough pile up, claw-auth queues them; this module pulls
 * them into the running session so the agent adapts mid-task instead of
 * finishing on stale input.
 *
 * WHY PULL, NOT PUSH. claw is horizontally scaled and a session lives in ONE
 * pod's memory (`activeRuns` is an in-process Map), so an inbound push would
 * have to be routed to that exact pod — pod discovery that breaks whenever the
 * fleet scales. Pull costs nothing to avoid it, because the SDK delivers a
 * steering message only "after the current assistant turn finishes executing
 * its tool calls" (pi-agent-core types.d.ts). A pushed steer and a pulled steer
 * therefore arrive at the SAME instant — the next turn boundary. Identical
 * latency, no routing, and the pod that owns the run is the one asking.
 *
 * The poll rides `beforeToolCall`, the same hook installToolBudget uses to
 * steer convergence nudges (see tool-budget.ts) — a proven in-production
 * pattern rather than new machinery on the turn loop.
 */

import type { AgentMessage, BeforeToolCallContext, BeforeToolCallResult } from "@earendil-works/pi-agent-core";
import { SERVER } from "./config.js";
import { createLogger } from "./logger.js";

const log = createLogger("awakening-inbox");

type BeforeToolCall = (
  context: BeforeToolCallContext,
  signal?: AbortSignal,
) => Promise<BeforeToolCallResult | undefined>;

type InjectableAgent = {
  beforeToolCall?: BeforeToolCall;
  steer(message: AgentMessage): void;
};

interface InboxBatch {
  ordinal: number;
  eventCount: number;
  text: string;
  isFinal: boolean;
}

export interface AwakeningInboxOptions {
  sessionId: string;
  /** Floor between polls, so a tool-heavy turn does not hammer claw-auth. */
  pollIntervalMs?: number;
}

const DEFAULT_POLL_INTERVAL_MS = Number(process.env["AWAKENING_INBOX_POLL_MS"] ?? 20_000);
const DRAIN_TIMEOUT_MS = Number(process.env["AWAKENING_INBOX_TIMEOUT_MS"] ?? 5_000);

/**
 * Wrap injected text so the model can tell it apart from its own task input.
 * Mirrors the `<system>` convention tool-budget.ts already uses for steering.
 */
function asInjectionMessage(text: string): AgentMessage {
  return {
    role: "user",
    content: [{ type: "text", text: `<system>${text}</system>` }],
    timestamp: Date.now(),
  };
}

async function drain(sessionId: string): Promise<InboxBatch[]> {
  if (!SERVER.s2sKey) return [];
  const base = SERVER.authServiceUrl.replace(/\/$/, "");
  const url = `${base}/claw/api/v1/awakening/inbox/${encodeURIComponent(sessionId)}/drain`;

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-s2s-key": SERVER.s2sKey },
    signal: AbortSignal.timeout(DRAIN_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`drain returned HTTP ${res.status}`);

  const body = (await res.json()) as { success?: boolean; batches?: InboxBatch[] };
  return Array.isArray(body.batches) ? body.batches : [];
}

export interface AwakeningInboxTracker {
  readonly injected: number;
  /**
   * Force a poll now. Nothing calls this on the normal path: a steer is only
   * consumed at a turn boundary, and the last turn boundary a run has is the
   * one that precedes its final tool call — which the hook below already
   * covers. Kept for callers that drive the session themselves.
   */
  poll: () => Promise<number>;
}

/**
 * Install the poller on an awakened run.
 *
 * FAIL-OPEN throughout: a failed drain is logged and the run continues. Live
 * injection is an enhancement, and a Redis or claw-auth blip must never be able
 * to break a run that is otherwise working. Undelivered events are not lost:
 * claw-auth's result callback rolls its reflex watermark back over any batch
 * this run was handed but never drained, so the next check re-counts them.
 */
export function installAwakeningInbox(
  agent: InjectableAgent,
  opts: AwakeningInboxOptions,
): AwakeningInboxTracker {
  const pollIntervalMs = opts.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
  const baseBeforeToolCall = agent.beforeToolCall;
  const seen = new Set<number>();
  let injected = 0;
  let lastPollMs = 0;
  let inFlight: Promise<number> | null = null;

  const pollOnce = async (): Promise<number> => {
    lastPollMs = Date.now();
    let batches: InboxBatch[];
    try {
      batches = await drain(opts.sessionId);
    } catch (err) {
      log.warn(
        `[awakening] inbox drain failed session=${opts.sessionId}: ${err instanceof Error ? err.message : String(err)}`,
      );
      return 0;
    }

    let delivered = 0;
    for (const batch of batches) {
      // The drain is destructive, so a duplicate ordinal means a retry
      // re-delivered something already steered in. Steering it twice would
      // read to the model as two separate bursts of the same events.
      if (seen.has(batch.ordinal)) continue;
      seen.add(batch.ordinal);
      try {
        agent.steer(asInjectionMessage(batch.text));
        injected++;
        delivered++;
        log.info(
          `[awakening] injected batch=${batch.ordinal} events=${batch.eventCount} session=${opts.sessionId}${batch.isFinal ? " (final)" : ""}`,
        );
      } catch (err) {
        log.warn(`[awakening] steer failed session=${opts.sessionId}: ${err instanceof Error ? err.message : err}`);
      }
    }
    return delivered;
  };

  agent.beforeToolCall = async (context, signal) => {
    if (Date.now() - lastPollMs >= pollIntervalMs && !inFlight) {
      // Deliberately NOT awaited: a tool call must not wait on the inbox. The
      // steered message lands at the next turn boundary either way, which is
      // the earliest the SDK would deliver it even if we blocked here.
      inFlight = pollOnce().finally(() => {
        inFlight = null;
      });
      inFlight.catch(() => undefined);
    }
    return await baseBeforeToolCall?.(context, signal);
  };

  return {
    get injected() {
      return injected;
    },
    poll: pollOnce,
  };
}
