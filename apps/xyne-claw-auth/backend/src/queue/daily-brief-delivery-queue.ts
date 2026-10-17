import { Queue } from "bullmq";
import { redisService } from "../redis.js";
import { loadPrefs } from "../proactive/prefs.js";
import { nextAllowedAt } from "../proactive/schedule.js";

export interface DailyBriefDeliveryJobData {
  userId: string;
  dateBucket: string;
}

const QUEUE_NAME = "daily-brief-delivery";

let queue: Queue<DailyBriefDeliveryJobData> | undefined;

export function getDailyBriefDeliveryQueue(): Queue<DailyBriefDeliveryJobData> {
  if (!queue) {
    queue = new Queue<DailyBriefDeliveryJobData>(QUEUE_NAME, {
      connection: redisService.getConnection(),
      defaultJobOptions: {
        attempts: 3,
        backoff: { type: "exponential", delay: 60_000 },
        // Kept ~26h so the per-day jobId still de-dupes a same-day re-enqueue
        // (generation itself retries up to 3 times).
        removeOnComplete: { age: 26 * 3600 },
        removeOnFail: 500,
      },
    });
  }
  return queue;
}

/** How long to hold a delivery so it lands outside the user's quiet hours
 *  (proactive-inbox prefs, else the 22:00–08:00 default). 0 = send now. */
export async function quietHoursDelayMs(userId: string, now: Date = new Date()): Promise<number> {
  const prefs = await loadPrefs(userId).catch(() => null);
  if (!prefs) return 0;
  return Math.max(0, nextAllowedAt(now, prefs).getTime() - now.getTime());
}

/**
 * Enqueue the WhatsApp delivery of one user's brief. Separate from generation
 * so a generation retry never sends twice, and a send retry never re-runs the
 * LLM. The jobId is fixed per user per day; the row-level claim in
 * services/dailyBriefWhatsapp.ts is the real exactly-once guard.
 */
export async function enqueueBriefWhatsappDelivery(userId: string, dateBucket: string): Promise<void> {
  const delay = await quietHoursDelayMs(userId);
  await getDailyBriefDeliveryQueue().add(
    "deliver-brief-whatsapp",
    { userId, dateBucket },
    { jobId: `wa-brief-${userId}-${dateBucket}`, ...(delay > 0 ? { delay } : {}) },
  );
}

export const DAILY_BRIEF_DELIVERY_QUEUE_NAME = QUEUE_NAME;

export async function closeDailyBriefDeliveryQueue(): Promise<void> {
  if (queue) {
    await queue.close();
    queue = undefined;
  }
}
