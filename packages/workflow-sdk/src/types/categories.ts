import { z } from 'zod';

export enum TriggerCategory {
  EVENT = 'event',
  WEBHOOK = 'webhook',
  CRON = 'cron',
  MANUAL = 'manual',
}

export const TriggerCategorySchema = z.nativeEnum(TriggerCategory);

/**
 * Step category is a plain string — the SDK only uses 'control' internally.
 * Host defines domain-specific categories ('messaging', 'ticket', 'ai', etc.).
 */
export type StepCategory = 'control' | (string & {});
