import type {
  AgentMessage,
  BeforeToolCallContext,
  BeforeToolCallResult,
} from "@earendil-works/pi-agent-core";
import { createLogger } from "./logger.js";

const log = createLogger("agent");

type BeforeToolCall = (
  context: BeforeToolCallContext,
  signal?: AbortSignal,
) => Promise<BeforeToolCallResult | undefined>;

type BudgetAgent = {
  beforeToolCall?: BeforeToolCall;
  steer(message: AgentMessage): void;
};

export interface ToolBudgetTracker {
  readonly calls: number;
  readonly warnAt: number;
  readonly nudgeEvery: number;
}

interface InstallToolBudgetOptions {
  sessionId: string;
  budgetScale?: number;
}

// Owner decision (2026-07-07): the budget NEVER blocks tool calls — agent
// autonomy wins. It only nudges: a first convergence warning at WARN, then a
// repeat nudge every NUDGE_EVERY calls after that, so a genuinely long
// investigation continues but a flailing one keeps being steered to converge.
const DEFAULT_WARN_AT = 120;
const DEFAULT_NUDGE_EVERY = 100;

function positiveIntFromEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export function getToolBudgetConfig(scale = 1): { warnAt: number; nudgeEvery: number } {
  const warnBase = positiveIntFromEnv("TOOL_BUDGET_WARN", DEFAULT_WARN_AT);
  const nudgeBase = positiveIntFromEnv("TOOL_BUDGET_NUDGE_EVERY", DEFAULT_NUDGE_EVERY);
  const normalizedScale = Number.isFinite(scale) && scale > 0 ? scale : 1;
  const warnAt = Math.max(1, Math.floor(warnBase * normalizedScale));
  const nudgeEvery = Math.max(1, Math.floor(nudgeBase * normalizedScale));
  return { warnAt, nudgeEvery };
}

function asSystemUserMessage(text: string): AgentMessage {
  return {
    role: "user",
    content: [{ type: "text", text: `<system>${text}</system>` }],
    timestamp: Date.now(),
  };
}

export function installToolBudget(
  agent: BudgetAgent,
  opts: InstallToolBudgetOptions,
): ToolBudgetTracker {
  const { warnAt, nudgeEvery } = getToolBudgetConfig(opts.budgetScale);
  const baseBeforeToolCall = agent.beforeToolCall;
  let calls = 0;
  let nextNudgeAt = warnAt;

  const queueSteering = (text: string): void => {
    try {
      agent.steer(asSystemUserMessage(text));
    } catch (err) {
      log.warn(`[agent] tool-budget steering failed session=${opts.sessionId}: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  agent.beforeToolCall = async (context, signal) => {
    calls += 1;
    if (calls >= nextNudgeAt) {
      log.warn(`[agent] tool-budget-nudge session=${opts.sessionId} calls=${calls}`);
      queueSteering(
        `You have made ${calls} tool calls in this run. If you are converging on an answer, continue. If you are exploring without progress, stop and summarize your findings so far, state what is missing, and give your best answer with the evidence you have.`,
      );
      nextNudgeAt = calls + nudgeEvery;
    }

    return await baseBeforeToolCall?.(context, signal);
  };

  return {
    get calls() { return calls; },
    warnAt,
    nudgeEvery,
  };
}
