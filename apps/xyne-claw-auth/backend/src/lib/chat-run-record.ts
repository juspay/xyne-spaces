/**
 * Durable AgentRun bookkeeping for the two interactive chat surfaces
 * (routes/agent-chat.ts and routes/run-stream.ts).
 *
 * Both surfaces used to write the AgentRun row only AFTER a successful dispatch,
 * keyed on a sessionId the dispatch call itself minted. Everything that failed in
 * between — claw unreachable, an SSE stream that closed before `started`, a throw
 * in the pre-dispatch window, or the fire-and-forget insert simply rejecting —
 * left a conversation holding chat_messages and no run at all. Those turns were
 * invisible to GET /runs/paged, and invisible to orphan-run-finalizer too, which
 * only repairs rows that already exist. The assistant placeholder then sat at
 * "running" forever.
 *
 * The id is now minted BEFORE dispatch (prepareRun honours a caller-supplied
 * sessionId on internal runs — see lib/start-run.ts) and the row is written
 * before the wire, so a run that never starts is still a run that can be seen,
 * reported and reaped.
 *
 * Contract for callers:
 *   mintChatSessionId()  → put it in the dispatch body AND pass it to beginChatRun
 *   beginChatRun()       → AWAIT it; a turn whose run cannot be recorded must not run
 *   failChatRun()        → every exit path between begin and a terminal callback
 *   discardChatRun()     → only for deferred/lock-skip, where another run owns the turn
 */
import { randomUUID } from "node:crypto";
import { agentRunRepository, chatMessageRepository } from "../repositories/index.js";
import { redisService } from "../redis.js";
import { createLogger } from "../logger.js";
import { errMsg } from "./errors.js";

const log = createLogger("chat-run-record");

export interface BeginChatRunInput {
  sessionId: string;
  userId: string;
  agentSlug: string;
  orgId: string;
  task: string;
  conversationId: string;
}

/** Mint the session id for a chat turn. Must satisfy prepareRun's
 *  `/^[A-Za-z0-9_-]{1,128}$/` guard for internal runs, which a UUID does. */
export function mintChatSessionId(): string {
  return randomUUID();
}

function publishCc(event: Record<string, unknown>): void {
  redisService
    .getConnection()
    .publish("cc:events", JSON.stringify(event))
    .catch(() => {});
}

/**
 * Insert the run row for a chat turn, before dispatch.
 *
 * Deliberately NOT fire-and-forget: this used to be
 * `.catch((e) => log.warn(...))` at every call site, which made a lost run row
 * indistinguishable from no traffic at all. Callers await it and abort the turn
 * if it throws — telling the user their message failed is strictly better than
 * silently running a turn nothing will ever record.
 */
export async function beginChatRun(input: BeginChatRunInput): Promise<void> {
  await agentRunRepository.start({
    sessionId: input.sessionId,
    userId: input.userId,
    agentSlug: input.agentSlug,
    orgId: input.orgId,
    triggerSource: "chat",
    task: input.task,
    conversationId: input.conversationId,
  });
  publishCc({ type: "agent_start", sessionId: input.sessionId, agentSlug: input.agentSlug });
}

/**
 * Mark a pre-created run failed because the turn never reached (or never
 * returned from) the agent. Safe to call on a session that was never inserted —
 * finalize is an updateMany under the hood, so a missing row is a no-op.
 */
export async function failChatRun(sessionId: string, error: unknown): Promise<void> {
  try {
    const message = typeof error === "string" ? error : errMsg(error);
    // Guarded on status "running": a late failure path (the outer catch firing
    // after the result callback already landed) must not flip a completed run.
    const closed = await agentRunRepository.failIfRunning(sessionId, message);
    if (closed === 0) return;
    log.info(`[chat-run-record] closed un-dispatched run ${sessionId}: ${message.slice(0, 200)}`);
    publishCc({ type: "agent_done", sessionId, status: "failed" });
  } catch (err) {
    log.warn(`[chat-run-record] failChatRun(${sessionId}) failed: ${errMsg(err)}`);
  }
}

