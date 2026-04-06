import { prisma } from "../db.js";
import { enqueueDelayedJob, enqueueCronJob, type ScheduledJobData } from "./scheduled-jobs-queue.js";

export async function restoreScheduledJobs(): Promise<void> {
  const activeJobs = await prisma.scheduledJob.findMany({
    where: { status: "active" },
  });

  if (activeJobs.length === 0) return;

  console.log(`[scheduler] Restoring ${activeJobs.length} active job(s) from database`);

  for (const job of activeJobs) {
    const data: ScheduledJobData = {
      scheduledJobId: job.id,
      userId: job.userId,
      agentSlug: job.agentSlug,
      task: job.task,
      context: job.context ?? undefined,
      channelId: job.channelId ?? undefined,
      conversationId: job.conversationId ?? undefined,
    };

    try {
      if (job.type === "cron" && job.cronExpression && job.bullSchedulerId) {
        // Cron: upsertJobScheduler is idempotent
        await enqueueCronJob(job.bullSchedulerId, data, job.cronExpression);
        console.log(`[scheduler] Restored cron job ${job.id} (${job.cronExpression})`);
      } else if (job.type === "once" && job.nextRunAt) {
        const remainingMs = job.nextRunAt.getTime() - Date.now();
        const delay = Math.max(remainingMs, 0); // fire immediately if overdue
        const bullJobId = await enqueueDelayedJob(data, delay);
        await prisma.scheduledJob.update({
          where: { id: job.id },
          data: { bullJobId },
        });
        console.log(`[scheduler] Restored once job ${job.id} (delay: ${delay}ms)`);
      }
    } catch (err) {
      console.error(`[scheduler] Failed to restore job ${job.id}:`, err);
    }
  }
}
