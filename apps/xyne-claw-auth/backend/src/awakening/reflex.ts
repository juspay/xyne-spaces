/**
 * The reflex check: has enough happened to be worth reacting to RIGHT NOW?
 *
 * Runs far more often than a heartbeat but costs far less. It does not collect
 * a window — it asks Spaces for a COUNT of events since the reflex watermark
 * and compares that to a threshold. A `count` operation returns a scalar, so
 * the check is one cheap query however busy the channels are, and the
 * expensive collect only happens once the threshold is actually crossed.
 *
 * Three outcomes:
 *   below threshold  → do nothing, check again next interval
 *   threshold + free → dispatch a reflex run
 *   threshold + busy → the agent is already awake; route the new events to the
 *                      running session's inbox instead of starting a second
 *                      run (requirement 6 — the agent adapts mid-task)
 */

import { boundedInteract } from "./spaces-read.js";
import type { AgentSpacesIdentity, ResolvedChannel } from "./types.js";
import type { AwakeningConfig } from "./config.js";
import { createLogger } from "../logger.js";

const log = createLogger("awakening-reflex");

/** Conversation prefilter cap for the count path. */
const COUNT_THREAD_CAP = 500;

/**
 * Count events in the watched channels since `sinceMs`.
 *
 * Two stages, like the collector, because Message has no channelId: find the
 * threads a watched channel touched, then count their messages in the window.
 * Messages from the agent itself are NOT excluded here — that is done by the
 * collector when the window is actually built. This count is a trigger signal,
 * not a decision; over-counting slightly costs one extra cheap check, while the
 * loop guard that really matters lives in the gate.
 */
export async function countEventsSince(
  channels: ResolvedChannel[],
  sinceMs: number,
  untilMs: number,
  identity: AgentSpacesIdentity,
): Promise<number> {
  if (channels.length === 0) return 0;
  const auth = { token: identity.appToken, workspaceId: identity.workspaceId };

  const conversations = await boundedInteract<Array<{ conversationId: string }>>(
    {
      model: "conversation",
      operation: "findMany",
      where: {
        channelId: { in: channels.map((c) => c.id) },
        lastActivityAt: { gte: new Date(sinceMs).toISOString() },
      },
      orderBy: [{ lastActivityAt: "desc" }],
      take: COUNT_THREAD_CAP,
    },
    auth,
  );
  if (conversations.length === 0) return 0;

  const count = await boundedInteract<number>(
    {
      model: "message",
      operation: "count",
      where: {
        conversationId: { in: conversations.map((c) => c.conversationId) },
        createdAt: { gt: new Date(sinceMs).toISOString(), lte: new Date(untilMs).toISOString() },
        isDeleted: { equals: false },
        // Exclude the agent's own posts from the TRIGGER count. Without this an
        // agent that replies to N threads re-triggers itself on its own output,
        // which is the classic way this feature becomes an infinite loop.
        senderId: { not: identity.spacesAppUserId },
      },
      take: 1,
    },
    auth,
  );

  return typeof count === "number" ? count : 0;
}

export type ReflexDecision =
  | { action: "wait"; count: number }
  | { action: "fire"; count: number }
  | { action: "inject"; count: number; sessionId: string }
  | { action: "hold"; count: number; reason: string };

export interface ReflexContext {
  count: number;
  config: AwakeningConfig;
  /** sessionId of a run already in flight for this agent, if any. */
  busyWithSessionId: string | null;
  /** ms since the last reflex dispatch; Infinity when there has never been one. */
  sinceLastRunMs: number;
  /** Injections already delivered to the in-flight session. */
  injectionsUsed: number;
  /** ms since the last injection into that session; Infinity when none. */
  sinceLastInjectionMs: number;
}

/**
 * Pure decision function — no I/O, so every branch is table-testable.
 */
export function decideReflex(ctx: ReflexContext): ReflexDecision {
  const { count, config, busyWithSessionId } = ctx;
  const { threshold, minIntervalMs, injectEnabled, injectThreshold, maxInjectionsPerSession, injectMinIntervalMs } =
    config.reflex;

  if (busyWithSessionId) {
    // The agent is already awake. Never start a second run — feed this one.
    if (!injectEnabled) return { action: "hold", count, reason: "injection_disabled" };
    if (count < injectThreshold) return { action: "wait", count };
    if (ctx.injectionsUsed >= maxInjectionsPerSession) {
      return { action: "hold", count, reason: "injection_cap_reached" };
    }
    if (ctx.sinceLastInjectionMs < injectMinIntervalMs) {
      return { action: "hold", count, reason: "injection_min_interval" };
    }
    return { action: "inject", count, sessionId: busyWithSessionId };
  }

  if (count < threshold) return { action: "wait", count };
  if (ctx.sinceLastRunMs < minIntervalMs) return { action: "hold", count, reason: "min_interval" };
  return { action: "fire", count };
}

/** Render an injection batch for the model. */
export function renderInjection(
  ordinal: number,
  eventCount: number,
  remaining: number,
  outline: string[],
): string {
  const lines = [
    `[Live update ${ordinal} — ${eventCount} new event(s) arrived while you were working]`,
    "",
    ...outline,
    "",
  ];

  if (remaining <= 0) {
    lines.push(
      "This is the LAST live update you will get for this run. Anything that arrives after it",
      "will be handled by a later wake, so finish on what you have rather than waiting for more.",
    );
  } else {
    lines.push(`You may receive up to ${remaining} more live update(s) in this run.`);
  }

  lines.push(
    "",
    "Adapt if this changes what you were about to do. If it does not, carry on —",
    "you do not need to acknowledge this update.",
  );
  return lines.join("\n");
}

export function logDecision(agentSlug: string, decision: ReflexDecision, busy = false): void {
  // A "wait" while the agent is BUSY is the live-injection path accumulating,
  // and it is the state operators most often need to see when asking "why did
  // my mid-run events not arrive?". A "wait" while idle is the steady state and
  // stays silent — it happens every check interval, for every agent.
  if (decision.action === "wait") {
    if (busy) {
      log.info(`[awakening] reflex agent=${agentSlug} action=wait events=${decision.count} (run in flight — below injectThreshold)`);
    }
    return;
  }
  log.info(
    `[awakening] reflex agent=${agentSlug} action=${decision.action} events=${decision.count}` +
      ("reason" in decision ? ` reason=${decision.reason}` : ""),
  );
}