/**
 * Drop a pre-created run row entirely.
 *
 * Only for the deferred / lock-skip case: claw refused this dispatch because
 * another worker already owns the conversation, and THAT run has its own row and
 * will deliver the answer. Recording this one as "failed" would invent a failed
 * run for every duplicate dispatch and make the agent look far less reliable
 * than it is.
 */
export async function discardChatRun(sessionId: string): Promise<void> {
  try {
    await agentRunRepository.deleteBySessionId(sessionId);
    publishCc({ type: "agent_done", sessionId, status: "cancelled" });
  } catch (err) {
    log.warn(`[chat-run-record] discardChatRun(${sessionId}) failed: ${errMsg(err)}`);
  }
}

// ── Turn parts ──────────────────────────────────────────────────────────────
//
// An assistant turn as ordered parts — thinking, text and tool calls in the
// order the agent produced them — stored on ChatMessage.parts. claw builds them
// (apps/xyne-claw/src/turn-parts.ts); this side folds the live stream into them
// (the placeholder's partial parts and the /live snapshot) and stores the final
// ones. The dashboard folds the same stream with its own copy
// (packages/shared/src/ai/assistantParts.ts): change the shape or the fold in
// all three together.

export interface AssistantReasoningPart {
  type: "reasoning";
  id: string;
  text: string;
  /** ISO time the thinking started / ended — "Thought for Ns". */
  startedAt?: string;
  endedAt?: string;
}

export interface AssistantTextPart {
  type: "text";
  id: string;
  text: string;
  /** A draft the agent was asked to rewrite; kept for the record, never shown. */
  superseded?: true;
}

export interface AssistantToolPart {
  type: "tool";
  /** The invocation's toolCallId; the invocation itself stays on the AgentRun. */
  id: string;
}

export type AssistantPart = AssistantReasoningPart | AssistantTextPart | AssistantToolPart;

/** Thinking that is still open ends where the next part starts. */
function closeOpenReasoning(parts: AssistantPart[], at: string | undefined): AssistantPart[] {
  if (!at) return parts;
  const last = parts[parts.length - 1];
  if (last?.type !== "reasoning" || last.endedAt) return parts;
  return [...parts.slice(0, -1), { ...last, endedAt: at }];
}

/** Append a streamed thinking/text delta to the part it belongs to (`partId`
 *  from claw), or start one. Without a `partId` (an older claw) a new part
 *  starts whenever the type changes. Never mutates its input. */
export function applyPartDelta(
  parts: AssistantPart[],
  change: { type: "reasoning" | "text"; partId?: string | undefined; delta: string; at?: string | undefined },
): AssistantPart[] {
  if (!change.delta) return parts;
  const { type, partId, delta, at } = change;
  const index = partId ? parts.findIndex((part) => part.id === partId && part.type === type) : parts.length - 1;
  const target = index >= 0 ? parts[index] : undefined;
  if (target && target.type === type) {
    const next = parts.slice();
    next[index] = { ...target, text: target.text + delta };
    return next;
  }
  const id = partId ?? `${type}-${parts.length}`;
  const created: AssistantPart =
    type === "reasoning" ? { type, id, text: delta, ...(at ? { startedAt: at } : {}) } : { type, id, text: delta };
  return [...closeOpenReasoning(parts, at), created];
}

/** Record a tool call's place in the turn. Only top-level calls are parts; a
 *  subagent's calls nest under their parent through `parentToolCallId`. */
export function applyToolPart(
  parts: AssistantPart[],
  invocation: { toolCallId?: string | null; parentToolCallId?: string | null },
  at?: string,
): AssistantPart[] {
  const id = invocation.toolCallId;
  if (!id || invocation.parentToolCallId) return parts;
  if (parts.some((part) => part.type === "tool" && part.id === id)) return parts;
  return [...closeOpenReasoning(parts, at), { type: "tool", id }];
}

/** Every thinking block of the turn as one string — what the single
 *  `reasoning` field held before parts existed. */
