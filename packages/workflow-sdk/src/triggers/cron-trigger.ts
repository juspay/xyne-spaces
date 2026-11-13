import type { z } from 'zod';
import { BaseTrigger } from './base-trigger.js';
import type { ServiceRegistry } from '../engine/service-registry.js';

// ─── Types ───

/**
 * Cron schedule returned by a CronTrigger.
 *
 * Timezone is intentionally not exposed at the trigger level — the runtime
 * applies its `defaultCronTimezone` (configured via RuntimeOptions, defaults
 * to `Asia/Kolkata`) when registering with the SchedulerAdapter. This keeps
 * workflow authors out of the timezone-config business; hosts pick the
 * scheduling policy once at deployment time.
 */
export interface CronSchedule {
  expression: string;
}

export interface CronPollContext<
  TServices extends Record<string, unknown> = Record<string, unknown>,
> {
  services: ServiceRegistry<TServices>;
  staticData: {
    get(key: string): Promise<unknown>;
    set(key: string, value: unknown): Promise<void>;
    delete(key: string): Promise<void>;
  };
  metadata: Record<string, unknown>;
}

// ─── CronTrigger ───

/**
 * Scheduled trigger — fires on a cron schedule.
 *
 * On activation, the runtime registers a cron job via the SchedulerAdapter.
 * Each tick calls `poll()` (if defined) to check whether to fire. If `poll()`
 * is not defined, every tick fires the workflow.
 *
 * `poll()` is useful for "check every 5 minutes for new items" patterns.
 * Use `staticData` to track high-water marks across ticks.
 */
export abstract class CronTrigger<
  TConfig extends z.ZodTypeAny = z.ZodTypeAny,
  TOutput extends z.ZodTypeAny = z.ZodTypeAny,
> extends BaseTrigger<TConfig, TOutput> {
  /**
   * Extract the cron schedule from the trigger config.
   */
  abstract getSchedule(config: z.infer<TConfig>): CronSchedule;

  /**
   * Optional poll function called on each cron tick.
   * Return data to fire the workflow, or `null` to skip this tick.
   */
  poll?(
    config: z.infer<TConfig>,
    ctx: CronPollContext,
  ): Promise<Record<string, unknown> | null>;

  /**
   * Build a default trigger payload when `poll()` is not defined.
   * Override to customize what the workflow receives.
   * Default: `{ firedAt: <ISO string> }`.
   */
  buildPayload?(config: z.infer<TConfig>): Record<string, unknown>;
}
