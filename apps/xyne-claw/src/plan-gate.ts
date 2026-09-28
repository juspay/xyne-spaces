import { closeSync, openSync, readdirSync, readSync, statSync } from "node:fs";
import path from "node:path";
import { jevAsk, jevEnabled, jevThreshold, type JevAnswer, type JevQuestion } from "./jev.js";
import { createLogger } from "./logger.js";
import { metric } from "./metrics.js";

const log = createLogger("plan-gate");

const MAX_TASK_CHARS = 4_000;
const MAX_PREVIOUS_REPLY_CHARS = 2_000;
const SESSION_TAIL_BYTES = 256 * 1024;

export type PlanGateReason = "forced" | "gate-off" | "jev" | "jev-unavailable";

export interface PlanGateDecision {
  plan: boolean;
  reason: PlanGateReason;
  probability?: number;
  ms?: number;
  withPreviousReply?: boolean;
}

export interface PlanGateDeps {
  ask?: (state: string, questions: Record<string, JevQuestion>, opts: { timeoutMs: number; purpose: string }) => Promise<Record<string, JevAnswer> | null>;
  enabled?: () => boolean;
}

const QUESTION: JevQuestion = {
  type: "noul",
  instructions:
    "Handling the user's latest message takes real work over several steps — searching, reading, " +
    "investigating, comparing, or calling tools more than once — rather than a direct reply the agent " +
    "can give straight away, such as a greeting, a question about the agent itself, or a single quick lookup.",
};

export function planGateForced(agentConfig: Record<string, unknown> | undefined): boolean {
  return agentConfig?.["planTracking"] === "always";
}

export function isShortFollowUp(task: string): boolean {
  return task.trim().length <= jevThreshold("JEV_PLAN_GATE_CONTEXT_MAX_TASK_CHARS", 200);
}

function textOf(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .filter((c): c is { type: string; text: string } => !!c && (c as { type?: unknown }).type === "text" && typeof (c as { text?: unknown }).text === "string")
    .map((c) => c.text)
    .join("\n");
}

export function readPreviousAgentReply(sessionDirPath: string): string | undefined {
  try {
    const newest = readdirSync(sessionDirPath)
      .filter((n) => n.endsWith(".jsonl"))
      .map((n) => ({ file: path.join(sessionDirPath, n), mtime: statSync(path.join(sessionDirPath, n)).mtimeMs }))
      .sort((a, b) => b.mtime - a.mtime)[0];
    if (!newest) return undefined;
    const size = statSync(newest.file).size;
    const length = Math.min(size, SESSION_TAIL_BYTES);
    const buf = Buffer.alloc(length);
    const fd = openSync(newest.file, "r");
    try {
      readSync(fd, buf, 0, length, size - length);
    } finally {
      closeSync(fd);
    }
    const lines = buf.toString("utf8").split("\n");
    for (let i = lines.length - 1; i >= 0; i--) {
      const line = lines[i]?.trim();
      if (!line || !line.includes('"assistant"')) continue;
      try {
        const entry = JSON.parse(line) as { type?: string; message?: { role?: string; content?: unknown } };
        if (entry.type !== "message" || entry.message?.role !== "assistant") continue;
        const text = textOf(entry.message.content).trim();
        if (text) return text.slice(-MAX_PREVIOUS_REPLY_CHARS);
      } catch {
        continue;
      }
    }
  } catch {
    return undefined;
  }
  return undefined;
}

export function buildGateState(task: string, previousReply?: string): string {
  const latest = task.slice(0, MAX_TASK_CHARS);
  return previousReply
    ? `An engineering assistant agent previously told the user:\n${previousReply}\n\nThe user's latest message is:\n${latest}`
    : `A user sent this request to an engineering assistant agent:\n${latest}`;
}

export async function decidePlanTracking(
  task: string,
  agentConfig: Record<string, unknown> | undefined,
  deps: PlanGateDeps = {},
  previousReply?: string,
): Promise<PlanGateDecision> {
  if (planGateForced(agentConfig)) return { plan: true, reason: "forced" };
  if (process.env["XYNE_PLAN_GATE"]?.trim().toLowerCase() === "off") return { plan: true, reason: "gate-off" };
  const enabled = deps.enabled ?? jevEnabled;
  if (!task.trim() || !enabled()) return record({ plan: true, reason: "jev-unavailable" });

  const ask = deps.ask ?? jevAsk;
  const withPreviousReply = !!previousReply;
  const started = Date.now();
  const answers = await ask(
    buildGateState(task, previousReply),
    { multiStep: QUESTION },
    { timeoutMs: jevThreshold("JEV_PLAN_GATE_TIMEOUT_MS", 1500), purpose: "plan-gate" },
  ).catch(() => null);
  const ms = Date.now() - started;
  const probability = answers?.["multiStep"]?.noul;
  if (typeof probability !== "number") return record({ plan: true, reason: "jev-unavailable", ms, withPreviousReply });

  const threshold = jevThreshold("JEV_PLAN_GATE_THRESHOLD", 0.5);
  return record({ plan: probability >= threshold, reason: "jev", probability, ms, withPreviousReply });
}

function record(decision: PlanGateDecision): PlanGateDecision {
  metric.count("plan_gate", { plan: String(decision.plan), reason: decision.reason, context: String(!!decision.withPreviousReply) });
  log.info(
    `[plan-gate] plan=${decision.plan} reason=${decision.reason}` +
      (decision.probability !== undefined ? ` p=${decision.probability.toFixed(2)}` : "") +
      (decision.withPreviousReply ? " context=previous-reply" : "") +
      (decision.ms !== undefined ? ` ms=${decision.ms}` : ""),
  );
  return decision;
}
