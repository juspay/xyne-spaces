import { prisma } from "../db.js";
import { redisService } from "../redis.js";
import { userProviderCredentialsRepository } from "../repositories/index.js";
import { CONFIG } from "../config.js";
import { createLogger } from "../logger.js";
import { setSession } from "./session-context.js";
import { resolveProvidersForDispatch } from "./provider-resolution.js";

const log = createLogger("eval-run");

export const EVAL_POLL_MS = 10_000;
export const EVAL_DEADLINE_MS = Math.max(60_000, Number(process.env["EVAL_DEADLINE_MS"]) || 900_000);
export const EVAL_MAX_PROVIDERS = Math.max(1, Number(process.env["EVAL_MAX_PROVIDERS"]) || 6);

const TERMINAL = new Set(["completed", "failed", "cancelled"]);

export const PLATFORM_DEFAULT_PROVIDER = process.env["EVAL_DEFAULT_PROVIDER"] ?? "litellm";

export const EVAL_JUDGES = ["llm", "jev", "ournormaljev", "ourtrainedjev"] as const;
export type EvalJudge = (typeof EVAL_JUDGES)[number];

export interface EvalTarget {
  provider: string;
  model?: string | undefined;
  useOverride: boolean;
  /** Judge backend for sift/compaction/completeness on this arm. */
  judge?: EvalJudge | undefined;
  /** Optimization switch spec for this arm, e.g. "none", "all", "all,-jev_compaction". */
  optimizations?: string | undefined;
}

const OPTIMIZATIONS_SPEC = /^[a-z0-9_,+\-]{1,400}$/i;

export function normalizeOptimizationArms(requested: string[] | undefined): string[] {
  return [...new Set((requested ?? []).filter((arm) => OPTIMIZATIONS_SPEC.test(arm)))];
}

export function normalizeJudges(requested: string[] | undefined): EvalJudge[] {
  if (!requested?.length) return [];
  if (requested.includes("all")) return [...EVAL_JUDGES];
  const alias: Record<string, EvalJudge> = {
    llm: "llm",
    jev: "jev",
    ournormaljev: "ournormaljev",
    ourtrainedjev: "ourtrainedjev",
    normal: "ournormaljev",
    trained: "ourtrainedjev",
  };
  const out: EvalJudge[] = [];
  for (const raw of requested) {
    const judge = alias[raw];
    if (judge && !out.includes(judge)) out.push(judge);
  }
  return out;
}

export function armKey(target: EvalTarget): string {
  return [target.provider, target.judge, target.optimizations?.replace(/[^a-z0-9]+/gi, "_")]
    .filter(Boolean)
    .join("-");
}

export function armLabel(target: {
  provider: string;
  judge?: string | undefined;
  optimizations?: string | undefined;
}): string {
  return [
    target.judge ? `${target.provider} + ${target.judge}` : target.provider,
    target.optimizations ? `opts:${target.optimizations}` : "",
  ].filter(Boolean).join(" · ");
}

const PERSONAL_CRED_PROVIDERS = ["claude", "codex", "copilot"] as const;
const AGENT_CRED_PROVIDERS = ["litellm", "spaces"] as const;

export interface EvalDispatch extends EvalTarget {
  sessionId: string;
  /** piSessionConversationId for this arm — the debug store is keyed by it. */
  sessionKey: string;
  traceId: string;
}

export interface EvalResult extends EvalTarget {
  sessionId: string;
  sessionKey: string;
  traceId: string;
  /** The answer the arm produced, for side-by-side reading. */
  answer: string | null;
  /** Set when the run did not execute on the provider it was pinned to. */
  requested?: string | undefined;
  status: string;
  totalMs: number | null;
  llmTotalMs: number | null;
  toolMs: number | null;
  ttftMs: number | null;
  tokensIn: number | null;
  tokensOut: number | null;
  tokensCacheRead: number | null;
  tokensPerSec: number | null;
  error: string | null;
}

