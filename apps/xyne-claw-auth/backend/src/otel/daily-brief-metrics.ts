import { metrics } from "@opentelemetry/api";
import type { Counter, Meter } from "@opentelemetry/api";
import { CONFIG } from "../config.js";
import { prisma } from "../db.js";
import { redisService } from "../redis.js";
import { createLogger } from "../logger.js";
import { DAILY_BRIEF_KIND } from "../repositories/index.js";

const log = createLogger("otel-daily-brief");

function getMeter(): Meter {
  return metrics.getMeter(CONFIG.otelServiceName);
}

/** Where a brief run came from: the daily cron fan-out, or a user pressing Regenerate. */
export type DailyBriefTrigger = "scheduled" | "regenerate";

/** Lifetime regeneration state, in Redis so it survives restarts and is shared across pods. */
const REGEN_COUNT_KEY = "daily_brief:regenerations";
const REGEN_USERS_KEY = "daily_brief:regen_users";

// Daily Brief Generated Total — labels: trigger (scheduled | regenerate), status (ready | failed)
let _dailyBriefGeneratedTotal: Counter | null = null;
function getDailyBriefGeneratedTotal(): Counter {
  if (!_dailyBriefGeneratedTotal) {
    _dailyBriefGeneratedTotal = getMeter().createCounter("daily_brief_generated_total", {
      description: "Daily brief generation runs, by trigger and outcome",
      unit: "1",
    });
  }
  return _dailyBriefGeneratedTotal;
}

export function recordDailyBriefGenerated(
  trigger: DailyBriefTrigger,
  status: "ready" | "failed",
): void {
  try {
    getDailyBriefGeneratedTotal().add(1, { trigger, status });
  } catch {
    // metrics must never break a brief run
  }
}

/** Count one regeneration request, and the user behind it. Best-effort. */
export async function recordDailyBriefRegeneration(userId: string): Promise<void> {
  try {
    await redisService
      .getConnection()
      .multi()
      .incr(REGEN_COUNT_KEY)
      .sadd(REGEN_USERS_KEY, userId)
      .exec();
  } catch {
    // metrics must never break a brief run
  }
}

/**
 * Global lifetime totals, re-read on every export tick:
 *   daily_brief_users_total   — users who have at least one brief (generated_content)
 *   daily_brief_total         — briefs that exist, one per user per day (generated_content)
 *   daily_brief_regenerations_total — regeneration requests ever served (Redis)
 * The DB numbers key off generatedAt rather than status="ready": markGenerating
 * leaves generatedAt intact, so a brief being regenerated keeps counting instead
 * of dropping out of the total for the length of the run.
 */
export function registerDailyBriefGauges(): void {
  if (!CONFIG.otelMetricsEnabled) return;

  const meter = getMeter();
  // No `unit` — the Prometheus translation appends `_ratio` to a gauge whose unit is "1".
  const usersGauge = meter.createObservableGauge("daily_brief_users_total", {
    description: "Users who have at least one daily brief",
  });
  const briefsGauge = meter.createObservableGauge("daily_brief_total", {
    description: "Daily briefs generated globally",
  });
  const regenerationsGauge = meter.createObservableGauge("daily_brief_regenerations_total", {
    description: "Daily brief regenerations requested globally",
  });
  const regenUsersGauge = meter.createObservableGauge("daily_brief_regen_users_total", {
    description: "Users who have requested at least one daily brief regeneration",
  });

  meter.addBatchObservableCallback(
    async (result) => {
      try {
        const where = { kind: DAILY_BRIEF_KIND, generatedAt: { not: null } };
        const redis = redisService.getConnection();
        const [briefs, users, regenerations, regenUsers] = await Promise.all([
          prisma.generatedContent.count({ where }),
          prisma.generatedContent.groupBy({ by: ["userId"], where }),
          redis.get(REGEN_COUNT_KEY).catch(() => null),
          redis.scard(REGEN_USERS_KEY).catch(() => 0),
        ]);
        result.observe(usersGauge, users.length);
        result.observe(briefsGauge, briefs);
        result.observe(regenerationsGauge, Number(regenerations ?? 0));
        result.observe(regenUsersGauge, regenUsers);
      } catch (err) {
        // OTel swallows a rejected callback silently — log so a broken read is visible.
        log.warn(`[otel] daily-brief gauges skipped: ${err instanceof Error ? err.message : String(err)}`);
      }
    },
    [usersGauge, briefsGauge, regenerationsGauge, regenUsersGauge],
  );
}
