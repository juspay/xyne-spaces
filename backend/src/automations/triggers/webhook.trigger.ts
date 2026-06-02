import { z } from 'zod';
import { BaseTrigger } from './base-trigger';
import { TriggerCategory } from '../types/categories';
import { OutputSchemaSchema } from '../engine/declared-schema';

export const WEBHOOK_EVENT = 'WEBHOOK';

const WebhookTriggerConfigSchema = z.object({
  bodySchema: OutputSchemaSchema.default({}).describe(
    'Expected JSON body shape. Declared keys are required on every call (extra keys are allowed); a 400 is returned on mismatch.',
  ),
  headerSchema: OutputSchemaSchema.default({}).describe(
    'Expected request headers. Declared header names are required on every call (extra headers allowed). Give a header the "secret" type to redact its value before the request is stored.',
  ),
});

export type WebhookTriggerConfig = z.infer<typeof WebhookTriggerConfigSchema>;

const WebhookTriggerOutputSchema = z.object({
  body: z.record(z.unknown()),
  headers: z.record(z.unknown()),
  receivedAt: z.string(),
});

export class WebhookTrigger extends BaseTrigger<typeof WebhookTriggerConfigSchema> {
  readonly type = WEBHOOK_EVENT;
  readonly configSchema = WebhookTriggerConfigSchema;
  readonly outputSchema = WebhookTriggerOutputSchema;
  readonly name = 'When an external webhook is received';
  readonly description =
    'Fires when a third-party app POSTs to this automation’s unique webhook URL. Define the expected body and headers; the request payload is available to downstream steps.';
  readonly category = TriggerCategory.EVENT;
  readonly icon = 'Webhook';
  readonly requiresScopeFilter = false;
}

export const webhookTrigger = new WebhookTrigger();
