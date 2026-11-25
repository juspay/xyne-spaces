/**
 * Per-call LLM usage ledger. Every provider call reports the usage the provider
 * returned to claw-auth (/internal/llm-usage), tagged with the run and purpose
 * from the async scope. Calls that end without provider usage are reported as
 * usage-unknown, never estimated.
 */

import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";
import { streamSimple, type Api, type AssistantMessage, type Context, type Model, type SimpleStreamOptions } from "@earendil-works/pi-ai";
import { SERVER } from "./config.js";
import { createLogger } from "./logger.js";

const log = createLogger("llm-usage");

export type LlmCallPurpose =
  | "main" | "subagent" | "compaction" | "title" | "follow_up" | "judge" | "verify" | "prefetch" | "twin_gate"
  | "curator" | "entity" | "routing" | "video" | "triage" | "probe" | "prompt_tools" | "eval" | "xor";

export type BillingBasis = "platform" | "api_key" | "subscription";

export interface UsageScope {
  runId?: string | undefined;
  userId?: string | undefined;
  agentSlug?: string | undefined;
  conversationId?: string | undefined;
  ticketId?: string | undefined;
  /** Only when nothing above resolves the org (agent-level helpers). */
  orgId?: string | undefined;
  /** The run's claude credential is a subscription OAuth token, not an API key. */
  claudeOauth?: boolean | undefined;
}

export interface LlmCallEvent {
  id: string;
  runId?: string;
  userId?: string;
  agentSlug?: string;
  conversationId?: string;
  ticketId?: string;
  orgId?: string;
  purpose: LlmCallPurpose;
  subagent?: string;
  outcome: "ok" | "error" | "aborted";
  provider: string;
  billing: BillingBasis;
  model: string;
  servedModel?: string;
  serviceTier?: string;
  usageReported: boolean;
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  toolNames?: string[];
  responseId?: string;
  startedAt: string;
  durationMs: number;
}

const scopeStore = new AsyncLocalStorage<UsageScope>();

const defined = <T extends object>(o: T): Partial<T> =>
  Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined && v !== null && v !== "")) as Partial<T>;

/** Runs fn with scope merged over the current one, so nested runs and side calls inherit it. */
export function withUsageScope<T>(scope: UsageScope, fn: () => T): T {
  return scopeStore.run({ ...scopeStore.getStore(), ...defined(scope) }, fn);
}

function currentUsageScope(): UsageScope {
  return scopeStore.getStore() ?? {};
}

/** Maps the pi provider name resolveModel registered to the claw provider key and who pays. */
export function billingFor(piProvider: string, claudeOauth: boolean): { provider: string; billing: BillingBasis } {
  switch (piProvider) {
    case "litellm": return { provider: "spaces", billing: "platform" };
    case "litellm-user": return { provider: "litellm", billing: "api_key" };
    case "anthropic-user": return { provider: "claude", billing: claudeOauth ? "subscription" : "api_key" };
    case "openai-user": return { provider: "codex", billing: "api_key" };
    case "openai-codex-user": return { provider: "codex", billing: "subscription" };
    case "copilot-user": return { provider: "copilot", billing: "subscription" };
    default: return { provider: piProvider || "unknown", billing: "api_key" };
  }
}

/** Tools whose results arrived since the last assistant message: what this call reads first. */
export function toolNamesSinceLastReply(context: Context | undefined): string[] {
  const messages = context?.messages ?? [];
  const names: string[] = [];
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i]!;
    if (m.role === "assistant") break;
    if (m.role === "toolResult" && !names.includes(m.toolName)) names.unshift(m.toolName);
  }
  return names;
}

export interface PiCallLabels {
  purpose?: LlmCallPurpose | undefined;
  subagent?: string | undefined;
  claudeOauth?: boolean | undefined;
  serviceTier?: string | undefined;
}

/** pi's built-in compaction reuses the agent's streamFn; its summarizer prompt is the only marker. */
export const PI_SUMMARIZER_PROMPT_START = "You are a context summarization assistant.";

