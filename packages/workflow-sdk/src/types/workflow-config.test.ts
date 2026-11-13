import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import {
  variableRef,
  getVariableRefInnerSchema,
  LeafConditionSchema,
  ConditionSchema,
  WorkflowSettingsSchema,
  readDottedPath,
} from './workflow-config.js';
import { zodToJsonSchemaRecord } from '../util/schema-convert.js';
import { ConditionOperator } from './operators.js';

// ─── variableRef ───

describe('variableRef', () => {
  const schema = variableRef(z.string());

  it('accepts a literal string', () => {
    expect(schema.parse('hello')).toBe('hello');
  });

  it('accepts a variable reference', () => {
    expect(schema.parse('{{trigger.name}}')).toBe('{{trigger.name}}');
  });

  it('accepts a ref with context prefix', () => {
    expect(schema.parse('{{context.trigger.name}}')).toBe(
      '{{context.trigger.name}}',
    );
  });

  it('rejects non-string types when inner is z.string()', () => {
    expect(() => schema.parse(42)).toThrow();
  });

  it('marks the field rather than writing over its description', () => {
    const json = zodToJsonSchemaRecord(
      z.object({ owner: variableRef(z.string().describe('Which account owns it')) }),
    );
    const owner = (json['properties'] as Record<string, Record<string, unknown>>)['owner']!;

    expect(owner['isVariableRef']).toBe(true);
    // The author's own words used to be overwritten by the sentinel; the inner
    // schema keeps them, which is where the editor reads them from.
    const variants = owner['anyOf'] as Record<string, unknown>[];
    expect(variants[0]?.['description']).toBe('Which account owns it');
  });

  it('leaves a plain union unmarked', () => {
    const json = zodToJsonSchemaRecord(z.object({ u: z.union([z.string(), z.number()]) }));
    const u = (json['properties'] as Record<string, Record<string, unknown>>)['u']!;
    expect(u['isVariableRef']).toBeUndefined();
  });

  it('works with z.number() inner schema', () => {
    const numRef = variableRef(z.number());
    expect(numRef.parse(42)).toBe(42);
    expect(numRef.parse('{{trigger.count}}')).toBe('{{trigger.count}}');
  });

  it('works with z.boolean() inner schema', () => {
    const boolRef = variableRef(z.boolean());
    expect(boolRef.parse(true)).toBe(true);
    expect(boolRef.parse('{{trigger.flag}}')).toBe('{{trigger.flag}}');
  });
});

// ─── getVariableRefInnerSchema ───

describe('getVariableRefInnerSchema', () => {
  it('extracts inner schema from a variableRef union', () => {
    const inner = z.string();
    const ref = variableRef(inner);
    const extracted = getVariableRefInnerSchema(ref);
    expect(extracted).toBe(inner);
  });

  it('returns null for a plain schema', () => {
    expect(getVariableRefInnerSchema(z.string())).toBeNull();
  });

  it('returns null for a non-variableRef union', () => {
    const union = z.union([z.string(), z.number()]);
    expect(getVariableRefInnerSchema(union)).toBeNull();
  });
});

// ─── LeafConditionSchema ───

describe('LeafConditionSchema', () => {
  it('parses valid leaf condition', () => {
    const result = LeafConditionSchema.parse({
      variable: '{{trigger.status}}',
      operator: ConditionOperator.EQ,
      value: 'open',
    });
    expect(result.variable).toBe('{{trigger.status}}');
    expect(result.operator).toBe('eq');
    expect(result.value).toBe('open');
  });

  it('parses without value (for EXISTS operator)', () => {
    const result = LeafConditionSchema.parse({
      variable: '{{trigger.field}}',
      operator: ConditionOperator.EXISTS,
    });
    expect(result.value).toBeUndefined();
  });

  it('rejects invalid variable (not a ref)', () => {
    expect(() =>
      LeafConditionSchema.parse({
        variable: 'not-a-ref',
        operator: ConditionOperator.EQ,
        value: 1,
      }),
    ).toThrow();
  });

  it('rejects invalid operator', () => {
    expect(() =>
      LeafConditionSchema.parse({
        variable: '{{trigger.x}}',
        operator: 'INVALID',
        value: 1,
      }),
    ).toThrow();
  });
});

// ─── ConditionSchema (recursive) ───