export function reasoningText(parts: AssistantPart[]): string {
  return parts
    .filter((part): part is AssistantReasoningPart => part.type === "reasoning")
    .map((part) => part.text.trim())
    .filter(Boolean)
    .join("\n\n");
}

/**
 * A finished turn's parts, lined up with the answer actually stored. What
 * claw-auth adds after the model's answer (a citations section) goes onto the
 * last visible text part, so the timeline ends in exactly the stored answer.
 * Null when the stored answer does not extend the model's (it was replaced,
 * e.g. by an error notice): the message then renders from its answer alone.
 */
export function alignPartsWithAnswer(
  parts: AssistantPart[],
  modelAnswer: string,
  storedAnswer: string,
): AssistantPart[] | null {
  if (storedAnswer === modelAnswer) return parts;
  if (!storedAnswer.startsWith(modelAnswer)) return null;
  const suffix = storedAnswer.slice(modelAnswer.length);
  for (let i = parts.length - 1; i >= 0; i--) {
    const part = parts[i]!;
    if (part.type === "text" && !part.superseded) {
      const next = parts.slice();
      next[i] = { ...part, text: part.text + suffix };
      return next;
    }
  }
  return [...parts, { type: "text", id: "final", text: storedAnswer }];
}

const MAX_PARTS = 2000;

/** Keep only well-formed parts — for parts read back from storage or the
 *  wire. Null when there are none. */
export function normalizeAssistantParts(value: unknown): AssistantPart[] | null {
  if (!Array.isArray(value)) return null;
  const parts: AssistantPart[] = [];
  for (const raw of value.slice(0, MAX_PARTS)) {
    if (!raw || typeof raw !== "object") continue;
    const part = raw as Record<string, unknown>;
    const id = typeof part["id"] === "string" ? part["id"] : null;
    if (!id) continue;
    if (part["type"] === "tool") {
      parts.push({ type: "tool", id });
    } else if (part["type"] === "text" && typeof part["text"] === "string") {
      parts.push({ type: "text", id, text: part["text"], ...(part["superseded"] === true ? { superseded: true as const } : {}) });
    } else if (part["type"] === "reasoning" && typeof part["text"] === "string") {
      const startedAt = typeof part["startedAt"] === "string" ? part["startedAt"] : undefined;
      const endedAt = typeof part["endedAt"] === "string" ? part["endedAt"] : undefined;
      parts.push({ type: "reasoning", id, text: part["text"], ...(startedAt ? { startedAt } : {}), ...(endedAt ? { endedAt } : {}) });
    }
  }
  return parts.length > 0 ? parts : null;
}

// ── Plan part ───────────────────────────────────────────────────────────────
//
// The agent's plan (the todo checklist streamed as `plan` events) is stored in
// the same ChatMessage.parts array as ONE extra element `{ type: "plan" }`, so a
// reload can redraw the plan card. It is deliberately NOT a member of the
// AssistantPart union: normalizeAssistantParts drops it, so every timeline
// reader (dashboard, live snapshot, fork) keeps behaving exactly as before, and
// only planPartOf() reads it back. A row whose parts hold ONLY a plan
// normalizes to null and renders from its answer + reasoning as it always did.

export type PlanTodoStatus = "pending" | "in_progress" | "completed" | "failed" | "stopped";

export interface PlanTodoRecord {
  id?: string;
  title: string;
  status: PlanTodoStatus;
}

export interface AssistantPlanPart {
  type: "plan";
  id: "plan";
  title?: string;
  todos: PlanTodoRecord[];
}

/** What ChatMessage.parts may hold: the timeline parts plus at most one plan. */
export type StoredTurnPart = AssistantPart | AssistantPlanPart;

const PLAN_TODO_STATUSES = new Set<string>(["pending", "in_progress", "completed", "failed", "stopped"]);
const MAX_PLAN_TODOS = 200;