/** One pi call: `result` is the final assistant message (error/aborted ones carry what usage arrived). */
export function recordPiCall(args: { model: Model<Api>; context?: Context | undefined; result: AssistantMessage | undefined; startedAt: number; labels?: PiCallLabels | undefined }): void {
  const { model, result, labels } = args;
  const scope = currentUsageScope();
  const u = result?.usage;
  const tokens = { input: u?.input ?? 0, output: u?.output ?? 0, cacheRead: u?.cacheRead ?? 0, cacheWrite: u?.cacheWrite ?? 0 };
  const { provider, billing } = billingFor(model.provider, labels?.claudeOauth ?? scope.claudeOauth ?? false);
  const served = result?.responseModel ?? (result?.model && result.model !== model.id ? result.model : undefined);
  enqueue({
    ...eventScope(scope),
    purpose: args.context?.systemPrompt?.startsWith(PI_SUMMARIZER_PROMPT_START) ? "compaction" : labels?.purpose ?? "main",
    ...(labels?.subagent ? { subagent: labels.subagent } : {}),
    outcome: !result || result.stopReason === "error" ? "error" : result.stopReason === "aborted" ? "aborted" : "ok",
    provider,
    billing,
    model: model.id,
    ...(served ? { servedModel: served } : {}),
    ...(labels?.serviceTier && labels.serviceTier !== "standard" ? { serviceTier: labels.serviceTier } : {}),
    usageReported: tokens.input + tokens.output + tokens.cacheRead + tokens.cacheWrite > 0,
    ...tokens,
    toolNames: toolNamesSinceLastReply(args.context),
    ...(result?.responseId ? { responseId: result.responseId } : {}),
    startedAt: new Date(args.startedAt).toISOString(),
    durationMs: Math.max(0, Date.now() - args.startedAt),
  });
}

/** A pi streamFn that records its calls; for code that calls pi directly (compaction). */
export function recordingStreamFn(labels: PiCallLabels) {
  return (model: Model<Api>, context: Context, options?: SimpleStreamOptions) => {
    const startedAt = Date.now();
    const stream = streamSimple(model, context, options);
    stream.result().then(
      (result) => recordPiCall({ model, context, result, startedAt, labels }),
      () => recordPiCall({ model, context, result: undefined, startedAt, labels }),
    );
    return stream;
  };
}

interface ChatCompletionUsage {
  prompt_tokens?: number;
  completion_tokens?: number;
  prompt_tokens_details?: { cached_tokens?: number; cache_write_tokens?: number } | null;
  prompt_cache_hit_tokens?: number;
}

/**
 * One raw OpenAI-format /chat/completions response (side calls on the platform
 * LiteLLM key unless told otherwise). Token split mirrors pi-ai's
 * openai-completions parser so side calls and agent calls agree.
 */
export function recordChatCompletion(
  purpose: LlmCallPurpose,
  model: unknown,
  json: unknown,
  opts: { startedAt?: number; provider?: string; billing?: BillingBasis } = {},
): void {
  try {
    const body = (json ?? {}) as { usage?: ChatCompletionUsage | null; model?: unknown; id?: unknown };
    const u = body.usage ?? undefined;
    const prompt = u?.prompt_tokens ?? 0;
    const cacheRead = u?.prompt_tokens_details?.cached_tokens ?? u?.prompt_cache_hit_tokens ?? 0;
    const cacheWrite = u?.prompt_tokens_details?.cache_write_tokens ?? 0;
    const tokens = { input: Math.max(0, prompt - cacheRead - cacheWrite), output: u?.completion_tokens ?? 0, cacheRead, cacheWrite };
    const startedAt = opts.startedAt ?? Date.now();
    const requested = typeof model === "string" && model ? model : typeof body.model === "string" ? body.model : "unknown";
    enqueue({
      ...eventScope(currentUsageScope()),
      purpose,
      outcome: "ok",
      provider: opts.provider ?? "spaces",
      billing: opts.billing ?? "platform",
      model: requested,
      ...(typeof body.model === "string" && body.model !== requested ? { servedModel: body.model } : {}),
      usageReported: tokens.input + tokens.output + tokens.cacheRead + tokens.cacheWrite > 0,
      ...tokens,
      ...(typeof body.id === "string" ? { responseId: body.id } : {}),
      startedAt: new Date(startedAt).toISOString(),
      durationMs: Math.max(0, Date.now() - startedAt),
    });
  } catch (err) {
    log.warn(`could not record ${purpose} call: ${String(err)}`);
  }
}

