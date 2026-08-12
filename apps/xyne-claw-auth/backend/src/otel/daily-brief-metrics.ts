import { metrics } from "@opentelemetry/api";
import type { Counter, Histogram, Meter } from "@opentelemetry/api";
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
/** Users who ever re-ran the brief the cron produced for them. */
const DEFAULT_REJECTED_USERS_KEY = "daily_brief:default_rejected_users";
/** Users who ever re-ran a brief they had already regenerated once. */
const REPEAT_REGEN_USERS_KEY = "daily_brief:repeat_regen_users";
/** Per user per day, so we know which attempt a request is. Two days is plenty. */
const dayAttemptKey = (userId: string, dateBucket: string): string =>
  `daily_brief:regen:${userId}:${dateBucket}`;
const DAY_ATTEMPT_TTL_SECONDS = 48 * 60 * 60;

/**
 * Why this regeneration was asked for — the whole point of the attempt metric is
 * separating "the brief was bad" from "the run errored" and from "there was no
 * brief yet", which look identical if you only count regenerations.
 */
export type RegenerationOrigin =
  | "replacing_scheduled_brief" /** re-running the brief the cron generated — rejecting the default */
  | "replacing_own_regeneration" /** re-running a brief the user had already regenerated */
  | "retry_after_failure" /** the previous attempt failed; not a quality signal */
  | "first_brief_of_day"; /** nothing existed yet — this creates the day's brief */

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

// A brief is a full agent run — tens of seconds to minutes — so the default
// bucket ceiling of 10s would put every observation in +Inf and pin every
// quantile to 10000. Same reason the delivery-delay buckets run to 8h.
const DURATION_BUCKETS_MS = [
  5_000, 15_000, 30_000, 60_000, 90_000, 120_000, 180_000, 300_000, 600_000, 900_000,
];
const DELIVERY_DELAY_BUCKETS_MS = [
  60_000, 300_000, 900_000, 1_800_000, 3_600_000, 7_200_000, 14_400_000, 28_800_000,
];

// Naming: no `_ms` in the metric name — the Prometheus translation appends
// `_milliseconds` from the unit, and `http_request_duration_ms_milliseconds`
// already exists in this stack from doing it the other way.
let _generationDuration: Histogram | null = null;
function getGenerationDuration(): Histogram {
  if (!_generationDuration) {
    _generationDuration = getMeter().createHistogram("daily_brief_generation_duration", {
      description: "Wall-clock duration of a daily brief run, by trigger and outcome",
      unit: "ms",
      advice: { explicitBucketBoundaries: DURATION_BUCKETS_MS },
    });
  }
  return _generationDuration;
}

let _deliveryDelay: Histogram | null = null;
function getDeliveryDelay(): Histogram {
  if (!_deliveryDelay) {
    _deliveryDelay = getMeter().createHistogram("daily_brief_scheduled_delivery_delay", {
      description: "How late the scheduled brief was ready versus the cron's target time",
      unit: "ms",
      advice: { explicitBucketBoundaries: DELIVERY_DELAY_BUCKETS_MS },
    });
  }
  return _deliveryDelay;
}

export function recordDailyBriefGenerated(
  trigger: DailyBriefTrigger,
  status: "ready" | "failed",
  durationMs: number,
): void {
  try {
    const attributes = { trigger, status };
    getDailyBriefGeneratedTotal().add(1, attributes);
    getGenerationDuration().record(durationMs, attributes);
  } catch {
    // metrics must never break a brief run
  }
}

/**
 * How long after the cron's target time the brief actually landed — the SLO the
 * user feels ("is my 6 AM brief there at 6 AM"), covering queue wait, the global
 * LLM slot gate and the run itself.
 *
 * The target is the bucket date at the configured UTC hour, which holds while
 * that hour and the IST bucket fall on the same calendar date (true for the
 * 00:30 UTC default). A nonsensical result is dropped rather than reported.
 */
export function recordScheduledDeliveryDelay(dateBucket: string, generatedAt: Date): void {
  try {
    const hh = String(CONFIG.dailyBriefCronUtcHour).padStart(2, "0");
    const mm = String(CONFIG.dailyBriefCronUtcMinute).padStart(2, "0");
    const target = Date.parse(`${dateBucket}T${hh}:${mm}:00Z`);
    if (Number.isNaN(target)) return;
    const delay = generatedAt.getTime() - target;
    if (delay < 0 || delay > 24 * 60 * 60 * 1000) {
      log.warn(
        `[otel] delivery delay not recorded for ${dateBucket}: ${Math.round(delay / 1000)}s off the ${hh}:${mm}Z target — check DAILY_BRIEF_CRON_UTC_HOUR against the IST bucket`,
      );
      return;
    }
    getDeliveryDelay().record(delay);
  } catch {
    // metrics must never break a brief run
  }
}

