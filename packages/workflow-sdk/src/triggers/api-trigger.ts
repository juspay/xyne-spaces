import type { z } from 'zod';
import { ManualTrigger } from './manual-trigger.js';

/**
 * API trigger — started by a client calling the workflow's API trigger route.
 *
 * The SDK does not authenticate that caller; a host that exposes the route
 * guards it, for example with an API key. Like a manual trigger, the payload is
 * described by the author's input schema.
 *
 * The API trigger route accepts only workflows whose trigger is an `ApiTrigger`,
 * the same way the webhook route accepts only a `WebhookTrigger`.
 */
export abstract class ApiTrigger<
  TConfig extends z.ZodTypeAny = z.ZodTypeAny,
  TOutput extends z.ZodTypeAny = z.ZodTypeAny,
> extends ManualTrigger<TConfig, TOutput> {}
