/**
 * Scheduled jobs — CRUD + result callback.
 *
 * POST   /scheduled-jobs           — create a scheduled job
 * GET    /scheduled-jobs            — list jobs (filter by userId, status)
 * GET    /scheduled-jobs/:id        — get single job
 * DELETE /scheduled-jobs/:id        — cancel a job
 * POST   /scheduled-jobs/:id/result — callback from xyne-claw after scheduled run
 */

import { Router, type Request, type Response } from "express";
import { prisma } from "../db.js";
import { CONFIG } from "../config.js";
import { decrypt } from "../crypto.js";
import { spacesAppFetch, spacesAppFetchMultipart } from "../lib/spaces-api.js";
import {
  enqueueDelayedJob,
  enqueueCronJob,
  cancelJob,
  cancelCronJob,
  type ScheduledJobData,
} from "../queue/scheduled-jobs-queue.js";

const router = Router();

// ── Helpers ──────────────────────────────────────────────────────────

function decryptStoredField(stored: string): string {
  const [ciphertext, iv, authTag] = stored.split(":");
  if (!ciphertext || !iv || !authTag) throw new Error("Invalid encrypted field format");
  return decrypt(ciphertext, iv, authTag, CONFIG.encryptionKey);
}

// ── POST / — create a scheduled job ─────────────────────────────────

router.post("/", async (req: Request, res: Response) => {
  try {
    const {
      userId, agentSlug, task, context,
      channelId, conversationId,
      type, delayMs, cronExpression,
      label, maxRuns,
    } = req.body as {
      userId?: string;
      agentSlug?: string;
      task?: string;
      context?: string;
      channelId?: string;
      conversationId?: string;
      type?: string;
      delayMs?: number;
      cronExpression?: string;
      label?: string;
      maxRuns?: number;
    };

    if (!userId || !agentSlug || !task || !type) {
      res.status(400).json({ success: false, error: "userId, agentSlug, task, and type are required" });
      return;
    }

    if (type !== "once" && type !== "cron") {
      res.status(400).json({ success: false, error: "type must be 'once' or 'cron'" });
      return;
    }

    if (type === "once" && (delayMs == null || delayMs <= 0)) {
      res.status(400).json({ success: false, error: "delayMs is required and must be > 0 for type='once'" });
      return;
    }

    if (type === "cron" && !cronExpression) {
      res.status(400).json({ success: false, error: "cronExpression is required for type='cron'" });
      return;
    }

    // Enforce minimum cron interval
    const minInterval = CONFIG.minCronIntervalMinutes;
    if (type === "cron" && cronExpression && minInterval > 0) {
      const parts = cronExpression.trim().split(/\s+/);
      if (parts.length >= 1) {
        const minuteField = parts[0]!;
        if (minuteField === "*") {
          res.status(400).json({ success: false, error: `Minimum cron interval is ${minInterval} minutes. Use '*/${minInterval} * * * *' or longer.` });
          return;
        }
        const stepMatch = minuteField.match(/^\*\/(\d+)$/);
        if (stepMatch && parseInt(stepMatch[1]!, 10) < minInterval) {
          res.status(400).json({ success: false, error: `Minimum cron interval is ${minInterval} minutes. Got every ${stepMatch[1]} minutes.` });
          return;
        }
      }
    }

    const nextRunAt = type === "once" ? new Date(Date.now() + delayMs!) : null;

    // Create Prisma row
    const row = await prisma.scheduledJob.create({
      data: {
        userId,
        agentSlug,
        task,
        context: context ?? null,
        channelId: channelId ?? null,
        conversationId: conversationId ?? null,
        type,
        delayMs: type === "once" ? BigInt(delayMs!) : null,
        cronExpression: type === "cron" ? (cronExpression ?? null) : null,
        maxRuns: maxRuns ?? (type === "once" ? 1 : null),
        nextRunAt,
        label: label ?? null,
      },
    });

    const data: ScheduledJobData = {
      scheduledJobId: row.id,
      userId,
      agentSlug,
      task,
      context: context ?? undefined,
      channelId: channelId ?? undefined,
      conversationId: conversationId ?? undefined,
    };

    // Enqueue in BullMQ
    if (type === "once") {
      const bullJobId = await enqueueDelayedJob(data, delayMs!);
      await prisma.scheduledJob.update({
        where: { id: row.id },
        data: { bullJobId },
      });
    } else {
      const schedulerId = `cron-${row.id}`;
      await enqueueCronJob(schedulerId, data, cronExpression!);
      await prisma.scheduledJob.update({
        where: { id: row.id },
        data: { bullSchedulerId: schedulerId },
      });
    }

    console.log(`[scheduled-jobs] Created ${type} job ${row.id} for agent ${agentSlug}`);

    res.json({
      success: true,
      data: {
        id: row.id,
        type: row.type,
        status: row.status,
        nextRunAt: nextRunAt?.toISOString(),
        cronExpression: row.cronExpression,
        label: row.label,
      },
    });
  } catch (err) {
    console.error("[scheduled-jobs] Create error:", err);
    res.status(500).json({ success: false, error: "Failed to create scheduled job" });
  }
});

// ── GET / — list jobs ───────────────────────────────────────────────

