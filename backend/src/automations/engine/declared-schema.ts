import { z } from 'zod';

// `secret` is a string leaf that also marks a header sensitive (value redacted).
export const OutputFieldTypeSchema = z.enum([
  'string',
  'number',
  'boolean',
  'object',
  'array',
  'secret',
]);
export type OutputFieldType = z.infer<typeof OutputFieldTypeSchema>;

const OutputSchemaNodeSchema: z.ZodType<unknown> = z.lazy(() =>
  z.union([OutputFieldTypeSchema, z.record(z.string().min(1), OutputSchemaNodeSchema)]),
);

export const OutputSchemaSchema = z.record(z.string().min(1), OutputSchemaNodeSchema);
export type OutputSchema = z.infer<typeof OutputSchemaSchema>;

export function assertMatchesSchema(
  actual: Record<string, unknown>,
  declared: Record<string, unknown>,
  path = '',
): void {
  for (const [key, expected] of Object.entries(declared)) {
    const here = path ? `${path}.${key}` : key;
    if (!(key in actual)) throw new Error(`required key "${here}" missing`);
    const v = actual[key];
    const actualType = Array.isArray(v) ? 'array' : v === null ? 'null' : typeof v;
    if (typeof expected === 'string') {
      const wanted = expected === 'secret' ? 'string' : expected;
      if (actualType !== wanted) {
        throw new Error(`key "${here}" expected ${wanted}, got ${actualType}`);
      }
    } else if (expected && typeof expected === 'object' && !Array.isArray(expected)) {
      if (actualType !== 'object') {
        throw new Error(`key "${here}" expected object, got ${actualType}`);
      }
      assertMatchesSchema(v as Record<string, unknown>, expected as Record<string, unknown>, here);
    }
  }
}
