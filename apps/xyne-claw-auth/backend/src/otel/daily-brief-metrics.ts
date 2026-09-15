import { metrics } from "@opentelemetry/api";
import { errMsg } from "../lib/errors.js";
import type { Counter, Histogram, Meter } from "@opentelemetry/api";
import { CONFIG } from "../config.js";
import { prisma } from "../db.js";
import { redisService } from "../redis.js";
import { createLogger } from "../logger.js";
import { DAILY_BRIEF_KIND } from "../repositories/index.js";
import { formatDayIST } from "../lib/ist-time.js";

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
/** Which control the user switched briefs from. Bounded — never widen without checking cardinality. */
export type BriefSwitchSource = "history_menu" | "date_picker";

/**
 * Switching briefs is client state the server never sees on its own (the screen
 * holds the recent window in memory), so the dashboard beacons it here. Counted
 * by userId in Redis rather than as a metric label: one series per user would be
 * unbounded cardinality and PII in a store with no per-series access control.
 */
const SWITCH_USERS_KEY = "daily_brief:switch_users";
/** Switch events, not people — one INCR per switch, globally and per control. */
const SWITCH_COUNT_KEY = "daily_brief:switches";
const switchSourceCountKey = (source: BriefSwitchSource): string =>
  `daily_brief:switches:src:${source}`;
const switchSourceKey = (source: BriefSwitchSource): string =>
  `daily_brief:switch_users:src:${source}`;
/** HyperLogLog per day: a windowed distinct count without one Redis member per user per day. */
const switchDayKey = (dateBucket: string): string => `daily_brief:switch_users:day:${dateBucket}`;

const DAY_HLL_TTL_SECONDS = 35 * 24 * 60 * 60;

