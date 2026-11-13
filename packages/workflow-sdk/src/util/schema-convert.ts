/**
 * Thin wrapper around `zod-to-json-schema` for registry descriptors.
 *
 * Centralised so the conversion options stay consistent across the SDK.
 */

import { zodToJsonSchema } from 'zod-to-json-schema';
import type { z } from 'zod';
import { applyMarks } from './schema-marks.js';

/**
 * Convert a Zod schema to a plain JSON Schema object.
 *
 * Returns `Record<string, unknown>` so callers don't need to
 * depend on the `zod-to-json-schema` package directly.
 *
 * Every conversion carries {@link applyMarks}, so a field declared with
 * `withOptions` or `variableRef` arrives marked wherever it sits — the
 * converter's own recursion does the walking, and nothing here has to know the
 * shape of the schema.
 */
export function zodToJsonSchemaRecord(
  schema: z.ZodTypeAny,
): Record<string, unknown> {
  return zodToJsonSchema(schema, { postProcess: applyMarks }) as Record<string, unknown>;
}
