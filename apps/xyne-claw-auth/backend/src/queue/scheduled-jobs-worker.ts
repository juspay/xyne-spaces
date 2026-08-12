import { Worker, type Job } from "bullmq";
import { redisService } from "../redis.js";
import { prisma } from "../db.js";
import { CONFIG } from "../config.js";
import { decrypt } from "../crypto.js";
import { agentRunRepository, chatMessageRepository } from "../repositories/index.js";
import { ensureUserExists } from "../lib/users-jit.js";
import { resolveAgentProviderConfigs } from "../lib/agent-provider-config.js";
import { resolveFastMode } from "../lib/fast-mode.js";
import { registerRunRecovery, type RecoverySessionContext } from "./run-recovery-worker.js";
import type { ScheduledJobData } from "./scheduled-jobs-queue.js";

import { createLogger } from "../logger.js";
const log = createLogger("scheduled-jobs-worker");

let worker: Worker<ScheduledJobData> | undefined;

async function processJob(job: Job<ScheduledJobData>): Promise<void> {
  const { scheduledJobId, userId, agentSlug, channelId, conversationId } = job.data;

  log.info(`[scheduler] Firing job ${scheduledJobId} (agent: ${agentSlug})`);

  // Verify the job is still active
  const row = await prisma.scheduledJob.findUnique({ where: { id: scheduledJobId } });
  if (!row || row.status !== "active") {
    log.info(`[scheduler] Job ${scheduledJobId} is ${row?.status ?? "missing"}, skipping`);
    return;
  }

  // Read the prompt/context LIVE from the DB row rather than the BullMQ job
  // payload. For cron jobs the payload's task/context is baked into the
  // repeatable-job template at enqueue time, so an in-place edit via
  // PATCH /scheduled-jobs/:id (or the scheduled-job-control "update" action)
  // would otherwise never take effect. Sourcing them from the freshly-loaded
  // row makes prompt edits a pure DB write with no Redis re-bind and keeps the
  // runtime in sync with what the dashboard shows.
  const task = row.task;
  const context = row.context ?? undefined;

  // JIT-mirror the owning user from Spaces if needed. Without this, a job
  // that was scheduled by a user who later lost their claw_auth row (or
  // never had one — e.g. job restored from a backup) would fail at the
  // FK-bound writes downstream.
  await ensureUserExists(userId, "scheduled-job").catch((err) => {
    log.warn(`[scheduler] ensureUserExists(${userId}) failed:`, err instanceof Error ? err.message : err);
  });

  // Fire the agent via the local /run endpoint
  const callbackUrl = `${CONFIG.internalUrl}/claw/api/v1/scheduled-jobs/${scheduledJobId}/result`;

  // Use a unique conversationId per run so the agent gets a fresh session
  // instead of resuming the thread's ongoing conversation.
  const scheduledFireTs = Date.now();
  const runConversationId = `scheduled_${scheduledJobId}_${scheduledFireTs}`;
  const idempotencyKey = `scheduled_${scheduledJobId}_${scheduledFireTs}`.replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 128);
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
    where: { orgId_slug: { orgId: row.orgId, slug: agentSlug } },
    select: { id: true, config: true, orgId: true, spacesAppId: true, spacesAppToken: true, spacesAppUserId: true },
  }).catch((err) => {
    log.warn(`[scheduler] agent lookup failed for ${agentSlug}:`, err instanceof Error ? err.message : err);
    return null;
  });

  // Resolve the agent's configured provider so a scheduled run uses the same
  // (premium) model a human chat would — not the platform default. Headless:
  // agent-level creds only, honoring the agent's providerAlwaysOn policy.
  // Best-effort — if the row is gone we fire without it (platform default).
  const { providerConfigs, providerOrder, parent: providerParent } = agentRow
    ? await resolveAgentProviderConfigs(agentRow, { headlessBulk: true })
    : { providerConfigs: {}, providerOrder: [] as string[], parent: undefined as string | undefined };
  const fastModeEnabled = await resolveFastMode(runConversationId, agentSlug, agentRow?.config);

  const progressUrl = `${CONFIG.internalUrl}/claw/api/v1/webhook/progress`;
  const dispatchPayload = {
    userId,
    task,
    context: scheduledContext,
    agentSlug,
    orgId: row.orgId,
    channelId: channelId ?? "",
    conversationId: runConversationId,
    traceId: runConversationId,
    callbackUrl,
    progressUrl,
    idempotencyKey,
    detached: true,
    // Marks the run as scheduler-triggered: xyne-claw strips the
    // schedule-task tool for these runs (self-scheduling ban — see
    // run.ts). The conversationId "scheduled_" prefix is the fallback
    // signal for the same check.
    eventType: "scheduled_job",
    // Thread the row id into the run so the scheduledJobControl tool can
    // resolve jobId:"current" (xyne-claw run.ts puts it on tool meta).
    scheduledJobId,
    // We persist the user ChatMessage and AgentRun ourselves below (with the
    // correct triggerSource: "scheduled"). Without this flag, /internal/run
    // also inserts an AgentRun for the same sessionId — tagged "spaces" — and
    // our insert then loses the race with a P2002 unique-constraint error
    // (~19/hour in prod), mislabeling every scheduled run as "spaces" in the
    // Control Center. Mirrors how /agent-chat opts out (see run.ts).
    __persistedByCaller: true,
    ...(agentRow?.config ? { agentConfig: agentRow.config as Record<string, unknown> } : {}),
    // Primary provider — the pod keys its model off `provider` (defaults to
    // "spaces"/kimi when unset). Without this, scheduled runs used the platform default
    // regardless of the agent's configured provider.
    ...(providerParent ? { provider: providerParent } : {}),
    ...(Object.keys(providerConfigs).length > 0 ? { providerConfigs } : {}),
    ...(providerOrder.length > 1 ? { providerOrder } : {}),
    fastMode: fastModeEnabled,
  };

  const res = await fetch(`${CONFIG.internalUrl}/claw/api/v1/internal/run`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(CONFIG.xyneClawS2sKey ? { "x-s2s-key": CONFIG.xyneClawS2sKey } : {}),
    },
    body: JSON.stringify(dispatchPayload),
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
      orgId: agentRow?.orgId ?? row.orgId ?? null,
      triggerSource: "scheduled",
      task,
      conversationId: runConversationId,
      scheduledJobId,
      ...(channelId ? { channelId } : {}),
      fastMode: fastModeEnabled,
    }).catch((e) => log.warn(`[scheduler] AgentRun.start failed:`, e instanceof Error ? e.message : e));
    await chatMessageRepository.create({
      conversationId: runConversationId,
      agentSlug,
      userId,
      role: "user",
      content: task,
      status: "completed",
      orgId: agentRow?.orgId ?? row.orgId ?? null,
    }).catch((e) => log.warn(`[scheduler] ChatMessage.create failed:`, e instanceof Error ? e.message : e));

    const appToken = agentRow?.spacesAppToken
      ? (() => {
          const [ciphertext, iv, authTag] = agentRow.spacesAppToken.split(":");
          return ciphertext && iv && authTag ? decrypt(ciphertext, iv, authTag, CONFIG.encryptionKey) : "";
        })()
      : "";
    const recoveryCtx: RecoverySessionContext = {
      mentionedUserId: agentRow?.spacesAppUserId ?? "",
      senderId: userId,
      senderName: userId,
      channelId: channelId ?? "",
      channelName: channelId ?? "",
      conversationId: conversationId ?? runConversationId,
      task,
      agentSlug,
      responseMode: "conversation",
      appToken,
      spacesAppId: agentRow?.spacesAppId ?? "",
      spacesAppUserId: agentRow?.spacesAppUserId ?? "",
      ...(row.workspaceId ? { workspaceId: row.workspaceId } : {}),
    };
    await registerRunRecovery({
      rootSessionId: body.sessionId,
      maxRetries: CONFIG.runRecoveryMaxRetries,
      timeoutMs: CONFIG.runRecoveryTimeoutMs,
      retryBackoffMs: CONFIG.runRecoveryBackoffMs,
      dispatchPayload,
      sessionContext: recoveryCtx,
    }).catch((e) => log.warn(`[scheduler] registerRunRecovery failed for ${body.sessionId}:`, e instanceof Error ? e.message : e));
  }

  log.info(`[scheduler] Job ${scheduledJobId} → session ${body.sessionId}`);

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
    log.error(`[scheduler] Job ${job?.data.scheduledJobId ?? job?.id} failed:`, err.message);
  });

  worker.on("error", (err) => {
    log.error("[scheduler] Worker error:", err.message);
  });

  log.info("[scheduler] Worker started");

  return worker;
}

export async function closeWorker(): Promise<void> {
  if (worker) {
    await worker.close();
    worker = undefined;
  }
}
