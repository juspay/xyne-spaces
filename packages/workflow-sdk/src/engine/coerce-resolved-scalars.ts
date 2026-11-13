import { z } from 'zod';

const literalNumber = (v: unknown): unknown =>
  typeof v === 'string' && v !== '' && !Number.isNaN(Number(v)) ? Number(v) : v;

const literalBoolean = (v: unknown): unknown =>
  v === 'true' ? true : v === 'false' ? false : v;

function withoutRefUnions(schema: z.ZodTypeAny): z.ZodTypeAny {
  if (schema instanceof z.ZodNumber) return z.preprocess(literalNumber, z.number());
  if (schema instanceof z.ZodBoolean) return z.preprocess(literalBoolean, z.boolean());
  if (schema instanceof z.ZodUnion) {
    const kept = schema.options.filter((o: z.ZodTypeAny) => !(o instanceof z.ZodString));
    return kept.length === 1 && kept[0] ? withoutRefUnions(kept[0]) : schema;
  }
  if (schema instanceof z.ZodOptional || schema instanceof z.ZodNullable) {
    return withoutRefUnions(schema.unwrap());
  }
  if (schema instanceof z.ZodDefault) {
    return withoutRefUnions(schema.removeDefault());
  }
  if (schema instanceof z.ZodObject) {
    const shape = schema.shape as Record<string, z.ZodTypeAny>;
    const next: Record<string, z.ZodTypeAny> = {};
    let changed = false;
    for (const [k, v] of Object.entries(shape)) {
      next[k] = withoutRefUnions(v);
      changed ||= next[k] !== v;
    }
    if (!changed) return schema;
    const rebuilt = z.object(next);
    const keys = schema._def.unknownKeys;
    if (keys === 'passthrough') return rebuilt.passthrough();
    if (keys === 'strict') return rebuilt.strict();
    return rebuilt;
  }
  if (schema instanceof z.ZodDiscriminatedUnion) {
    const options = schema.options as unknown as z.ZodDiscriminatedUnionOption<string>[];
    const next = options.map((o) => withoutRefUnions(o) as z.ZodDiscriminatedUnionOption<string>);
    return next.some((o, i) => o !== options[i])
      ? z.discriminatedUnion(schema.discriminator, [next[0]!, ...next.slice(1)])
      : schema;
  }
  if (schema instanceof z.ZodArray) return z.array(withoutRefUnions(schema.element));
  if (schema instanceof z.ZodRecord) return z.record(withoutRefUnions(schema.valueSchema));
  return schema;
}

export function coerceResolvedScalars(
  value: unknown,
  schema: z.ZodTypeAny,
): unknown {
  if (schema.safeParse(value).success) return value;
  const coerced = withoutRefUnions(schema).safeParse(value);
  if (!coerced.success || value === null || typeof value !== 'object') return value;
  const merged = {
    ...(value as Record<string, unknown>),
    ...(coerced.data as Record<string, unknown>),
  };
  return schema.safeParse(merged).success ? merged : value;
}
