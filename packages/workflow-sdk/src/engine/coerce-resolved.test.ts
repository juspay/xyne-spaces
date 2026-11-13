import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { coerceResolvedToSchema } from './variable-resolver.js';
import { variableRef } from '../types/workflow-config.js';

describe('coerceResolvedToSchema', () => {
  it('stringifies a non-string value bound into a plain string field', () => {
    const schema = z.object({ note: z.string() });
    const out = coerceResolvedToSchema({ note: [{ name: 'a.pdf', data: 'hi' }] }, schema) as {
      note: string;
    };
    expect(typeof out.note).toBe('string');
    expect(out.note).toBe(JSON.stringify([{ name: 'a.pdf', data: 'hi' }]));
    expect(schema.safeParse(out).success).toBe(true);
  });

  it('stringifies into a variableRef(string) field (the common consumer shape)', () => {
    const schema = z.object({ prompt: variableRef(z.string()) });
    const out = coerceResolvedToSchema({ prompt: { a: 1 } }, schema) as { prompt: string };
    expect(out.prompt).toBe(JSON.stringify({ a: 1 }));
    expect(schema.safeParse(out).success).toBe(true);
  });

  it('coerces a number into a string field', () => {
    const schema = z.object({ label: z.string() });
    const out = coerceResolvedToSchema({ label: 42 }, schema) as { label: string };
    expect(out.label).toBe('42');
  });

  it('leaves matching values untouched', () => {
    const schema = z.object({ name: z.string(), count: z.number(), on: z.boolean() });
    const input = { name: 'x', count: 3, on: true };
    expect(coerceResolvedToSchema(input, schema)).toEqual(input);
  });

  it('does NOT coerce into number / boolean / enum targets', () => {
    const schema = z.object({
      n: z.number(),
      b: z.boolean(),
      e: z.enum(['a', 'b']),
    });
    // resolved values are the "wrong" type; coercion must NOT touch them so
    // safeParse fails loudly rather than silently mangling.
    const input = { n: [1, 2], b: 'nope', e: 5 };
    expect(coerceResolvedToSchema(input, schema)).toEqual(input);
  });

  it('recurses into nested objects and array elements', () => {
    const schema = z.object({
      meta: z.object({ id: z.string() }),
      tags: z.array(z.string()),
    });
    const out = coerceResolvedToSchema(
      { meta: { id: 7 }, tags: [1, { x: 2 }] },
      schema,
    ) as { meta: { id: string }; tags: string[] };
    expect(out.meta.id).toBe('7');
    expect(out.tags).toEqual(['1', JSON.stringify({ x: 2 })]);
  });

  it('passes null / undefined through unchanged', () => {
    const schema = z.object({ note: z.string().optional() });
    expect(coerceResolvedToSchema({ note: undefined }, schema)).toEqual({ note: undefined });
    expect(coerceResolvedToSchema({ note: null }, schema)).toEqual({ note: null });
  });

  it('reaches string slots buried in a discriminated union (the WAIT case)', () => {
    // Mirrors WaitStepConfigSchema: discriminatedUnion('mode') → object → array
    // → discriminatedUnion('type') → object → label: z.string().
    const schema = z.discriminatedUnion('mode', [
      z.object({ mode: z.literal('delay'), delayMs: z.number() }),
      z.object({
        mode: z.literal('approval'),
        reason: z.string(),
        form: z
          .object({
            fields: z.array(
              z.discriminatedUnion('type', [
                z.object({ type: z.literal('text'), name: z.string(), label: z.string() }),
              ]),
            ),
          })
          .optional(),
      }),
    ]);
    const out = coerceResolvedToSchema(
      {
        mode: 'approval',
        reason: 'review',
        form: { fields: [{ type: 'text', name: 'note', label: 42 }] },
      },
      schema,
    ) as { form: { fields: Array<{ label: string }> } };
    expect(out.form.fields[0]!.label).toBe('42');
    expect(schema.safeParse(out).success).toBe(true);
  });

  it('stringifies string-typed record values', () => {
    const schema = z.object({ headers: z.record(z.string()) });
    const out = coerceResolvedToSchema({ headers: { 'x-count': 7, ok: 'yes' } }, schema) as {
      headers: Record<string, string>;
    };
    expect(out.headers['x-count']).toBe('7');
    expect(out.headers['ok']).toBe('yes');
    expect(schema.safeParse(out).success).toBe(true);
  });

  it('leaves a valid config untouched', () => {
    const schema = z.object({ a: z.string(), b: z.number(), c: z.array(z.string()) });
    const input = { a: 'x', b: 2, c: ['p', 'q'] };
    expect(coerceResolvedToSchema(input, schema)).toEqual(input);
  });
});