export interface EvalState {
  id: string;
  question: string;
  startedAt: string;
  deadlineAt: string;
  channelId: string;
  conversationId: string;
  agentSlug: string;
  spacesAppUserId: string;
  appToken: string;
  dispatches: EvalDispatch[];
}

const EVAL_STATE_PREFIX = "eval:pending:";
const EVAL_STATE_SET = "eval:pending";
const EVAL_STATE_TTL = 24 * 60 * 60;

export async function saveEvalState(state: EvalState): Promise<void> {
  const redis = redisService.getConnection();
  await redis.set(`${EVAL_STATE_PREFIX}${state.id}`, JSON.stringify(state), "EX", EVAL_STATE_TTL);
  await redis.sadd(EVAL_STATE_SET, state.id);
}

export async function listPendingEvals(): Promise<EvalState[]> {
  const redis = redisService.getConnection();
  const ids = await redis.smembers(EVAL_STATE_SET).catch(() => [] as string[]);
  const out: EvalState[] = [];
  for (const id of ids) {
    const raw = await redis.get(`${EVAL_STATE_PREFIX}${id}`).catch(() => null);
    if (!raw) {
      await redis.srem(EVAL_STATE_SET, id).catch(() => 0);
      continue;
    }
    try {
      out.push(JSON.parse(raw) as EvalState);
    } catch {
      await redis.srem(EVAL_STATE_SET, id).catch(() => 0);
    }
  }
  return out;
}

export async function clearEvalState(id: string): Promise<void> {
  const redis = redisService.getConnection();
  await redis.del(`${EVAL_STATE_PREFIX}${id}`).catch(() => 0);
  await redis.srem(EVAL_STATE_SET, id).catch(() => 0);
}

/** One pod posts the comparison. Losers skip rather than double-post. */
export async function claimEvalFinalize(id: string): Promise<boolean> {
  const redis = redisService.getConnection();
  const won = await redis
    .set(`eval:finalizing:${id}`, "1", "EX", 120, "NX")
    .catch(() => "OK" as const);
  return won === "OK";
}

export async function resolveEvalTargets(input: {
  userId: string;
  agent: { id?: string; orgId?: string | null; slug: string };
  agentRow?: { id?: string; config?: unknown } | null;
  conversationId?: string | undefined;
  requested?: string[];
  judges?: string[];
  opts?: string[];
  /** Skip credentialed providers the agent has no config for — a pin to one is dropped at dispatch. */
  onlyConfigured?: boolean;
}): Promise<EvalTarget[]> {
  const resolution = await resolveProvidersForDispatch({
    targetUserId: input.userId,
    agent: input.agent,
    ...(input.agentRow ? { agentRow: input.agentRow } : {}),
    ...(input.conversationId ? { conversationId: input.conversationId } : {}),
  });

  const targets: EvalTarget[] = [];
  const claimed = new Set<string>();

  // Pin every arm, the agent's own primary included. Without an override a run
  // walks the agent's fallback order, so a "claude" arm can quietly execute on
  // codex and the comparison comes out mislabelled. Overrides also clear the
  // order, so a pinned arm cannot drift mid-run.
  const defaultProvider = resolution.resolvedParentProvider ?? PLATFORM_DEFAULT_PROVIDER;
  const defaultModel = (resolution.providerConfigs?.[defaultProvider] as { model?: string } | undefined)?.model;
  targets.push({
    provider: defaultProvider,
    useOverride: true,
    ...(defaultModel ? { model: defaultModel } : {}),
  });
  claimed.add(defaultProvider);

  for (const provider of AGENT_CRED_PROVIDERS) {
    if (claimed.has(provider)) continue;
    if (input.onlyConfigured && provider !== "spaces" && !resolution.providerConfigs?.[provider]) continue;
    claimed.add(provider);
    const model = (resolution.providerConfigs?.[provider] as { model?: string } | undefined)?.model;
    targets.push({ provider, useOverride: true, ...(model ? { model } : {}) });
  }

  const personal = await Promise.all(
    PERSONAL_CRED_PROVIDERS.filter((p) => !claimed.has(p)).map(async (provider) => {
      if (resolution.providerConfigs?.[provider]) return provider;
      const cred = await userProviderCredentialsRepository
        .findByUserAndProvider(input.userId, provider)
        .catch(() => null);
      return cred?.encryptedKey ? provider : null;
    }),
  );
  for (const provider of personal) {
    if (!provider) continue;
    claimed.add(provider);
    const model = (resolution.providerConfigs?.[provider] as { model?: string } | undefined)?.model;
    targets.push({ provider, useOverride: true, ...(model ? { model } : {}) });
  }

  const judges = normalizeJudges(input.judges);
  const optArms = normalizeOptimizationArms(input.opts);
  const byProvider = input.requested?.length
    ? targets.filter((t) => input.requested?.includes(t.provider))
    : judges.length > 0 || optArms.length > 0
      ? targets.slice(0, 1)
      : targets;
  const byJudge: EvalTarget[] = judges.length > 0
    ? byProvider.flatMap((t) => judges.map((judge) => ({ ...t, judge })))
    : byProvider;
  const wanted: EvalTarget[] = optArms.length > 0
    ? byJudge.flatMap((t) => optArms.map((optimizations) => ({ ...t, optimizations })))
    : byJudge;
  return wanted.slice(0, EVAL_MAX_PROVIDERS);
}

