import { Worker, type Job } from "bullmq";
import { redisService } from "../redis.js";
import { prisma } from "../db.js";
import { CONFIG } from "../config.js";
import { agentRunRepository, chatMessageRepository } from "../repositories/index.js";
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

  // Fire the agent via the local /run endpoint
  const callbackUrl = `${CONFIG.selfUrl}/claw/api/v1/scheduled-jobs/${scheduledJobId}/result`;

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

  const res = await fetch(`${CONFIG.selfUrl}/claw/api/v1/run`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      userId,
      task,
      context: scheduledContext,
      agentSlug,
      channelId,
      conversationId: runConversationId,
      callbackUrl,
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
