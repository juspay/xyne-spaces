import type { z } from 'zod';
import { BaseTrigger } from './base-trigger.js';

/**
 * Manual trigger — fires only via `runtime.triggerManual()`.
 *
 * Used for test runs and user-initiated workflow executions.
 * The payload is whatever the caller passes.
 */
export abstract class ManualTrigger<
  TConfig extends z.ZodTypeAny = z.ZodTypeAny,
  TOutput extends z.ZodTypeAny = z.ZodTypeAny,
> extends BaseTrigger<TConfig, TOutput> {}
