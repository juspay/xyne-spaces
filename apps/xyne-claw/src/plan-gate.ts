import { jevAsk, jevEnabled, jevThreshold, type JevAnswer, type JevQuestion } from "./jev.js";
import { createLogger } from "./logger.js";
import { metric } from "./metrics.js";

const log = createLogger("plan-gate");

const MAX_TASK_CHARS = 4_000;

export type PlanGateReason = "forced" | "gate-off" | "jev" | "jev-unavailable";

export interface PlanGateDecision {
  plan: boolean;
  reason: PlanGateReason;
  probability?: number;
  ms?: number;
}

export interface PlanGateDeps {
  ask?: (state: string, questions: Record<string, JevQuestion>, opts: { timeoutMs: number; purpose: string }) => Promise<Record<string, JevAnswer> | null>;
  enabled?: () => boolean;
}

const QUESTION: JevQuestion = {
  type: "noul",
  instructions:
    "Handling this request takes real work over several steps — searching, reading, investigating, " +
    "comparing, or calling tools more than once — rather than a direct reply the agent can give " +
    "straight away, such as a greeting, a question about the agent itself, or a single quick lookup.",
};

export function planGateForced(agentConfig: Record<string, unknown> | undefined): boolean {
  return agentConfig?.["planTracking"] === "always";
}

export async function decidePlanTracking(
  task: string,
  agentConfig: Record<string, unknown> | undefined,
  deps: PlanGateDeps = {},
): Promise<PlanGateDecision> {
  if (planGateForced(agentConfig)) return { plan: true, reason: "forced" };
  if (process.env["XYNE_PLAN_GATE"]?.trim().toLowerCase() === "off") return { plan: true, reason: "gate-off" };
  const enabled = deps.enabled ?? jevEnabled;
  if (!task.trim() || !enabled()) return record({ plan: true, reason: "jev-unavailable" });

  const ask = deps.ask ?? jevAsk;
  const started = Date.now();
  const answers = await ask(
    `A user sent this request to an engineering assistant agent:\n${task.slice(0, MAX_TASK_CHARS)}`,
    { multiStep: QUESTION },
    { timeoutMs: jevThreshold("JEV_PLAN_GATE_TIMEOUT_MS", 1500), purpose: "plan-gate" },
  ).catch(() => null);
  const ms = Date.now() - started;
  const probability = answers?.["multiStep"]?.noul;
  if (typeof probability !== "number") return record({ plan: true, reason: "jev-unavailable", ms });

  const threshold = jevThreshold("JEV_PLAN_GATE_THRESHOLD", 0.5);
  return record({ plan: probability >= threshold, reason: "jev", probability, ms });
}

function record(decision: PlanGateDecision): PlanGateDecision {
  metric.count("plan_gate", { plan: String(decision.plan), reason: decision.reason });
  log.info(
    `[plan-gate] plan=${decision.plan} reason=${decision.reason}` +
      (decision.probability !== undefined ? ` p=${decision.probability.toFixed(2)}` : "") +
      (decision.ms !== undefined ? ` ms=${decision.ms}` : ""),
  );
  return decision;
}