export function evalReplyPrefix(target: EvalTarget): string {
  // Placeholders, not literals: the delivery path fills them from the run's
  // actual provider/model, so a fallback is visible here too.
  return `**Provider: {provider}**{model} · _pinned to ${target.provider}_${target.judge ? ` · judge: ${target.judge}` : ""}${target.optimizations ? ` · opts: ${target.optimizations}` : ""}`;
}

/** Per-arm session key: safe id characters only, so the sandbox store and the
 *  session lock accept it. */
export function evalSessionKey(conversationId: string, traceId: string): string {
  return `${conversationId}-eval-${traceId}`.replace(/[^A-Za-z0-9._-]/g, "-");
}

export async function dispatchEvalRun(args: {
  target: EvalTarget;
  task: string;
  userId: string;
  conversationId: string;
  channelId: string;
  agentSlug: string;
  orgId: string;
  agentId: string;
  spacesAppToken: string;
  spacesAppId: string;
  spacesAppUserId: string;
  senderName?: string;
  traceId: string;
}): Promise<EvalDispatch> {
  const sessionKey = evalSessionKey(args.conversationId, args.traceId);
  const res = await fetch(`${CONFIG.internalUrl}/claw/api/v1/internal/run`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(CONFIG.xyneClawS2sKey ? { "x-s2s-key": CONFIG.xyneClawS2sKey } : {}),
    },
    body: JSON.stringify({
      userId: args.userId,
      task: args.task,
      conversationId: args.conversationId,
      // Each arm gets its OWN pi session. Without this every arm shares the
      // thread's session JSONL, so they contend on one per-conversation lock
      // (three of four died with session_locked) and any that did run would
      // read the others' answers. Delivery still targets the real thread —
      // only the session identity is split.
      piSessionConversationId: sessionKey,
      agentSlug: args.agentSlug,
      orgId: args.orgId,
      eventType: "APP_MENTIONED",
      traceId: args.traceId,
      callbackUrl: `${CONFIG.internalUrl}/claw/api/v1/webhook/result`,
      progressUrl: `${CONFIG.internalUrl}/claw/api/v1/webhook/progress`,
      channelId: args.channelId,
      ...(args.target.judge ? { judgeBackend: args.target.judge } : {}),
      ...(args.target.optimizations ? { optimizations: args.target.optimizations } : {}),
      ...(args.target.useOverride
        ? {
            providerOverride: {
              provider: args.target.provider,
              ...(args.target.model ? { model: args.target.model } : {}),
            },
          }
        : {}),
    }),
  });

  const body = (await res.json()) as { success?: boolean; sessionId?: string; error?: string };
  if (!res.ok || !body.success || !body.sessionId) {
    throw new Error(`eval dispatch failed for ${args.target.provider}: HTTP ${res.status} ${body.error ?? ""}`.trim());
  }

  await setSession(
    body.sessionId,
    {
      senderId: args.userId,
      senderName: args.senderName ?? "",
      mentionedUserId: args.userId,
      channelId: args.channelId,
      channelName: "",
      conversationId: args.conversationId,
      task: args.task,
      agentId: args.agentId,
      agentOrgId: args.orgId,
      agentSlug: args.agentSlug,
      responseMode: "conversation",
      replyPrefix: evalReplyPrefix(args.target),
      appToken: args.spacesAppToken,
      spacesAppId: args.spacesAppId,
      spacesAppUserId: args.spacesAppUserId,
    },
    { skipConversationIndex: true },
  );

  return { ...args.target, sessionId: body.sessionId, sessionKey, traceId: args.traceId };
}