describe('ConditionSchema', () => {
  it('parses leaf condition', () => {
    const result = ConditionSchema.parse({
      variable: '{{trigger.x}}',
      operator: ConditionOperator.EQ,
      value: 1,
    });
    expect(result).toHaveProperty('variable', '{{trigger.x}}');
  });

  it('parses "all" group', () => {
    const result = ConditionSchema.parse({
      all: [
        {
          variable: '{{trigger.a}}',
          operator: ConditionOperator.EQ,
          value: 1,
        },
        {
          variable: '{{trigger.b}}',
          operator: ConditionOperator.GT,
          value: 5,
        },
      ],
    });
    expect(result).toHaveProperty('all');
  });

  it('parses "any" group', () => {
    const result = ConditionSchema.parse({
      any: [
        {
          variable: '{{trigger.x}}',
          operator: ConditionOperator.CONTAINS,
          value: 'test',
        },
      ],
    });
    expect(result).toHaveProperty('any');
  });

  it('parses nested all/any', () => {
    const result = ConditionSchema.parse({
      all: [
        {
          any: [
            {
              variable: '{{trigger.x}}',
              operator: ConditionOperator.EQ,
              value: 1,
            },
            {
              variable: '{{trigger.y}}',
              operator: ConditionOperator.EQ,
              value: 2,
            },
          ],
        },
        {
          variable: '{{trigger.z}}',
          operator: ConditionOperator.EXISTS,
        },
      ],
    });
    expect(result).toHaveProperty('all');
  });
});

// ─── WorkflowSettingsSchema ───

describe('WorkflowSettingsSchema', () => {
  it('applies default onError', () => {
    const result = WorkflowSettingsSchema.parse({});
    expect(result.onError).toBe('stop');
  });

  it('accepts valid complete settings', () => {
    const result = WorkflowSettingsSchema.parse({
      onError: 'continue',
      retry: { maxAttempts: 3, intervalMs: 2000 },
    });
    expect(result.onError).toBe('continue');
    expect(result.retry?.maxAttempts).toBe(3);
  });

  it('rejects invalid onError value', () => {
    expect(() =>
      WorkflowSettingsSchema.parse({ onError: 'explode' }),
    ).toThrow();
  });

  it('rejects retry maxAttempts > 10', () => {
    expect(() =>
      WorkflowSettingsSchema.parse({
        retry: { maxAttempts: 11, intervalMs: 1000 },
      }),
    ).toThrow();
  });

  it('rejects retry intervalMs < 1000', () => {
    expect(() =>
      WorkflowSettingsSchema.parse({
        retry: { maxAttempts: 1, intervalMs: 500 },
      }),
    ).toThrow();
  });

  it('strips unknown keys (e.g. timeoutMs)', () => {
    const result = WorkflowSettingsSchema.parse({ timeoutMs: 30000 });
    expect(result.onError).toBe('stop');
    expect('timeoutMs' in result).toBe(false);
  });
});

// ─── readDottedPath ───

describe('readDottedPath', () => {
  it('reads a top-level field', () => {
    expect(readDottedPath({ a: 1 }, 'a')).toBe(1);
  });

  it('reads a nested field', () => {
    expect(readDottedPath({ a: { b: { c: 42 } } }, 'a.b.c')).toBe(42);
  });

  it('returns undefined for missing path', () => {
    expect(readDottedPath({ a: 1 }, 'b')).toBeUndefined();
  });

  it('returns undefined for path through non-object', () => {
    expect(readDottedPath({ a: 'string' }, 'a.b')).toBeUndefined();
  });

  it('returns undefined for path through null', () => {
    expect(
      readDottedPath({ a: null } as unknown as Record<string, unknown>, 'a.b'),
    ).toBeUndefined();
  });

  it('reads array elements by index', () => {
    expect(readDottedPath({ items: [10, 20, 30] }, 'items.1')).toBe(20);
  });

  it('returns the object itself for an empty path segment chain', () => {
    const obj = { a: 1 };
    // Single empty string part — obj[''] is undefined
    expect(readDottedPath(obj, '')).toBeUndefined();
  });

  it('handles zero and false values', () => {
    expect(readDottedPath({ a: 0 }, 'a')).toBe(0);
    expect(readDottedPath({ a: false }, 'a')).toBe(false);
  });
});
