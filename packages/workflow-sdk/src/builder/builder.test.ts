import { describe, it, expect } from 'vitest';
import {
  // Variable ref utilities
  VARIABLE_REF_REGEX,
  tokenize,
  isPureRef,
  extractRefPath,
  collectRefs,
  // Operators
  ConditionOperator,
  VALUE_LESS_OPERATORS,
  OPERATOR_DESCRIPTORS,
  // Condition evaluation
  ConditionEvaluator,
  // Config helpers
  readDottedPath,
  // Schema conversion
  zodToJsonSchemaRecord,
  // Variable resolution
  resolvePath,
  VariableResolver,
} from './index.js';
import type {
  VariableRefToken,
  FoundRef,
  OperatorDescriptor,
  LeafCondition,
  Condition,
  WorkflowContext,
} from './index.js';

// ─── Variable Reference Utilities ───

describe('variable-ref utilities', () => {
  describe('isPureRef', () => {
    it('returns true for a pure ref', () => {
      expect(isPureRef('{{trigger.x}}')).toBe(true);
    });

    it('returns true for context-prefixed ref', () => {
      expect(isPureRef('{{context.trigger.x}}')).toBe(true);
    });

    it('returns false for template string', () => {
      expect(isPureRef('Hello {{trigger.name}}!')).toBe(false);
    });

    it('returns false for plain text', () => {
      expect(isPureRef('hello')).toBe(false);
    });
  });

  describe('extractRefPath', () => {
    it('extracts dotted path from pure ref', () => {
      expect(extractRefPath('{{trigger.ticket.id}}')).toBe('trigger.ticket.id');
    });

    it('strips context. prefix', () => {
      expect(extractRefPath('{{context.trigger.x}}')).toBe('trigger.x');
    });

    it('returns null for non-ref', () => {
      expect(extractRefPath('hello')).toBeNull();
    });
  });

  describe('tokenize', () => {
    it('tokenizes pure literal', () => {
      const tokens: VariableRefToken[] = tokenize('hello');
      expect(tokens).toEqual([{ kind: 'literal', text: 'hello' }]);
    });

    it('tokenizes pure ref', () => {
      const tokens = tokenize('{{trigger.x}}');
      expect(tokens).toEqual([
        { kind: 'ref', path: 'trigger.x', raw: '{{trigger.x}}' },
      ]);
    });

    it('tokenizes mixed template', () => {
      const tokens = tokenize('Hi {{trigger.name}}!');
      expect(tokens).toHaveLength(3);
      expect(tokens[0]).toEqual({ kind: 'literal', text: 'Hi ' });
      expect(tokens[1]).toEqual({
        kind: 'ref',
        path: 'trigger.name',
        raw: '{{trigger.name}}',
      });
      expect(tokens[2]).toEqual({ kind: 'literal', text: '!' });
    });
  });

  describe('collectRefs', () => {
    it('collects refs from nested objects', () => {
      const config = {
        url: '{{trigger.url}}',
        headers: { auth: '{{steps.auth.output.token}}' },
        items: ['{{trigger.list}}'],
      };
      const refs: FoundRef[] = collectRefs(config, '');
      expect(refs).toHaveLength(3);
      expect(refs.map((r) => r.refPath)).toContain('trigger.url');
      expect(refs.map((r) => r.refPath)).toContain('steps.auth.output.token');
      expect(refs.map((r) => r.refPath)).toContain('trigger.list');
    });
  });

  describe('VARIABLE_REF_REGEX', () => {
    it('is a regex', () => {
      expect(VARIABLE_REF_REGEX).toBeInstanceOf(RegExp);
    });
  });
});

// ─── Operators ───

describe('operators', () => {
  it('exposes all enum values', () => {
    expect(ConditionOperator.EQ).toBe('eq');
    expect(ConditionOperator.EXISTS).toBe('exists');
  });

  it('marks EXISTS as value-less', () => {
    expect(VALUE_LESS_OPERATORS.has(ConditionOperator.EXISTS)).toBe(true);
    expect(VALUE_LESS_OPERATORS.has(ConditionOperator.EQ)).toBe(false);
  });

  it('provides descriptors for all operators', () => {
    const descriptors: readonly OperatorDescriptor[] = OPERATOR_DESCRIPTORS;
    expect(descriptors.length).toBeGreaterThan(0);
    for (const d of descriptors) {
      expect(d.value).toBeDefined();
      expect(d.label).toBeTruthy();
      expect(['string', 'number', 'boolean', 'none']).toContain(d.valueType);
    }
  });
});