export async function readEvalResults(dispatches: EvalDispatch[]): Promise<EvalResult[]> {
  const rows = await prisma.agentRun.findMany({
    where: { sessionId: { in: dispatches.map((d) => d.sessionId) } },
    select: {
      sessionId: true, status: true, provider: true, model: true, error: true, result: true,
      totalMs: true, llmTotalMs: true, toolMs: true, ttftMs: true,
      tokensIn: true, tokensOut: true, tokensCacheRead: true, tokensPerSec: true,
    },
  });
  const bySession = new Map(rows.map((r) => [r.sessionId, r]));

  return dispatches.map((d) => {
    const row = bySession.get(d.sessionId);
    // Report the provider the run ACTUALLY used, not the one asked for. A run
    // that fell back to another provider must not be labelled with the pin it
    // ignored — that is the one thing an eval cannot get wrong.
    const actual = row?.provider ?? undefined;
    return {
      provider: actual ?? d.provider,
      judge: d.judge,
      optimizations: d.optimizations,
      requested: actual && actual !== d.provider ? d.provider : undefined,
      useOverride: d.useOverride,
      model: row?.model ?? d.model,
      sessionId: d.sessionId,
      sessionKey: d.sessionKey,
      traceId: d.traceId,
      answer: row?.result ?? null,
      status: row?.status ?? "pending",
      totalMs: row?.totalMs ?? null,
      llmTotalMs: row?.llmTotalMs ?? null,
      toolMs: row?.toolMs ?? null,
      ttftMs: row?.ttftMs ?? null,
      tokensIn: row?.tokensIn ?? null,
      tokensOut: row?.tokensOut ?? null,
      tokensCacheRead: row?.tokensCacheRead ?? null,
      tokensPerSec: row?.tokensPerSec ?? null,
      error: row?.error ?? null,
    };
  });
}

export function allTerminal(results: EvalResult[]): boolean {
  return results.every((r) => TERMINAL.has(r.status));
}

export async function awaitEvalResults(
  dispatches: EvalDispatch[],
  opts: { deadlineMs?: number; pollMs?: number } = {},
): Promise<EvalResult[]> {
  const deadline = Date.now() + (opts.deadlineMs ?? EVAL_DEADLINE_MS);
  const pollMs = opts.pollMs ?? EVAL_POLL_MS;
  let results = await readEvalResults(dispatches);

  while (!allTerminal(results) && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, pollMs));
    results = await readEvalResults(dispatches);
  }
  if (!allTerminal(results)) {
    log.warn(`[eval] deadline reached with ${results.filter((r) => !TERMINAL.has(r.status)).length} run(s) unfinished`);
  }
  return results;
}