// Daily Brief Regeneration Attempts — labels: attempt (1 | 2 | 3 | 4+), origin
let _regenerationAttempts: Counter | null = null;
function getRegenerationAttempts(): Counter {
  if (!_regenerationAttempts) {
    _regenerationAttempts = getMeter().createCounter("daily_brief_regeneration_attempts_total", {
      description: "Regeneration requests, by how many times today's brief has been re-run and why",
      unit: "1",
    });
  }
  return _regenerationAttempts;
}

/**
 * Count one regeneration request, the user behind it, and — the useful part —
 * which attempt of the day it is and what it is replacing. Best-effort.
 *
 * @param existing today's stored brief as it looked before this run started.
 */
export async function recordDailyBriefRegeneration(
  userId: string,
  dateBucket: string,
  existing: { status: string; generatedAt: Date | null } | null,
): Promise<void> {
  try {
    const redis = redisService.getConnection();
    const dayKey = dayAttemptKey(userId, dateBucket);
    const attempt = await redis.incr(dayKey);
    await redis.expire(dayKey, DAY_ATTEMPT_TTL_SECONDS);

    const origin: RegenerationOrigin =
      existing?.status === "failed"
        ? "retry_after_failure"
        : attempt > 1
          ? "replacing_own_regeneration"
          : existing?.generatedAt
            ? "replacing_scheduled_brief"
            : "first_brief_of_day";

    getRegenerationAttempts().add(1, {
      attempt: attempt >= 4 ? "4+" : String(attempt),
      origin,
    });

    const writes = redis.multi().incr(REGEN_COUNT_KEY).sadd(REGEN_USERS_KEY, userId);
    if (origin === "replacing_scheduled_brief") writes.sadd(DEFAULT_REJECTED_USERS_KEY, userId);
    // Gate on origin, not just the attempt number: someone retrying after a failed
    // run has attempt >= 2 without being dissatisfied with anything.
    if (origin === "replacing_own_regeneration") writes.sadd(REPEAT_REGEN_USERS_KEY, userId);
    await writes.exec();
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
  const defaultRejectedGauge = meter.createObservableGauge(
    "daily_brief_default_rejected_users_total",
    { description: "Users who have re-run the brief the cron generated for them" },
  );
  const repeatRegenGauge = meter.createObservableGauge("daily_brief_repeat_regen_users_total", {
    description: "Users who have re-run a brief they had already regenerated",
  });

  meter.addBatchObservableCallback(
    async (result) => {
      try {
        const where = { kind: DAILY_BRIEF_KIND, generatedAt: { not: null } };
        const redis = redisService.getConnection();
        const [briefs, users, regenerations, regenUsers, defaultRejected, repeatRegen] =
          await Promise.all([
            prisma.generatedContent.count({ where }),
            prisma.generatedContent.groupBy({ by: ["userId"], where }),
            redis.get(REGEN_COUNT_KEY).catch(() => null),
            redis.scard(REGEN_USERS_KEY).catch(() => 0),
            redis.scard(DEFAULT_REJECTED_USERS_KEY).catch(() => 0),
            redis.scard(REPEAT_REGEN_USERS_KEY).catch(() => 0),
          ]);
        result.observe(usersGauge, users.length);
        result.observe(briefsGauge, briefs);
        result.observe(regenerationsGauge, Number(regenerations ?? 0));
        result.observe(regenUsersGauge, regenUsers);
        result.observe(defaultRejectedGauge, defaultRejected);
        result.observe(repeatRegenGauge, repeatRegen);
      } catch (err) {
        // OTel swallows a rejected callback silently — log so a broken read is visible.
        log.warn(`[otel] daily-brief gauges skipped: ${err instanceof Error ? err.message : String(err)}`);
      }
    },
    [
      usersGauge,
      briefsGauge,
      regenerationsGauge,
      regenUsersGauge,
      defaultRejectedGauge,
      repeatRegenGauge,
    ],
  );
}
