import { z } from 'zod';
import { EventTrigger } from '../../../triggers/event-trigger.js';
import type { TriggerEvent } from '../../../ingest/types.js';
import { BuiltinTriggerType } from '../../../types/known-types.js';
import { TriggerCategory } from '../../../types/categories.js';

const DefaultEventTriggerConfigSchema = z.object({
  eventType: z.string().min(1).describe('The event type to listen for (e.g. "order.created", "user.signup")'),
});

/**
 * Default event trigger — fires when a matching event is dispatched.
 * Config accepts an event type string to filter on.
 */
/** A host event carries whatever the host dispatched; the engine does not narrow it. */
const DefaultEventTriggerOutputSchema = z.record(z.unknown());

export class DefaultEventTrigger extends EventTrigger<
  typeof DefaultEventTriggerConfigSchema,
  typeof DefaultEventTriggerOutputSchema
> {
  override readonly type = BuiltinTriggerType.EVENT;
  override readonly name = 'Event Trigger';
  override readonly description = 'Trigger a workflow when a specific event occurs';
  override readonly category = TriggerCategory.EVENT;
  override readonly icon = 'bell';
  override readonly configSchema = DefaultEventTriggerConfigSchema;
  override readonly outputSchema = DefaultEventTriggerOutputSchema;

  /**
   * Only the event type this workflow was configured for.
   *
   * Hosts that index workflows by domain event name never send a mismatched
   * event here; hosts that index by trigger type send every event to every
   * `EVENT` workflow, and without this they would all run.
   */
  override accepts(
    event: TriggerEvent,
    config: z.infer<typeof DefaultEventTriggerConfigSchema>,
  ): boolean {
    return event.type === config.eventType;
  }
}
