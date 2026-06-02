import { Worker, type Job } from "bullmq";
import { redisService } from "../redis.js";
import { prisma } from "../db.js";
import { CONFIG } from "../config.js";
import { agentRunRepository, chatMessageRepository } from "../repositories/index.js";
import { ensureUserExists } from "../lib/users-jit.js";
import type { ScheduledJobData } from "./scheduled-jobs-queue.js";

let worker: Worker<ScheduledJobData> | undefined;

async function processJob(job: Job<ScheduledJobData>): Promise<void> {
  const { scheduledJobId, userId, agentSlug, task, context, channelId, conversationId } = job.data;

  console.log(`[scheduler] Firing job ${scheduledJobId} (agent: ${agentSlug})`);

  // Verify the job is still active
  const row = await prisma.scheduledJob.findUnique({ where: { id: scheduledJobId } });
  if (!row || row.status !== "active") {
    console.log(`[scheduler] Job ${scheduledJobId} is ${row?.status ?? "missing"}, skipping`);
    return;
  }

  // JIT-mirror the owning user from Spaces if needed. Without this, a job
  // that was scheduled by a user who later lost their claw_auth row (or
  // never had one — e.g. job restored from a backup) would fail at the
  // FK-bound writes downstream.
  await ensureUserExists(userId, "scheduled-job").catch((err) => {
    console.warn(`[scheduler] ensureUserExists(${userId}) failed:`, err instanceof Error ? err.message : err);
  });

  // Fire the agent via the local /run endpoint
  const callbackUrl = `${CONFIG.internalUrl}/claw/api/v1/scheduled-jobs/${scheduledJobId}/result`;

  // Use a unique conversationId per run so the agent gets a fresh session
  // instead of resuming the thread's ongoing conversation.
  const runConversationId = `scheduled_${scheduledJobId}_${Date.now()}`;
  const scheduledContext = [
    "## Scheduled Job",
    "This is an automated scheduled task — NOT a reply to a user message.",
    "Execute the task below independently. Do not reference or respond to previous messages in the thread.",
    "",
    ...(context ? [`## Additional Context`, context] : []),
  ].join("\n");

  // Look up the agent's JSONB config so xyne-claw can enable per-agent
  // features that read from it: memoryEnabled (memory-search tool),
  // toolPermissions (per-tool deny/ask), skillTriggers, promptInjections,
  // and custom-tool config values. Without this, those features silently
  // default to "off"/"allow" for every cron/once run.
  // Lookup is best-effort — if the row is gone, we still fire without it
  // rather than failing the job (matches the loose-coupling style of the
  // rest of this worker).
  const agentRow = await prisma.agent.findUnique({
    where: { slug: agentSlug },
    select: { config: true },
  }).catch((err) => {
    console.warn(`[scheduler] agent lookup failed for ${agentSlug}:`, err instanceof Error ? err.message : err);
    return null;
  });

  const res = await fetch(`${CONFIG.internalUrl}/claw/api/v1/run`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(CONFIG.xyneClawS2sKey ? { "x-s2s-key": CONFIG.xyneClawS2sKey } : {}),
    },
    body: JSON.stringify({
      userId,
      task,
      context: scheduledContext,
      agentSlug,
      channelId,
      conversationId: runConversationId,
      callbackUrl,
      ...(agentRow?.config ? { agentConfig: agentRow.config as Record<string, unknown> } : {}),
    }),
  });

  const body = (await res.json()) as { success: boolean; sessionId?: string; error?: string };

  if (!body.success) {
    // Persist failed run
    await prisma.scheduledJobRun.create({
      data: {
        scheduledJobId,
        status: "failed",
        error: body.error ?? "unknown",
        completedAt: new Date(),
      },
    });
    throw new Error(`/run failed: ${body.error ?? "unknown"}`);
  }

  // Persist started run with sessionId
  await prisma.scheduledJobRun.create({
    data: {
      scheduledJobId,
      sessionId: body.sessionId ?? null,
      status: "started",
    },
  });

  // Track the run for the Agent Control Center
  if (body.sessionId) {
    await agentRunRepository.start({
      sessionId: body.sessionId,
      userId,
      agentSlug,
      triggerSource: "scheduled",
      task,
      conversationId: runConversationId,
      scheduledJobId,
      ...(channelId ? { channelId } : {}),
    }).catch((e) => console.warn(`[scheduler] AgentRun.start failed:`, e instanceof Error ? e.message : e));
    await chatMessageRepository.create({
      conversationId: runConversationId,
      agentSlug,
      userId,
      role: "user",
      content: task,
      status: "completed",
    }).catch((e) => console.warn(`[scheduler] ChatMessage.create failed:`, e instanceof Error ? e.message : e));
  }

  console.log(`[scheduler] Job ${scheduledJobId} → session ${body.sessionId}`);

  // Update tracking
  const isOnce = row.type === "once";
  await prisma.scheduledJob.update({
    where: { id: scheduledJobId },
    data: {
      lastRunAt: new Date(),
      runCount: { increment: 1 },
      ...(isOnce ? { status: "completed" } : {}),
      // Check maxRuns for cron
      ...(!isOnce && row.maxRuns != null && row.runCount + 1 >= row.maxRuns
        ? { status: "completed" }
        : {}),
    },
  });
}

export function initScheduledJobsWorker(): Worker<ScheduledJobData> {
  if (worker) return worker;

  worker = new Worker<ScheduledJobData>("agent-scheduled-jobs", processJob, {
    connection: redisService.getConnection(),
    concurrency: 5,
  });

  worker.on("failed", (job, err) => {
    console.error(`[scheduler] Job ${job?.data.scheduledJobId ?? job?.id} failed:`, err.message);
  });

  worker.on("error", (err) => {
    console.error("[scheduler] Worker error:", err.message);
  });

  console.log("[scheduler] Worker started");

  return worker;
}

export async function closeWorker(): Promise<void> {
  if (worker) {
    await worker.close();
    worker = undefined;
  }
}
