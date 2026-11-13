import { z } from 'zod';
import { ManualTrigger } from '../../../triggers/manual-trigger.js';
import { BuiltinTriggerType } from '../../../types/known-types.js';
import { TriggerCategory } from '../../../types/categories.js';

/**
 * Default manual trigger — fires via `runtime.triggerManual()`.
 *
 * The author-supplied `inputSchema` fully describes the payload, including any
 * file inputs: a document is just a typed field carrying `format: 'attachment'`
 * (single) or an array of those (multiple). There is no separate attachments
 * slot — uploaded files become ordinary named fields, so they're referenced by
 * name (`{{trigger.pan}}`) and validated by the schema like any other input.
 */
export const DefaultManualTriggerConfigSchema = z.object({
  inputSchema: z.record(z.unknown()).optional()
    .describe('JSON Schema describing the expected manual input (incl. attachment fields). The UI renders a form from this when triggering'),
});

/** The author's own input schema decides the shape; see `resolveOutputJsonSchema`. */
const DefaultManualTriggerOutputSchema = z.record(z.unknown());

export class DefaultManualTrigger extends ManualTrigger<
  typeof DefaultManualTriggerConfigSchema,
  typeof DefaultManualTriggerOutputSchema
> {
  override readonly type = BuiltinTriggerType.MANUAL;
  override readonly name = 'Manual Trigger';
  override readonly description = 'Trigger a workflow manually with a custom payload';
  override readonly category = TriggerCategory.MANUAL;
  override readonly icon = 'cursor';
  override readonly configSchema = DefaultManualTriggerConfigSchema;
  override readonly outputSchema = DefaultManualTriggerOutputSchema;

  override decorateConfigSchema(jsonSchema: Record<string, unknown>): Record<string, unknown> {
    const props = jsonSchema['properties'] as Record<string, Record<string, unknown>> | undefined;
    if (props?.['inputSchema']) {
      props['inputSchema'] = { ...props['inputSchema'], format: 'json-schema' };
    }
    return jsonSchema;
  }

  /**
   * The `inputSchema` *is* the shape of `context.trigger` — whatever the author
   * declared (typed fields and attachment fields alike) is what the variable
   * picker sees. Attachment fields already carry `format: 'attachment'`, so the
   * picker types them as `attachment` / `attachment[]` with no special-casing
   * here. Falls back to a permissive object when no schema was declared.
   */
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