function eventScope(s: UsageScope): Pick<LlmCallEvent, "id" | "runId" | "userId" | "agentSlug" | "conversationId" | "ticketId" | "orgId"> {
  const { claudeOauth: _ignored, ...ids } = s;
  return { id: randomUUID(), ...(defined(ids) as Omit<UsageScope, "claudeOauth">) } as LlmCallEvent;
}

/**
 * Scopes every request to the caller it is for: claw-auth's x-usage-* headers when
 * it sends any (so a body it forwards cannot name another run or org), else the
 * identity fields most claw endpoints already carry in the body.
 */
export function usageScopeMiddleware(req: { headers: Record<string, unknown>; body?: unknown }, _res: unknown, next: () => void): void {
  const fromHeaders = Object.keys(req.headers).some((h) => h.startsWith("x-usage-"));
  const body = (!fromHeaders && req.body && typeof req.body === "object" ? req.body : {}) as Record<string, unknown>;
  const pick = (header: string, field: string): string | undefined => {
    const h = req.headers[header];
    const v = typeof h === "string" && h ? h : body[field];
    return typeof v === "string" && v.length > 0 && v.length <= 200 ? v : undefined;
  };
  withUsageScope(
    {
      runId: pick("x-usage-run-id", "sessionId"),
      userId: pick("x-usage-user-id", "userId"),
      agentSlug: pick("x-usage-agent-slug", "agentSlug"),
      conversationId: pick("x-usage-conversation-id", "conversationId"),
      orgId: pick("x-usage-org-id", "orgId"),
    },
    next,
  );
}

const BATCH = 200;
const MAX_QUEUE = 50_000;
const MAX_BACKOFF_MS = 30_000;
const queue: LlmCallEvent[] = [];
let timer: NodeJS.Timeout | undefined;
let inFlight: Promise<void> | undefined;
let backoffMs = 0;
let overflowed = 0;

type Sender = (events: LlmCallEvent[]) => Promise<void>;

const postToAuth: Sender = async (events) => {
  const res = await fetch(`${SERVER.authServiceUrl.replace(/\/+$/, "")}/claw/api/v1/internal/llm-usage`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(SERVER.s2sKey ? { "x-s2s-key": SERVER.s2sKey } : {}) },
    body: JSON.stringify({ events }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
};

let sender: Sender | null = process.env["VITEST"] ? null : postToAuth;

/** Tests swap delivery; null keeps events queued. */
export function setLlmUsageSender(next: Sender | null): void {
  sender = next;
}

export function pendingLlmUsage(): readonly LlmCallEvent[] {
  return queue;
}

function enqueue(e: LlmCallEvent): void {
  queue.push(e);
  if (queue.length > MAX_QUEUE) {
    queue.shift();
    if (++overflowed % 1000 === 1) log.error(`queue full, dropped ${overflowed} oldest call(s)`);
  }
  schedule(backoffMs || 250);
}

function schedule(delayMs: number): void {
  if (timer || inFlight || !sender) return;
  timer = setTimeout(() => {
    timer = undefined;
    void flushOnce();
  }, delayMs);
  timer.unref?.();
}

function flushOnce(): Promise<void> {
  if (inFlight || !sender || queue.length === 0) return inFlight ?? Promise.resolve();
  const batch = queue.splice(0, BATCH);
  const send = sender;
  inFlight = send(batch)
    .then(() => {
      backoffMs = 0;
    })
    .catch((err: unknown) => {
      queue.unshift(...batch);
      backoffMs = Math.min(MAX_BACKOFF_MS, backoffMs ? backoffMs * 2 : 1000);
      log.warn(`report failed (${String(err)}); ${queue.length} call(s) queued, retry in ${backoffMs}ms`);
    })
    .finally(() => {
      inFlight = undefined;
      if (queue.length > 0) schedule(backoffMs || 0);
    });
  return inFlight;
}

/** Drains the queue (bounded); called on shutdown so in-memory calls are not lost. */
export async function flushLlmUsage(timeoutMs = 5_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  if (timer) {
    clearTimeout(timer);
    timer = undefined;
  }
  while ((queue.length > 0 || inFlight) && Date.now() < deadline && sender) {
    const before = queue.length;
    await flushOnce();
    if (queue.length >= before && backoffMs > 0) await new Promise((r) => setTimeout(r, Math.min(backoffMs, Math.max(0, deadline - Date.now()))));
  }
}
