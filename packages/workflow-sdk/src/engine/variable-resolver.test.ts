import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import {
  VariableResolver,
  resolvePath,
  stripNullForOptionalKeys,
} from './variable-resolver.js';
import type { WorkflowContext } from '../types/context.js';

// ─── Test context factory ───

function makeCtx(
  overrides?: Partial<WorkflowContext>,
): WorkflowContext {
  return {
    workflow: { id: 'wf_1', metadata: { workspaceId: 'ws_1' } },
    execution: { id: 'exec_1' },
    trigger: {
      type: 'TEST',
      name: 'Alice',
      count: 42,
      nested: { deep: { value: 'found' } },
      tags: ['a', 'b'],
    },
    steps: {
      step1: {
        type: 'SEND_MSG',
        output: { messageId: 'msg_1', ok: true },
      },
    },
    ...overrides,
  };
}

// ─── resolvePath ───

describe('resolvePath', () => {
  const ctx = makeCtx();

  it('resolves trigger field', () => {
    expect(resolvePath(ctx, 'trigger.name')).toBe('Alice');
  });

  it('resolves trigger nested field', () => {
    expect(resolvePath(ctx, 'trigger.nested.deep.value')).toBe('found');
  });

  it('resolves workflow field', () => {
    expect(resolvePath(ctx, 'workflow.id')).toBe('wf_1');
  });

  it('resolves workflow.metadata', () => {
    expect(resolvePath(ctx, 'workflow.metadata.workspaceId')).toBe('ws_1');
  });

  it('resolves execution.id', () => {
    expect(resolvePath(ctx, 'execution.id')).toBe('exec_1');
  });

  it('resolves steps with explicit steps prefix', () => {
    expect(resolvePath(ctx, 'steps.step1.output.messageId')).toBe('msg_1');
  });

  it('resolves steps with shorthand (bare step id)', () => {
    expect(resolvePath(ctx, 'step1.output.messageId')).toBe('msg_1');
  });

  it('returns undefined for missing path', () => {
    expect(resolvePath(ctx, 'trigger.nonexistent')).toBeUndefined();
  });

  it('returns undefined for path through non-object', () => {
    expect(resolvePath(ctx, 'trigger.name.x')).toBeUndefined();
  });

  it('returns undefined for forbidden key __proto__', () => {
    expect(resolvePath(ctx, 'trigger.__proto__')).toBeUndefined();
  });

  it('returns undefined for forbidden key constructor', () => {
    expect(resolvePath(ctx, 'trigger.constructor')).toBeUndefined();
  });

  it('returns undefined for forbidden key prototype', () => {
    expect(resolvePath(ctx, 'trigger.prototype')).toBeUndefined();
  });

  it('returns undefined for empty path', () => {
    expect(resolvePath(ctx, '')).toBeUndefined();
  });

  it('resolves array values', () => {
    expect(resolvePath(ctx, 'trigger.tags')).toEqual(['a', 'b']);
  });

  it('resolves numeric values', () => {
    expect(resolvePath(ctx, 'trigger.count')).toBe(42);
  });

  it('resolves boolean values', () => {
    expect(resolvePath(ctx, 'step1.output.ok')).toBe(true);
  });
});

// ─── VariableResolver ───

describe('VariableResolver', () => {
  const resolver = new VariableResolver();
  const ctx = makeCtx();

  describe('resolve', () => {
    it('returns non-string primitives as-is', () => {
      expect(resolver.resolve(42, ctx)).toBe(42);
      expect(resolver.resolve(true, ctx)).toBe(true);
      expect(resolver.resolve(null, ctx)).toBeNull();
      expect(resolver.resolve(undefined, ctx)).toBeUndefined();
    });

    it('returns plain strings as-is', () => {
      expect(resolver.resolve('hello', ctx)).toBe('hello');
    });

    it('resolves pure ref preserving type', () => {
      expect(resolver.resolve('{{trigger.count}}', ctx)).toBe(42);
      expect(resolver.resolve('{{trigger.tags}}', ctx)).toEqual(['a', 'b']);
      expect(resolver.resolve('{{step1.output.ok}}', ctx)).toBe(true);
    });

    it('resolves pure ref with context. prefix', () => {
      expect(resolver.resolve('{{context.trigger.name}}', ctx)).toBe('Alice');
    });

    it('resolves template string (mixed literal + refs)', () => {
      expect(resolver.resolve('Hi {{trigger.name}}!', ctx)).toBe('Hi Alice!');
    });

    it('resolves multiple refs in template', () => {
      expect(
        resolver.resolve(
          '{{trigger.name}} sent {{trigger.count}} msgs',
          ctx,
        ),
      ).toBe('Alice sent 42 msgs');
    });

    it('stringifies objects in template', () => {
      const result = resolver.resolve('data: {{trigger.tags}}', ctx);
      expect(result).toBe('data: ["a","b"]');
    });

    it('stringifies null/undefined as empty in template', () => {
      expect(
        resolver.resolve('val: {{trigger.missing}}', ctx),
      ).toBe('val: ');
    });

    it('resolves nested objects recursively', () => {
      const config = {
        to: '{{trigger.name}}',
        body: 'hello',
        count: 5,
        nested: { ref: '{{trigger.count}}' },
      };
      const result = resolver.resolve(config, ctx);
      expect(result).toEqual({
        to: 'Alice',
        body: 'hello',
        count: 5,
        nested: { ref: 42 },
      });
    });

    it('resolves arrays recursively', () => {
      const arr = ['{{trigger.name}}', 'static', '{{trigger.count}}'];
      expect(resolver.resolve(arr, ctx)).toEqual(['Alice', 'static', 42]);
    });

    it('returns string as-is if no {{ found', () => {
      expect(resolver.resolve('no refs here', ctx)).toBe('no refs here');
    });
  });

  describe('resolveString', () => {
    it('returns non-ref string as-is', () => {
      expect(resolver.resolveString('plain', ctx)).toBe('plain');
    });

    it('resolves pure ref', () => {
      expect(resolver.resolveString('{{trigger.name}}', ctx)).toBe('Alice');
    });

    it('interpolates template', () => {
      expect(resolver.resolveString('Hi {{trigger.name}}!', ctx)).toBe(
        'Hi Alice!',
      );
    });
  });
});

