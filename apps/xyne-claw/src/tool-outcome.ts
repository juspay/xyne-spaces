/**
 * What happened to each tool call, as one metric (XYNE-66597):
 *
 *   [metric] name=tool_call_outcome outcome=<ok|not_found|validation|blocked|aborted|error>
 *            validation_kind=<missing|type|enum|structure|none> tool=… model=…
 *
 * AgentRun.toolInvocations only says isError; this splits a rejected call
 * (wrong name, bad arguments, blocked by a hook) from a tool that ran and
 * failed, per tool and model.
 *
 * Also installs the honest error flag: claw's own tools report a failure as
 * text starting "Error:" and return normally, so pi marks the call as a
 * success. `installHonestErrorFlag` sets isError on those results (and on a
 * result whose details say `failed: true`) — MCP tools are left alone, their
 * text is the upstream server's data.
 */
import type {
  AfterToolCallContext,
  AfterToolCallResult,
  BeforeToolCallContext,
  BeforeToolCallResult,
} from "@earendil-works/pi-agent-core";
import { metric } from "./metrics.js";

export type ToolCallOutcome = "ok" | "not_found" | "validation" | "blocked" | "aborted" | "error";
export type ValidationKind = "missing" | "type" | "enum" | "structure" | "none";

function resultText(result: unknown): string {
  const content = (result as { content?: unknown } | undefined)?.content;
  if (!Array.isArray(content)) return typeof result === "string" ? result : "";
  for (const block of content) {
    const b = block as { type?: unknown; text?: unknown };
    if (b && b.type === "text" && typeof b.text === "string") return b.text;
  }
  return "";
}

/** Which kind of schema problem a pi validation message reports. */
export function validationKind(text: string): ValidationKind {
  if (/must have required propert/i.test(text)) return "missing";
  if (/must be equal to one of the allowed values|must be equal to constant/i.test(text)) return "enum";
  if (/must be (string|number|integer|boolean|array|object|null)\b/i.test(text)) return "type";
  return "structure";
}

/** Exported for tests. */
export function classifyToolOutcome(event: { isError?: boolean; result?: unknown }, blocked: boolean): {
  outcome: ToolCallOutcome;
  validationKind: ValidationKind;
} {
  if (!event.isError) return { outcome: "ok", validationKind: "none" };
  if (blocked) return { outcome: "blocked", validationKind: "none" };
  const text = resultText(event.result).trimStart();
  if (/^Tool \S+ not found/.test(text)) return { outcome: "not_found", validationKind: "none" };
  if (/^Validation failed for tool/.test(text)) return { outcome: "validation", validationKind: validationKind(text) };
  if (/^Operation aborted/.test(text)) return { outcome: "aborted", validationKind: "none" };
  return { outcome: "error", validationKind: "none" };
}

interface HookedAgent {
  beforeToolCall?: ((ctx: BeforeToolCallContext, signal?: AbortSignal) => Promise<BeforeToolCallResult | undefined>) | undefined;
  afterToolCall?: ((ctx: AfterToolCallContext, signal?: AbortSignal) => Promise<AfterToolCallResult | undefined>) | undefined;
}

/**
 * Count one metric per finished tool call. Install AFTER every other
 * beforeToolCall hook so a block from any of them is seen. Returns the
 * recorder for the run's tool_execution_end handler.
 */
export function installToolOutcomeMetric(
  agent: HookedAgent,
  labels: () => { model: string; agent?: string | undefined },
): (event: { toolCallId: string; toolName: string; isError?: boolean; result?: unknown }) => void {
  const blockedIds = new Set<string>();
  const prior = agent.beforeToolCall;
  if (prior) {
    agent.beforeToolCall = async (ctx, signal) => {
      const result = await prior(ctx, signal);
      if (result?.block) blockedIds.add(ctx.toolCall.id);
      return result;
    };
  }
  return (event) => {
    const blocked = blockedIds.delete(event.toolCallId);
    const { outcome, validationKind: kind } = classifyToolOutcome(event, blocked);
    const { model, agent: agentSlug } = labels();
    metric.count("tool_call_outcome", {
      outcome,
      validation_kind: kind,
      tool: event.toolName,
      model,
      ...(agentSlug ? { agent: agentSlug } : {}),
    });
  };
}

/** True for a claw-written failure: "Error: …" text, or details.failed. Exported for tests. */
export function isReportedFailure(result: unknown): boolean {
  const details = (result as { details?: unknown } | undefined)?.details;
  if (details && typeof details === "object" && (details as Record<string, unknown>)["failed"] === true) return true;
  return /^Error:/.test(resultText(result).trimStart());
}

export function installHonestErrorFlag(agent: HookedAgent, isMcpTool: (name: string) => boolean): void {
  const prior = agent.afterToolCall;
  agent.afterToolCall = async (ctx, signal) => {
    const fromPrior = prior ? await prior(ctx, signal) : undefined;
    const isError = fromPrior?.isError ?? ctx.isError;
    if (isError || isMcpTool(ctx.toolCall.name) || !isReportedFailure(ctx.result)) return fromPrior;
    return { ...(fromPrior ?? {}), isError: true };
  };
}
