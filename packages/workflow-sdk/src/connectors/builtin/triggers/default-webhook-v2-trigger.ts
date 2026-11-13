import { DefaultManualTriggerConfigSchema } from './default-manual-trigger.js';
import { ApiTrigger } from '../../../triggers/api-trigger.js';
import { BuiltinTriggerType } from '../../../types/known-types.js';
import { TriggerCategory } from '../../../types/categories.js';

/**
 * API trigger for multipart payloads, and the generic way for a host's API
 * clients to start a workflow.
 *
 * The host authenticates the caller, and the runtime checks the caller may run
 * the workflow. Like the manual trigger, the author-supplied `inputSchema` is the
 * complete contract for `context.trigger`; the `/trigger/v2` route only
 * translates multipart fields into that schema-shaped payload.
 */
export class DefaultWebhookV2Trigger extends ApiTrigger<typeof DefaultManualTriggerConfigSchema> {
  override readonly type = BuiltinTriggerType.WEBHOOK_V2;
  override readonly name = 'Webhook V2';
  override readonly description = 'Trigger a workflow with multipart form-data';
  override readonly category = TriggerCategory.WEBHOOK;
  override readonly icon = 'webhook';
  override readonly configSchema = DefaultManualTriggerConfigSchema;
  override readonly outputSchema = DefaultManualTriggerConfigSchema.shape.inputSchema.unwrap();

  override decorateConfigSchema(jsonSchema: Record<string, unknown>): Record<string, unknown> {
    const props = jsonSchema['properties'] as Record<string, Record<string, unknown>> | undefined;
    if (props?.['inputSchema']) {
      props['inputSchema'] = { ...props['inputSchema'], format: 'json-schema' };
    }
    return jsonSchema;
  }

  override resolveOutputJsonSchema(config: Record<string, unknown>): Record<string, unknown> {
    const inputSchema = config['inputSchema'];
    const hasInputSchema =
      inputSchema &&
      typeof inputSchema === 'object' &&
      !Array.isArray(inputSchema) &&
      Object.keys(inputSchema as Record<string, unknown>).length > 0;

    return hasInputSchema
      ? { ...(inputSchema as Record<string, unknown>) }
      : { type: 'object', additionalProperties: true };
  }
}
