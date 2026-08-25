/**
 * The pre-LLM triage gate: decides whether a collected window is worth waking
 * the model for.
 *
 * This is where the cost control lives. An agent watching busy channels wakes
 * 48 times a day; most of those windows contain nothing that needs a decision.
 * Every rule here is deterministic and free — no LLM call, no extra query —
 * so a skip costs a few hundred microseconds instead of a run.
 *
 * Rules are ORDERED and the first match wins. Order encodes priority: an
 * explicit mention beats a quiet window, and the anti-starvation rule beats
 * everything so an agent that keeps skipping still checks in periodically.
 */

import type { AwakeningConfig } from "./config.js";
import type { GateOutcome, WindowSignals } from "./types.js";

export interface GateContext {
  signals: WindowSignals;
  config: AwakeningConfig;
  /** Consecutive skips BEFORE this window. Drives the anti-starvation rule. */
  consecutiveSkips: number;
}

interface Rule {
  id: string;
  evaluate: (ctx: GateContext) => "run" | "skip" | "continue";
}

const RULES: Rule[] = [
  {
    // Somebody addressed the agent directly. Always worth a run — this is the
    // one case where a human is actively waiting on it.
    id: "direct_mention",
    evaluate: ({ signals }) => (signals.mentionsOfMe > 0 ? "run" : "continue"),
  },
  {
    // Escalation language outranks volume: one "P1, who can look at this"
    // matters more than fifty chatty messages.
    id: "escalation_signal",
    evaluate: ({ signals }) => (signals.actionSignals > 0 ? "run" : "continue"),
  },
  {
    // Nothing but the agent's own posts and other bots. Waking here is how an
    // agent ends up talking to itself.
    id: "no_human_activity",
    evaluate: ({ signals }) => (signals.humanEventCount === 0 ? "skip" : "continue"),
  },
  {
    id: "below_min_human_events",
    evaluate: ({ signals, config }) =>
      signals.humanEventCount < config.gate.minHumanEvents ? "skip" : "continue",
  },
  {
    // Humans are talking and nobody has answered the last word in some thread.
    id: "unanswered_thread",
    evaluate: ({ signals }) => (signals.unansweredThreads > 0 ? "run" : "continue"),
  },
  {
    id: "open_question",
    evaluate: ({ signals }) => (signals.questions > 0 ? "run" : "continue"),
  },
  {
    // Chatter with no question, no mention, no escalation and nothing left
    // hanging. Read it next window as history instead of paying for it now.
    id: "no_actionable_signal",
    evaluate: () => "skip",
  },
];

/**
 * Anti-starvation: after N consecutive skips, run anyway. Guarantees an agent
 * with a strict gate still gets periodic situational awareness, and bounds how
 * stale its memory can become. 0 disables it.
 */
function forcedByStarvation(ctx: GateContext): boolean {
  const n = ctx.config.gate.forceRunEveryNSkips;
  return n > 0 && ctx.consecutiveSkips >= n;
}

export function evaluateGate(ctx: GateContext): GateOutcome {
  if (ctx.signals.eventCount === 0) {
    return { decision: "skip", rule: "empty_window" };
  }

  for (const rule of RULES) {
    const result = rule.evaluate(ctx);
    if (result === "run") return { decision: "run", rule: rule.id };
    if (result === "skip") {
      if (forcedByStarvation(ctx)) return { decision: "run", rule: "forced_after_skips" };
      return { decision: "skip", rule: rule.id };
    }
  }

  return forcedByStarvation(ctx)
    ? { decision: "run", rule: "forced_after_skips" }
    : { decision: "skip", rule: "no_actionable_signal" };
}

/** Rule ids, exported so tests and the admin UI can enumerate them. */
export const GATE_RULE_IDS = [
  "empty_window",
  ...RULES.map((r) => r.id),
  "forced_after_skips",
] as const;