/** Activity kinds recorded per user per day in Postgres. Bounded set. */
export type DailyBriefActivityKind = "view" | "regenerate" | "switch";

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
  attempt = 1,
): void {
  try {
    const attributes = { trigger, status, attempt: attemptBucket(attempt) };
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

// Daily Brief Opt-In Changes — labels: action (opted_in | opted_out)
let _optInChanges: Counter | null = null;
function getOptInChanges(): Counter {
  if (!_optInChanges) {
    _optInChanges = getMeter().createCounter("daily_brief_opt_in_changes_total", {
      description: "Daily Brief master toggle flips, by direction",
      unit: "1",
    });
  }
  return _optInChanges;
}

/** Count one master-toggle flip. Only call when the stored value actually changed. */
export function recordDailyBriefOptInChange(enabled: boolean): void {
  try {
    getOptInChanges().add(1, { action: enabled ? "opted_in" : "opted_out" });
  } catch {
    // metrics must never break a request
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

/** Bounded attempt bucket shared by the attempts counter and the completion counter. */
function attemptBucket(attempt: number): string {
  return attempt >= 4 ? "4+" : String(attempt);
}

/**
 * Count one regeneration request, the user behind it, and — the useful part —
 * which attempt of the day it is and what it is replacing. Best-effort.
 *
 * @param existing today's stored brief as it looked before this run started.
 */
export async function recordDailyBriefRegeneration(
  userId: string,
  orgId: string,
  dateBucket: string,
  existing: { status: string; generatedAt: Date | null } | null,
): Promise<number> {
  try {
    const redis = redisService.getConnection();
    const dayKey = dayAttemptKey(userId, dateBucket);
    const attempt = await redis.incr(dayKey);
    void finishRegenerationRecord(userId, orgId, dateBucket, existing, attempt, dayKey);
    return attempt;
  } catch {
    // metrics must never break a brief run
    return 1;
  }
}

async function finishRegenerationRecord(
  userId: string,
  orgId: string,
  dateBucket: string,
  existing: { status: string; generatedAt: Date | null } | null,
  attempt: number,
  dayKey: string,
): Promise<void> {
  try {
    const redis = redisService.getConnection();
    await redis.expire(dayKey, DAY_ATTEMPT_TTL_SECONDS);

    const origin: RegenerationOrigin =
      existing?.status === "failed"
        ? "retry_after_failure"
        : attempt > 1
          ? "replacing_own_regeneration"
          : existing?.generatedAt
            ? "replacing_scheduled_brief"
            : "first_brief_of_day";

    getRegenerationAttempts().add(1, { attempt: attemptBucket(attempt), origin });

    const writes = redis.multi().incr(REGEN_COUNT_KEY).sadd(REGEN_USERS_KEY, userId);
    if (origin === "replacing_scheduled_brief") writes.sadd(DEFAULT_REJECTED_USERS_KEY, userId);
    // Gate on origin, not just the attempt number: someone retrying after a failed
    // run has attempt >= 2 without being dissatisfied with anything.
    if (origin === "replacing_own_regeneration") writes.sadd(REPEAT_REGEN_USERS_KEY, userId);
    await writes.exec();
    const isRejection =
      origin === "replacing_scheduled_brief" || origin === "replacing_own_regeneration";
    await recordDailyBriefActivity(userId, orgId, "regenerate", dateBucket, isRejection);
  } catch {
    // metrics must never break a brief run
  }
}

/**
 * Upsert one row per user per day per kind. Distinct-user counts over an arbitrary
 * date range then come from COUNT(DISTINCT "userId") in Postgres, which is exact
 * and unbounded in lookback — a fixed-window sketch can be neither. Repeat activity
 * on the same day bumps `count` instead of adding a row, so the table stays bounded
 * at one row per user per day per kind however heavy the usage.
 *
 * @param isRejection increments `rejectionCount` alongside `count`.
 */
export async function recordDailyBriefActivity(
  userId: string,
  orgId: string,
  kind: DailyBriefActivityKind,
  dateBucket: string,
  isRejection = false,
): Promise<void> {
  try {
    const now = new Date();
    const rejection = isRejection ? 1 : 0;
    await prisma.dailyBriefActivity.upsert({
      where: { userId_kind_dateBucket: { userId, kind, dateBucket } },
      create: {
        userId,
        orgId,
        kind,
        dateBucket,
        count: 1,
        rejectionCount: rejection,
        occurredAt: now,
        lastSeenAt: now,
      },
      update: {
        count: { increment: 1 },
        rejectionCount: { increment: rejection },
        lastSeenAt: now,
      },
    });
  } catch {
    // metrics must never break a request
  }
}

/** Record that a user switched to a different brief, from a given entry point. */
export async function recordDailyBriefSwitch(
  userId: string,
  orgId: string,
  source: BriefSwitchSource,
  dateBucket: string,
): Promise<void> {
  try {
    const redis = redisService.getConnection();
    const dayKey = switchDayKey(dateBucket);
    await redis
      .multi()
      .incr(SWITCH_COUNT_KEY)
      .incr(switchSourceCountKey(source))
      .sadd(SWITCH_USERS_KEY, userId)
      .sadd(switchSourceKey(source), userId)
      .pfadd(dayKey, userId)
      .expire(dayKey, DAY_HLL_TTL_SECONDS)
      .exec();
    await recordDailyBriefActivity(userId, orgId, "switch", dateBucket);
  } catch {
    // metrics must never break a request
  }
}

/** Record that a user opened a brief. */
export async function recordDailyBriefViewed(
  userId: string,
  orgId: string,
  dateBucket: string,
): Promise<void> {
  await recordDailyBriefActivity(userId, orgId, "view", dateBucket);
}

/** The last `days` day-bucket keys, newest first — the union PFCOUNT reads. */
function dayKeysBack(key: (dateBucket: string) => string, days: number): string[] {
  const now = Date.now();
  return Array.from({ length: days }, (_, i) =>
    key(formatDayIST(new Date(now - i * 24 * 60 * 60 * 1000))),
  );
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
  const switchUsersGauge = meter.createObservableGauge("daily_brief_switch_users_total", {
    description: "Users who have ever switched to a different brief",
  });
  const switchUsersWindowGauge = meter.createObservableGauge("daily_brief_switch_users_window", {
    description: "Distinct users who switched briefs within a trailing window (HyperLogLog, ~0.81% error)",
  });
  const switchUsersSourceGauge = meter.createObservableGauge("daily_brief_switch_users_by_source", {
    description: "Users who have ever switched briefs, by the control they used",
  });
  const switchesGauge = meter.createObservableGauge("daily_brief_switches_total", {
    description: "Brief switches ever served globally (events, not people)",
  });
  const switchesSourceGauge = meter.createObservableGauge("daily_brief_switches_by_source", {
    description: "Brief switches ever served, by the control used (events, not people)",
  });
  const enabledUsersGauge = meter.createObservableGauge("daily_brief_enabled_users_total", {
    description: "Users who currently have the Daily Brief switched on",
  });
  const eligibleUsersGauge = meter.createObservableGauge("daily_brief_eligible_users_total", {
    description: "All user accounts — the fixed denominator for the opt-in rate",
  });
  const deliveredTodayGauge = meter.createObservableGauge("daily_brief_delivered_today", {
    description: "Briefs ready for today's bucket — divide by opted-in users for fan-out coverage",
  });

  meter.addBatchObservableCallback(
    async (result) => {
      try {
        const where = { kind: DAILY_BRIEF_KIND, generatedAt: { not: null } };
        const redis = redisService.getConnection();
        const [
          briefs,
          users,
          regenerations,
          regenUsers,
          defaultRejected,
          repeatRegen,
          switchUsers,
          switch7d,
          switch30d,
          switchHistoryMenu,
          switchDatePicker,
          switches,
          switchesHistoryMenu,
          switchesDatePicker,
          enabledUsers,
          eligibleUsers,
          deliveredToday,
        ] = await Promise.all([
          prisma.generatedContent.count({ where }),
          prisma.generatedContent.groupBy({ by: ["userId"], where }),
          redis.get(REGEN_COUNT_KEY).catch(() => null),
          redis.scard(REGEN_USERS_KEY).catch(() => 0),
          redis.scard(DEFAULT_REJECTED_USERS_KEY).catch(() => 0),
          redis.scard(REPEAT_REGEN_USERS_KEY).catch(() => 0),
          redis.scard(SWITCH_USERS_KEY).catch(() => 0),
          redis.pfcount(...dayKeysBack(switchDayKey, 7)).catch(() => 0),
          redis.pfcount(...dayKeysBack(switchDayKey, 30)).catch(() => 0),
          redis.scard(switchSourceKey("history_menu")).catch(() => 0),
          redis.scard(switchSourceKey("date_picker")).catch(() => 0),
          redis.get(SWITCH_COUNT_KEY).catch(() => null),
          redis.get(switchSourceCountKey("history_menu")).catch(() => null),
          redis.get(switchSourceCountKey("date_picker")).catch(() => null),
          prisma.user.count({ where: { dailyBriefEnabled: true } }),
          prisma.user.count(),
          prisma.generatedContent.count({
            where: { ...where, dateBucket: formatDayIST(new Date()) },
          }),
        ]);
        result.observe(usersGauge, users.length);
        result.observe(briefsGauge, briefs);
        result.observe(regenerationsGauge, Number(regenerations ?? 0));
        result.observe(regenUsersGauge, regenUsers);
        result.observe(defaultRejectedGauge, defaultRejected);
        result.observe(repeatRegenGauge, repeatRegen);
        result.observe(switchUsersGauge, switchUsers);
        result.observe(switchUsersWindowGauge, switch7d, { window: "7d" });
        result.observe(switchUsersWindowGauge, switch30d, { window: "30d" });
        result.observe(switchUsersSourceGauge, switchHistoryMenu, { source: "history_menu" });
        result.observe(switchUsersSourceGauge, switchDatePicker, { source: "date_picker" });
        result.observe(switchesGauge, Number(switches ?? 0));
        result.observe(switchesSourceGauge, Number(switchesHistoryMenu ?? 0), {
          source: "history_menu",
        });
        result.observe(switchesSourceGauge, Number(switchesDatePicker ?? 0), {
          source: "date_picker",
        });
        result.observe(enabledUsersGauge, enabledUsers);
        result.observe(eligibleUsersGauge, eligibleUsers);
        result.observe(deliveredTodayGauge, deliveredToday);
      } catch (err) {
        // OTel swallows a rejected callback silently — log so a broken read is visible.
        log.warn(`[otel] daily-brief gauges skipped: ${errMsg(err)}`);
      }
    },
    [
      usersGauge,
      briefsGauge,
      regenerationsGauge,
      regenUsersGauge,
      defaultRejectedGauge,
      repeatRegenGauge,
      switchUsersGauge,
      switchUsersWindowGauge,
      switchUsersSourceGauge,
      switchesGauge,
      switchesSourceGauge,
      enabledUsersGauge,
      eligibleUsersGauge,
      deliveredTodayGauge,
    ],
  );
}
