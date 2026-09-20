import { prisma } from "../db.js";
import { CONFIG } from "../config.js";
import { createLogger } from "../logger.js";
import { resolveProvidersForDispatch } from "./provider-resolution.js";

const log = createLogger("eval-run");

export const EVAL_POLL_MS = 10_000;
export const EVAL_DEADLINE_MS = Math.max(60_000, Number(process.env["EVAL_DEADLINE_MS"]) || 900_000);
export const EVAL_MAX_PROVIDERS = Math.max(1, Number(process.env["EVAL_MAX_PROVIDERS"]) || 6);

const TERMINAL = new Set(["completed", "failed", "cancelled"]);

export interface EvalTarget {
  provider: string;
  model?: string | undefined;
}

export interface EvalDispatch extends EvalTarget {
  sessionId: string;
}

export interface EvalResult extends EvalTarget {
  sessionId: string;
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

export async function resolveEvalTargets(input: {
  userId: string;
  agent: { id?: string; orgId?: string | null; slug: string };
  agentRow?: { id?: string; config?: unknown } | null;
  conversationId?: string | undefined;
  requested?: string[];
}): Promise<EvalTarget[]> {
  const resolution = await resolveProvidersForDispatch({
    targetUserId: input.userId,
    agent: input.agent,
    ...(input.agentRow ? { agentRow: input.agentRow } : {}),
    ...(input.conversationId ? { conversationId: input.conversationId } : {}),
  });

  const configured = new Set<string>(resolution.runtimeProviderOrder);
  for (const name of Object.keys(resolution.providerConfigs ?? {})) configured.add(name);
  if (resolution.resolvedParentProvider) configured.add(resolution.resolvedParentProvider);

  const wanted = input.requested?.length
    ? input.requested.filter((p) => configured.has(p))
    : [...configured];

  return wanted.slice(0, EVAL_MAX_PROVIDERS).map((provider) => {
    const model = (resolution.providerConfigs?.[provider] as { model?: string } | undefined)?.model;
    return model ? { provider, model } : { provider };
  });
}

export async function dispatchEvalRun(args: {
  target: EvalTarget;
  task: string;
  userId: string;
  conversationId: string;
  channelId: string;
  agentSlug: string;
  orgId: string;
  spacesAppToken: string;
  traceId: string;
}): Promise<EvalDispatch> {
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
      agentSlug: args.agentSlug,
      orgId: args.orgId,
      eventType: "APP_MENTIONED",
      traceId: args.traceId,
      callbackUrl: `${CONFIG.internalUrl}/claw/api/v1/webhook/result`,
      progressUrl: `${CONFIG.internalUrl}/claw/api/v1/webhook/progress`,
      channelId: args.channelId,
      providerOverride: {
        provider: args.target.provider,
        ...(args.target.model ? { model: args.target.model } : {}),
      },
    }),
  });

  const body = (await res.json()) as { success?: boolean; sessionId?: string; error?: string };
  if (!res.ok || !body.success || !body.sessionId) {
    throw new Error(`eval dispatch failed for ${args.target.provider}: HTTP ${res.status} ${body.error ?? ""}`.trim());
  }
  return { ...args.target, sessionId: body.sessionId };
}

export async function readEvalResults(dispatches: EvalDispatch[]): Promise<EvalResult[]> {
  const rows = await prisma.agentRun.findMany({
    where: { sessionId: { in: dispatches.map((d) => d.sessionId) } },
    select: {
      sessionId: true, status: true, provider: true, model: true, error: true,
      totalMs: true, llmTotalMs: true, toolMs: true, ttftMs: true,
      tokensIn: true, tokensOut: true, tokensCacheRead: true, tokensPerSec: true,
    },
  });
  const bySession = new Map(rows.map((r) => [r.sessionId, r]));

  return dispatches.map((d) => {
    const row = bySession.get(d.sessionId);
    return {
      provider: d.provider,
      model: row?.model ?? d.model,
      sessionId: d.sessionId,
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