router.get("/", async (req: Request, res: Response) => {
  try {
    const { userId, status } = req.query as { userId?: string; status?: string };
    const where: Record<string, unknown> = {};
    if (userId) where["userId"] = userId;
    if (status) where["status"] = status;

    const rows = await prisma.scheduledJob.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: 50,
    });

    res.json({
      success: true,
      data: rows.map((r) => ({
        ...r,
        delayMs: r.delayMs != null ? Number(r.delayMs) : null,
      })),
    });
  } catch (err) {
    console.error("[scheduled-jobs] List error:", err);
    res.status(500).json({ success: false, error: "Failed to list scheduled jobs" });
  }
});

// ── GET /:id — get single job ───────────────────────────────────────

router.get("/:id", async (req: Request<{ id: string }>, res: Response) => {
  try {
    const row = await prisma.scheduledJob.findUnique({ where: { id: req.params.id } });
    if (!row) {
      res.status(404).json({ success: false, error: "Not found" });
      return;
    }
    res.json({
      success: true,
      data: { ...row, delayMs: row.delayMs != null ? Number(row.delayMs) : null },
    });
  } catch (err) {
    console.error("[scheduled-jobs] Get error:", err);
    res.status(500).json({ success: false, error: "Failed to get scheduled job" });
  }
});

// ── DELETE /:id — cancel a job ──────────────────────────────────────

router.delete("/:id", async (req: Request<{ id: string }>, res: Response) => {
  try {
    const row = await prisma.scheduledJob.findUnique({ where: { id: req.params.id } });
    if (!row) {
      res.status(404).json({ success: false, error: "Not found" });
      return;
    }

    // Remove from BullMQ
    if (row.type === "once" && row.bullJobId) {
      await cancelJob(row.bullJobId).catch(() => {});
    }
    if (row.type === "cron" && row.bullSchedulerId) {
      await cancelCronJob(row.bullSchedulerId).catch(() => {});
    }

    await prisma.scheduledJob.update({
      where: { id: row.id },
      data: { status: "cancelled" },
    });

    console.log(`[scheduled-jobs] Cancelled job ${row.id}`);
    res.json({ success: true });
  } catch (err) {
    console.error("[scheduled-jobs] Cancel error:", err);
    res.status(500).json({ success: false, error: "Failed to cancel scheduled job" });
  }
});

// ── POST /:id/result — callback from xyne-claw after scheduled run ──

router.post("/:id/result", async (req: Request<{ id: string }>, res: Response) => {
  const { id } = req.params;
  const payload = req.body as {
    sessionId?: string;
    userId?: string;
    status?: string;
    result?: string;
    error?: string;
    attachments?: Array<{ fileName: string; mimeType: string; data: string }>;
  };

  console.log(`[scheduled-jobs/result] Job ${id}: status=${payload.status}`);
  res.json({ success: true });

  if (payload.status !== "completed" || !payload.result) return;

  const row = await prisma.scheduledJob.findUnique({ where: { id } });
  if (!row) {
    console.warn(`[scheduled-jobs/result] Job ${id} not found`);
    return;
  }

  // Resolve agent's Spaces app token
  const agent = await prisma.agent.findFirst({ where: { slug: row.agentSlug } });
  if (!agent?.spacesAppToken || !agent.spacesAppId) {
    console.error(`[scheduled-jobs/result] Agent ${row.agentSlug} has no Spaces app credentials`);
    return;
  }

  const appToken = decryptStoredField(agent.spacesAppToken);
  const spacesAppUserId = agent.spacesAppUserId ?? "";

  try {
    if (row.channelId && row.conversationId) {
      // Reply in the original thread
      if (payload.attachments?.length) {
        const form = new FormData();
        for (const att of payload.attachments) {
          const buffer = Buffer.from(att.data, "base64");
          const blob = new Blob([buffer], { type: att.mimeType });
          form.append("files", blob, att.fileName);
        }
        form.append("channelId", row.channelId);
        form.append("conversationId", row.conversationId);
        form.append("userId", spacesAppUserId);
        form.append("markdownText", payload.result);
        form.append("metadata", JSON.stringify({ contentFormat: "markdown" }));

        await spacesAppFetchMultipart("/files/filesUpload", form, appToken);
      } else {
        await spacesAppFetch("/chat/postMessage", {
          channelId: row.channelId,
          conversationId: row.conversationId,
          markdownText: payload.result,
          userId: spacesAppUserId,
          metadata: { contentFormat: "markdown" },
        }, appToken);
      }

      console.log(`[scheduled-jobs/result] Posted result to thread ${row.conversationId}`);
    } else if (row.userId) {
      // DM the user
      const dmResult = (await spacesAppFetch("/channel/openDm", {
        targetUserId: row.userId,
      }, appToken)) as { channelId: string };

      await spacesAppFetch("/chat/postMessage", {
        channelId: dmResult.channelId,
        markdownText: payload.result,
        userId: spacesAppUserId,
        metadata: { contentFormat: "markdown" },
      }, appToken);

      console.log(`[scheduled-jobs/result] DM'd result to user ${row.userId}`);
    }
  } catch (err) {
    console.error(`[scheduled-jobs/result] Failed to deliver result for job ${id}:`, err);
  }
});

export { router as scheduledJobsRouter };
