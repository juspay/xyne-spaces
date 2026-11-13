import type { z } from 'zod';
import { BaseTrigger } from './base-trigger.js';

/**
 * Passive trigger — fires when the host calls `runtime.dispatchEvent()`.
 *
 * The runtime looks up all active workflows whose trigger type matches the
 * event type, then admits each one through `accepts()` → `hydrate()` → the
 * author's conditions, and enqueues the survivors.
 *
 * Hosts extend this for domain events (e.g. TicketCreatedTrigger).
 */
export abstract class EventTrigger<
  TConfig extends z.ZodTypeAny = z.ZodTypeAny,
  TOutput extends z.ZodTypeAny = z.ZodTypeAny,
  TRaw extends Record<string, unknown> = Record<string, unknown>,
> extends BaseTrigger<TConfig, TOutput, TRaw> {}