/** A well-formed plan part from raw `todos` (+ optional title), or null. */
export function toPlanPart(todos: unknown, title?: unknown): AssistantPlanPart | null {
  if (!Array.isArray(todos)) return null;
  const clean: PlanTodoRecord[] = [];
  for (const raw of todos.slice(0, MAX_PLAN_TODOS)) {
    if (!raw || typeof raw !== "object") continue;
    const todo = raw as Record<string, unknown>;
    if (typeof todo["title"] !== "string" || !todo["title"]) continue;
    const status = typeof todo["status"] === "string" && PLAN_TODO_STATUSES.has(todo["status"])
      ? (todo["status"] as PlanTodoStatus)
      : "pending";
    clean.push({ ...(typeof todo["id"] === "string" ? { id: todo["id"] } : {}), title: todo["title"], status });
  }
  if (clean.length === 0) return null;
  return { type: "plan", id: "plan", ...(typeof title === "string" && title ? { title } : {}), todos: clean };
}

/** The plan stored in a row's raw `parts` value, or null. */
export function planPartOf(value: unknown): AssistantPlanPart | null {
  if (!Array.isArray(value)) return null;
  for (let i = value.length - 1; i >= 0; i--) {
    const raw = value[i] as Record<string, unknown> | null;
    if (raw && typeof raw === "object" && raw["type"] === "plan") return toPlanPart(raw["todos"], raw["title"]);
  }
  return null;
}

/** A run that ended without completing (stopped / failed) leaves no item
 *  "in progress": those become "stopped". Untouched when nothing is open. */
export function stopOpenPlanTodos(plan: AssistantPlanPart): AssistantPlanPart {
  if (!plan.todos.some((todo) => todo.status === "in_progress")) return plan;
  return { ...plan, todos: plan.todos.map((todo) => (todo.status === "in_progress" ? { ...todo, status: "stopped" as const } : todo)) };
}

/**
 * What a finished turn stores besides its answer.
 *
 * A completed run whose claw sent `parts` stores them — lined up so the last
 * text part ends in exactly the stored answer — and no separate `reasoning`
 * (readers fill it from the parts). Anything else (a failure, a stop, an older
 * claw pod, a local-harness run) stores no parts and the run's whole thinking
 * as `reasoning`: from the callback, else from the parts the live stream
 * accumulated on the placeholder. That renders exactly as such turns always did.
 */
export async function finalTurnFields(args: {
  status: "completed" | "failed" | "cancelled";
  /** The model's answer as claw delivered it. */
  modelAnswer: string;
  /** The answer being stored (claw-auth may append to it). */
  storedAnswer: string;
  callbackParts: unknown;
  callbackReasoning: unknown;
  assistantMessageId?: string | undefined;
}): Promise<{ parts: StoredTurnPart[] | null; reasoning?: string }> {
  // The placeholder's partial parts: the run's plan lives only there (claw's
  // callback parts never carry it), and they are the thinking fallback below.
  let partialRaw: unknown = null;
  let partialRead = false;
  const readPartial = async (): Promise<unknown> => {
    if (!partialRead && args.assistantMessageId) {
      partialRead = true;
      partialRaw = await chatMessageRepository.partialParts(args.assistantMessageId).catch(() => null);
    }
    return partialRaw;
  };
  const storedPlan = args.assistantMessageId ? planPartOf(await readPartial()) : null;
  const plan = storedPlan && args.status !== "completed" ? stopOpenPlanTodos(storedPlan) : storedPlan;

  const parts = args.status === "completed" ? normalizeAssistantParts(args.callbackParts) : null;
  const aligned = parts ? alignPartsWithAnswer(parts, args.modelAnswer, args.storedAnswer) : null;
  if (aligned) return { parts: plan ? [...aligned, plan] : aligned };

  let reasoning = typeof args.callbackReasoning === "string" ? args.callbackReasoning.trim() : "";
  if (!reasoning) {
    const partial = normalizeAssistantParts(await readPartial());
    if (partial) reasoning = reasoningText(partial);
  }
  // A plan alone normalizes to no parts, so the turn still renders from its
  // answer + reasoning — the plan card is the only thing it adds.
  return { parts: plan ? [plan] : null, ...(reasoning ? { reasoning } : {}) };
}