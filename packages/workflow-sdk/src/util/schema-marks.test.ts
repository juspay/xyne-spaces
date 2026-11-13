import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { withOptions, isMarked, isOptionMarked } from './schema-marks.js';
import { zodToJsonSchemaRecord } from './schema-convert.js';
import { variableRef } from '../types/workflow-config.js';

/** Walk into a generated schema, so a test reads as the shape it asserts. */
function at(schema: Record<string, unknown>, ...path: readonly string[]): Record<string, unknown> {
  let node: Record<string, unknown> = schema;
  for (const seg of path) {
    const next = node[seg];
    if (typeof next !== 'object' || next === null) {
      throw new Error(`no "${seg}" in ${JSON.stringify(node)}`);
    }
    node = next as Record<string, unknown>;
  }
  return node;
}

const marked = (node: Record<string, unknown>): boolean => node['hasOptions'] === true;

describe('withOptions marks the field it wraps', () => {
  it('marks a plain field, and leaves its neighbours alone', () => {
    const schema = zodToJsonSchemaRecord(
      z.object({ owner: withOptions(z.string()), title: z.string() }),
    );
    expect(marked(at(schema, 'properties', 'owner'))).toBe(true);
    expect(marked(at(schema, 'properties', 'title'))).toBe(false);
  });

  it('survives .optional(), .nullable() and .default()', () => {
    // `.nullable()` emits a union, so the mark has to be lifted to the property
    // the editor reads — the others emit the inner node directly.
    const schema = zodToJsonSchemaRecord(
      z.object({
        a: withOptions(z.string()).optional(),
        b: withOptions(z.string()).nullable(),
        c: withOptions(z.string()).default('x'),
      }),
    );
    expect(marked(at(schema, 'properties', 'a'))).toBe(true);
    expect(marked(at(schema, 'properties', 'b'))).toBe(true);
    expect(marked(at(schema, 'properties', 'c'))).toBe(true);
  });

  it('does not care whether the modifier is inside or outside', () => {
    // The converter picks a different node to emit depending on the modifier,
    // so the author is not made responsible for guessing which.
    const schema = zodToJsonSchemaRecord(
      z.object({
        inside: withOptions(z.string().nullable()),
        outside: withOptions(z.string()).nullable(),
        deep: withOptions(z.string()).optional().nullable(),
      }),
    );
    expect(marked(at(schema, 'properties', 'inside'))).toBe(true);
    expect(marked(at(schema, 'properties', 'outside'))).toBe(true);
    expect(marked(at(schema, 'properties', 'deep'))).toBe(true);
  });

  it('marks an array field — the picker becomes multi-select', () => {
    const schema = zodToJsonSchemaRecord(z.object({ boardIds: withOptions(z.array(z.string())) }));
    expect(marked(at(schema, 'properties', 'boardIds'))).toBe(true);
    expect(at(schema, 'properties', 'boardIds')['type']).toBe('array');
  });

  it('marks a field nested inside an object', () => {
    const schema = zodToJsonSchemaRecord(
      z.object({ repository: z.object({ name: withOptions(z.string()), id: z.string() }) }),
    );
    expect(marked(at(schema, 'properties', 'repository', 'properties', 'name'))).toBe(true);
    expect(marked(at(schema, 'properties', 'repository', 'properties', 'id'))).toBe(false);
    // The object itself is not a picker just because a child is.
    expect(marked(at(schema, 'properties', 'repository'))).toBe(false);
  });

  it('marks a field inside an array of objects — one picker per row', () => {
    const schema = zodToJsonSchemaRecord(
      z.object({ rows: z.array(z.object({ repo: withOptions(z.string()), branch: z.string() })) }),
    );
    expect(marked(at(schema, 'properties', 'rows', 'items', 'properties', 'repo'))).toBe(true);
    expect(marked(at(schema, 'properties', 'rows', 'items', 'properties', 'branch'))).toBe(false);
  });

  it('marks two levels down', () => {
    const schema = zodToJsonSchemaRecord(
      z.object({ a: z.object({ b: z.object({ c: withOptions(z.string()) }) }) }),
    );
    expect(marked(at(schema, 'properties', 'a', 'properties', 'b', 'properties', 'c'))).toBe(true);
  });
});