// ─── Condition Evaluation ───

describe('ConditionEvaluator', () => {
  const evaluator = new ConditionEvaluator();
  const context: WorkflowContext = {
    workflow: { id: 'w1' },
    trigger: { status: 'open', count: 5 },
    steps: {},
  };

  it('evaluates a leaf EQ condition', async () => {
    const leaf: LeafCondition = {
      variable: '{{trigger.status}}',
      operator: ConditionOperator.EQ,
      value: 'open',
    };
    expect(await evaluator.evaluate(leaf, context)).toBe(true);
  });

  it('evaluates an all group', async () => {
    const condition: Condition = {
      all: [
        { variable: '{{trigger.status}}', operator: ConditionOperator.EQ, value: 'open' },
        { variable: '{{trigger.count}}', operator: ConditionOperator.GT, value: 3 },
      ],
    };
    expect(await evaluator.evaluate(condition, context)).toBe(true);
  });

  it('evaluates an any group', async () => {
    const condition: Condition = {
      any: [
        { variable: '{{trigger.status}}', operator: ConditionOperator.EQ, value: 'closed' },
        { variable: '{{trigger.count}}', operator: ConditionOperator.EXISTS },
      ],
    };
    expect(await evaluator.evaluate(condition, context)).toBe(true);
  });

  it('evaluates EXISTS', async () => {
    const leaf: LeafCondition = {
      variable: '{{trigger.missing}}',
      operator: ConditionOperator.EXISTS,
    };
    expect(await evaluator.evaluate(leaf, context)).toBe(false);
  });
});

// ─── Variable Resolution ───

describe('resolvePath', () => {
  const context: WorkflowContext = {
    workflow: { id: 'w1' },
    trigger: { user: { name: 'Alice' } },
    steps: {
      fetch: { output: { data: [1, 2, 3] } },
    },
  };

  it('resolves trigger paths', () => {
    expect(resolvePath(context, 'trigger.user.name')).toBe('Alice');
  });

  it('resolves step output paths', () => {
    expect(resolvePath(context, 'steps.fetch.output.data')).toEqual([1, 2, 3]);
  });

  it('returns undefined for missing paths', () => {
    expect(resolvePath(context, 'trigger.missing.deep')).toBeUndefined();
  });
});

describe('VariableResolver', () => {
  const resolver = new VariableResolver();
  const context: WorkflowContext = {
    workflow: { id: 'w1' },
    trigger: { name: 'World', count: 42 },
    steps: {},
  };

  it('resolves pure ref preserving type', () => {
    expect(resolver.resolve('{{trigger.count}}', context)).toBe(42);
  });

  it('resolves template string', () => {
    expect(resolver.resolve('Hello {{trigger.name}}!', context)).toBe(
      'Hello World!',
    );
  });

  it('resolves nested objects', () => {
    const config = { url: '{{trigger.name}}', count: '{{trigger.count}}' };
    const resolved = resolver.resolve(config, context);
    expect(resolved).toEqual({ url: 'World', count: 42 });
  });

  it('passes through non-string primitives', () => {
    expect(resolver.resolve(123, context)).toBe(123);
    expect(resolver.resolve(true, context)).toBe(true);
    expect(resolver.resolve(null, context)).toBeNull();
  });
});

// ─── Config Helpers ───

describe('readDottedPath', () => {
  it('reads nested values', () => {
    const obj = { a: { b: { c: 42 } } };
    expect(readDottedPath(obj, 'a.b.c')).toBe(42);
  });

  it('returns undefined for missing paths', () => {
    expect(readDottedPath({ a: 1 }, 'b.c')).toBeUndefined();
  });
});

// ─── Schema Conversion ───

describe('zodToJsonSchemaRecord', () => {
  it('converts a Zod schema to JSON Schema', async () => {
    const { z } = await import('zod');
    const schema = z.object({
      name: z.string(),
      age: z.number().optional(),
    });
    const jsonSchema = zodToJsonSchemaRecord(schema);
    expect(jsonSchema).toHaveProperty('type', 'object');
    expect(jsonSchema).toHaveProperty('properties');
  });
});
