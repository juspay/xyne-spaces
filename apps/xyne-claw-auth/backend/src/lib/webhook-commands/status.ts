import { agentRunRepository } from "../../repositories/agentRunRepository.js";
import { redisService } from "../../redis.js";
import { getRunExecutionQueue } from "../../queue/run-execution-queue.js";
import { getSlotOwner } from "../message-queue.js";
import {
  formatStatusPanel,
  type StatusOwnership,
  type StatusQueueState,
  type StatusRunSnapshot,
  type StatusToolInvocation,
} from "./status-panel.js";
import type { WebhookCommandCtx } from "./context.js";

function parseInvocations(raw: unknown): StatusToolInvocation[] {
  if (!Array.isArray(raw)) return [];
  const out: StatusToolInvocation[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== "object") continue;
    const rec = entry as Record<string, unknown>;
    const toolName = typeof rec.toolName === "string" ? rec.toolName : typeof rec.name === "string" ? rec.name : null;
    if (!toolName) continue;
    out.push({
      toolName,
      ...(typeof rec.status === "string" ? { status: rec.status } : {}),
      ...(typeof rec.isError === "boolean" ? { isError: rec.isError } : {}),
      ...(typeof rec.durationMs === "number" ? { durationMs: rec.durationMs } : {}),
      ...(typeof rec.startedAt === "string" ? { startedAt: rec.startedAt } : {}),
    });
  }
  return out;
}

async function loadRun(ctx: WebhookCommandCtx): Promise<StatusRunSnapshot | null> {
  const conversationId = ctx.payload.conversationId;
  if (!conversationId) return null;
  try {
    let sessionId: string | undefined;
    try {
      const owner = await getSlotOwner(conversationId, ctx.agent.slug);
      sessionId = owner?.sessionId;
    } catch {
      sessionId = undefined;
    }

    const row =
      (sessionId ? await agentRunRepository.findBySessionId(sessionId) : null) ??
      (await agentRunRepository.findLatestByConversation(conversationId, ctx.agent.slug));
    if (!row) return null;

    return {
      sessionId: row.sessionId,
      status: row.status,
      startedAt: row.startedAt,
      completedAt: row.completedAt ?? null,
      provider: row.provider ?? null,
      model: row.model ?? null,
      currentToolLabel: row.currentToolLabel ?? null,
      error: row.error ?? null,
      toolInvocations: parseInvocations(row.toolInvocations),
    };
  } catch (err) {
    ctx.log.warn("/status run lookup failed", { error: err instanceof Error ? err.message : String(err) });
    return null;
  }
}

async function loadOwnership(sessionId: string): Promise<StatusOwnership | null> {
  try {
    const redis = redisService.getConnection();
    const key = `claw:run-owner:${sessionId}`;
    const holder = await redis.get(key);
    if (!holder) return null;
    const ttlMs = await redis.pttl(key);
    return { holder, ttlMs: typeof ttlMs === "number" && ttlMs > 0 ? ttlMs : null };
  } catch {
    return null;
  }
}

async function loadQueueState(sessionId: string): Promise<StatusQueueState | null> {
  try {
    const job = await getRunExecutionQueue().getJob(sessionId);
    if (!job) return null;
    const state = await job.getState();
    const attempts = typeof job.attemptsStarted === "number" ? job.attemptsStarted : job.attemptsMade;
    return {
      state,
      ...(typeof attempts === "number" ? { attempts } : {}),
      ...(typeof job.delay === "number" ? { delayMs: job.delay } : {}),
    };
  } catch {
    return null;
  }
}

export async function handleStatus(ctx: WebhookCommandCtx): Promise<void> {
  let markdown: string;
  try {
    const run = await loadRun(ctx);
    const ownership = run ? await loadOwnership(run.sessionId) : null;
    const queue = run ? await loadQueueState(run.sessionId) : null;
    markdown = formatStatusPanel({
      agentSlug: ctx.agent.slug,
      now: new Date(),
      run,
      ownership,
      queue,
    });
  } catch (err) {
    ctx.log.warn("/status panel build failed", { error: err instanceof Error ? err.message : String(err) });
    markdown = "🔎 **Status** — could not read the run state right now. Try again in a moment.";
  }
  await ctx.reply(markdown, "Failed to post /status reply");
}