// ─── stripNullForOptionalKeys ───

describe('stripNullForOptionalKeys', () => {
  it('removes null for optional fields that reject null', () => {
    const schema = z.object({
      required: z.string(),
      optional: z.string().optional(),
    });

    const result = stripNullForOptionalKeys(
      { required: 'hello', optional: null },
      schema,
    );
    expect(result).toEqual({ required: 'hello' });
    expect('optional' in result).toBe(false);
  });

  it('keeps null for nullable fields', () => {
    const schema = z.object({
      field: z.string().nullable(),
    });

    const result = stripNullForOptionalKeys({ field: null }, schema);
    expect(result).toEqual({ field: null });
  });

  it('keeps non-null values unchanged', () => {
    const schema = z.object({
      a: z.string().optional(),
      b: z.number(),
    });

    const input = { a: 'hello', b: 42 };
    expect(stripNullForOptionalKeys(input, schema)).toEqual(input);
  });

  it('returns input as-is for non-object schemas', () => {
    const input = { a: null };
    expect(stripNullForOptionalKeys(input, z.string())).toBe(input);
  });
});

/**
 * A condition is a reference plus a test, and the test is run one step later by
 * the evaluator. Flattening the reference here would leave it nothing to read.
 */
describe('VariableResolver — conditions', () => {
  const resolver = new VariableResolver();
  const context = makeCtx({
    steps: { account: { type: 'HTTP_REQUEST', output: { body: { plan: 'priority' } } } },
  });

  it('leaves a leaf condition exactly as written', () => {
    const when = { variable: '{{steps.account.output.body.plan}}', operator: 'eq', value: 'priority' };
    expect(resolver.resolve({ when }, context)).toEqual({ when });
  });

  it('leaves a group, however deep', () => {
    const when = {
      any: [
        { variable: '{{steps.account.output.body.plan}}', operator: 'eq', value: 'priority' },
        { all: [{ variable: '{{trigger.context.tier}}', operator: 'exists' }] },
      ],
    };
    expect(resolver.resolve({ form: { fields: [{ options: [{ label: 'x', value: 'y', when }] }] } }, context)).toEqual({
      form: { fields: [{ options: [{ label: 'x', value: 'y', when }] }] },
    });
  });

  it('still resolves everything around it', () => {
    expect(
      resolver.resolve(
        { url: 'https://x/{{steps.account.output.body.plan}}', when: { variable: '{{steps.account.output.body.plan}}', operator: 'exists' } },
        context,
      ),
    ).toEqual({
      url: 'https://x/priority',
      when: { variable: '{{steps.account.output.body.plan}}', operator: 'exists' },
    });
  });
});

describe('VariableResolver — what is not a condition', () => {
  const resolver = new VariableResolver();
  const context = makeCtx({ steps: { a: { type: 'HTTP_REQUEST', output: { body: { plan: 'priority' } } } } });
  const ref = '{{steps.a.output.body.plan}}';

  it('resolves an object that merely has an `any` array beside other fields', () => {
    expect(resolver.resolve({ any: ['x'], url: ref }, context)).toEqual({ any: ['x'], url: 'priority' });
  });

  it('resolves an object that has a `variable` beside fields of its own', () => {
    expect(resolver.resolve({ variable: ref, operator: 'eq', label: ref }, context)).toEqual({
      variable: 'priority',
      operator: 'eq',
      label: 'priority',
    });
  });

  it('resolves an `all` holding things that are not conditions', () => {
    expect(resolver.resolve({ all: [{ url: ref }] }, context)).toEqual({ all: [{ url: 'priority' }] });
  });
});