describe('what it must not do', () => {
  it('does not mark a shared schema by proxy', () => {
    // The footgun the clone exists for: one instance, two fields, one wrapped.
    const Id = z.string();
    const schema = zodToJsonSchemaRecord(z.object({ picked: withOptions(Id), typed: Id }));
    expect(marked(at(schema, 'properties', 'picked'))).toBe(true);
    expect(marked(at(schema, 'properties', 'typed'))).toBe(false);
  });

  it('survives a .describe() applied afterwards', () => {
    // `.describe()` rebuilds the def rather than wrapping it, so a mark kept in
    // a table keyed by def identity would vanish here — and this is the order
    // most people write the field in.
    const schema = zodToJsonSchemaRecord(
      z.object({
        after: withOptions(z.string()).describe('Which workspace'),
        wrapped: withOptions(z.string()).optional().describe('Also fine'),
        before: withOptions(z.string().describe('Other way round')),
      }),
    );
    expect(marked(at(schema, 'properties', 'after'))).toBe(true);
    expect(marked(at(schema, 'properties', 'wrapped'))).toBe(true);
    expect(marked(at(schema, 'properties', 'before'))).toBe(true);
    expect(at(schema, 'properties', 'after')['description']).toBe('Which workspace');
  });

  it('leaves the author’s description intact', () => {
    const schema = zodToJsonSchemaRecord(
      z.object({ owner: withOptions(z.string().describe('Which account owns it')) }),
    );
    const owner = at(schema, 'properties', 'owner');
    expect(owner['description']).toBe('Which account owns it');
    expect(marked(owner)).toBe(true);
  });

  it('touches nothing when no field is wrapped', () => {
    const plain = z.object({ a: z.string(), b: z.number() });
    expect(JSON.stringify(zodToJsonSchemaRecord(plain))).not.toContain('hasOptions');
  });

  it('returns a schema that still validates exactly as the original did', () => {
    const Wrapped = withOptions(z.string().min(3));
    expect(Wrapped.safeParse('abc').success).toBe(true);
    expect(Wrapped.safeParse('ab').success).toBe(false);
  });
});

describe('composing with variableRef', () => {
  it('keeps both marks, whichever wraps whichever', () => {
    // The registry is keyed on the Zod def, and marking COPIES the schema — so a
    // second wrap has to carry the first mark across or it silently drops it.
    for (const owner of [variableRef(withOptions(z.string())), withOptions(variableRef(z.string()))]) {
      const owned = at(zodToJsonSchemaRecord(z.object({ owner })), 'properties', 'owner');
      expect(owned['hasOptions']).toBe(true);
      expect(owned['isVariableRef']).toBe(true);
    }
  });

  it('carries an existing mark onto the copy', () => {
    const both = withOptions(variableRef(z.string()));
    expect(isMarked(both._def, 'hasOptions')).toBe(true);
    expect(isMarked(both._def, 'isVariableRef')).toBe(true);
  });

  it('marks the property either way round', () => {
    // A ref is a legal value for a picked field, so the two compose. Whichever
    // wraps whichever, the mark must reach the node the editor reads.
    for (const owner of [variableRef(withOptions(z.string())), withOptions(variableRef(z.string()))]) {
      const schema = zodToJsonSchemaRecord(z.object({ owner }));
      expect(marked(at(schema, 'properties', 'owner'))).toBe(true);
    }
  });

  it('does not make a plain ref a picker', () => {
    const schema = zodToJsonSchemaRecord(z.object({ owner: variableRef(z.string()) }));
    expect(marked(at(schema, 'properties', 'owner'))).toBe(false);
  });
});

describe('isOptionMarked', () => {
  it('answers for the def a wrapped schema carries', () => {
    const wrapped = withOptions(z.string());
    expect(isOptionMarked(wrapped._def)).toBe(true);
    expect(isOptionMarked(z.string()._def)).toBe(false);
  });
});
