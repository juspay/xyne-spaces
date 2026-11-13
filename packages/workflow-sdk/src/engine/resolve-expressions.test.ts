import { describe, it, expect } from 'vitest';
import {
  resolveExpressions,
  resolveReference,
  resolveValue,
  ExpressionError,
  conditionsIn,
} from './resolve-expressions.js';
import { VariableResolver } from './variable-resolver.js';
import type { WorkflowContext } from '../types/context.js';
import supportTree from '../conversational-flow/__fixtures__/support-tree.json' with { type: 'json' };

function ctx(): WorkflowContext {
  return {
    workflow: { id: 'wf1', attributes: {}, metadata: { name: 'Refunds' } },
    execution: { id: 'ex1' },
    trigger: { type: 'webhook', context: { orderId: 'A-9', tier: 'gold' } },
    steps: {
      invoice: {
        type: 'HTTP' as never,
        output: {
          body: {
            total: 225.5,
            items: [
              { tag: 'fee', amount: 100 },
              { tag: 'tax', amount: 20.5 },
              { tag: 'fee', amount: 105 },
            ],
          },
        },
      },
      credit: { type: 'HTTP' as never, output: { body: { amount: 50 } } },
    },
    vars: { threshold: 75, label: 'Refund' },
    __meta: { error: 'secret-ish', chain: ['wf1'] },
  } as unknown as WorkflowContext;
}

// ─── The driving requirement ───

describe('resolveExpressions', () => {
  it('sums three values a workflow produced', async () => {
    const { value } = await resolveExpressions(
      { amount: '{% $sum([steps.invoice.output.body.total, steps.credit.output.body.amount, vars.threshold]) %}' },
      ctx(),
    );
    expect(value).toEqual({ amount: 350.5 });
  });

  it('filters a list and sums the result', async () => {
    const { value } = await resolveExpressions(
      { amount: '{% $sum(steps.invoice.output.body.items[tag = "fee"].amount) %}' },
      ctx(),
    );
    expect(value).toEqual({ amount: 205 });
  });
});

// ─── Typing: the same rule a pure ref follows ───

describe('typing', () => {
  it('keeps the type when the expression is the whole value', async () => {
    const { value } = await resolveExpressions(
      {
        n: '{% $sum(steps.invoice.output.body.items.amount) %}',
        a: '{% steps.invoice.output.body.items[tag = "fee"].amount %}',
        o: '{% steps.credit.output.body %}',
        b: '{% $count(steps.invoice.output.body.items) > 2 %}',
      },
      ctx(),
    );
    expect(value).toEqual({ n: 225.5, a: [100, 105], o: { amount: 50 }, b: true });
  });

  it('produces values indistinguishable from the ones a ref produces', async () => {
    // JSONata tags the arrays it builds with an enumerable `sequence` property.
    // It survives in memory even though JSON.stringify drops it, so a computed
    // array must be scrubbed to match a selected one.
    const { value } = await resolveExpressions(
      {
        a: '{% steps.invoice.output.body.items[tag = "fee"].amount %}',
        nested: '{% {"xs": steps.invoice.output.body.items.amount} %}',
      },
      ctx(),
    );
    const { a, nested } = value as { a: number[]; nested: { xs: number[] } };
    expect(Object.keys(a)).toEqual(['0', '1']);
    expect(Object.keys(nested.xs)).toEqual(['0', '1', '2']);
  });

  it("hands back the context's own object untouched when it computed nothing", async () => {
    const context = ctx();
    const { value } = await resolveExpressions({ o: '{% steps.credit.output.body %}' }, context);
    expect((value as { o: unknown }).o).toBe(context.steps['credit']!.output['body']);
  });

  it('stringifies when mixed with text', async () => {
    const { value } = await resolveExpressions(
      { msg: 'Total: {% $sum(steps.invoice.output.body.items.amount) %} for {% $count(steps.invoice.output.body.items) %} items' },
      ctx(),
    );
    expect(value).toEqual({ msg: 'Total: 225.5 for 3 items' });
  });

  it('reads an absent path as nothing, rather than failing', async () => {
    const { value } = await resolveExpressions(
      { a: '{% steps.nope.output.missing %}', b: 'x{% steps.nope.output.missing %}y' },
      ctx(),
    );
    expect(value).toEqual({ a: undefined, b: 'xy' });
  });

  it('recurses through objects and arrays', async () => {
    const { value } = await resolveExpressions(
      { outer: { list: ['{% 1 + 1 %}', { deep: '{% 2 * 3 %}' }] }, kept: 7 },
      ctx(),
    );
    expect(value).toEqual({ outer: { list: [2, { deep: 6 }] }, kept: 7 });
  });
});

// ─── Leaving everything else exactly as it was ───

describe('configs without expressions', () => {
  it('returns the very same object, with nothing evaluated', async () => {
    const config = { url: 'https://x/y', body: { id: '{{trigger.context.orderId}}' } };
    const { value, evaluated } = await resolveExpressions(config, ctx());
    expect(value).toBe(config); // identity: not copied, not walked twice
    expect(evaluated).toEqual([]);
  });

  it('leaves the real conversational fixture untouched', async () => {
    const { value, evaluated } = await resolveExpressions(supportTree, ctx());
    expect(value).toBe(supportTree);
    expect(evaluated).toEqual([]);
  });

  it('leaves {{refs}} for the resolver that owns them', async () => {
    const { value } = await resolveExpressions(
      { a: '{{trigger.context.orderId}}', b: '{% vars.label %}' },
      ctx(),
    );
    expect(value).toEqual({ a: '{{trigger.context.orderId}}', b: 'Refund' });
    // …and the resolver then does its half, on the output of this one.
    expect(new VariableResolver().resolve(value, ctx())).toEqual({ a: 'A-9', b: 'Refund' });
  });
});

// ─── Conditions ───

describe('conditions', () => {
  const condition = { variable: '{{steps.invoice.output.body.total}}', operator: 'gt', value: 100 };

  // Skipped here, not unsupported: `ConditionEvaluator` resolves both slots of
  // a condition itself, because `variable` has to stay a reference until the
  // comparison. See condition-evaluator.test.ts for the expression cases.
  it('are left for the evaluator, which owns them', async () => {
    const config = { condition: { ...condition, value: '{% 1 + 1 %}' }, other: '{% 1 + 1 %}' };
    const { value } = await resolveExpressions(config, ctx());
    expect((value as typeof config).condition.value).toBe('{% 1 + 1 %}');
    expect((value as typeof config).other).toBe(2);
  });

  it('returns the config untouched when every expression sits in a condition', async () => {
    const config = { condition: { ...condition, value: '{% 1 + 1 %}' } };
    const { value, evaluated } = await resolveExpressions(config, ctx());
    expect(value).toBe(config);
    expect(evaluated).toEqual([]);
  });

  it('are found by conditionsIn, however deep', async () => {
    const leaf = { ...condition };
    const found = conditionsIn({ a: { b: [{ all: [leaf] }] } });
    expect(found.size).toBe(1);
  });
});

// ─── Failure ───

describe('failure', () => {
  it('names the field, the expression and the cause', async () => {
    const err = await resolveExpressions(
      { nested: { amount: '{% steps.invoice.output.body.total * "abc" %}' } },
      ctx(),
    ).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(ExpressionError);
    const e = err as ExpressionError;
    expect(e.location).toBe('nested.amount');
    expect(e.source).toBe('steps.invoice.output.body.total * "abc"');
    expect(e.code).toBe('T2002');
    expect(e.message).toContain('nested.amount');
    expect(e.message).toContain('* "abc"');
    // JSONata's own words, which were being lost: it throws a plain object, so
    // `String(cause)` gave "[object Object]".
    expect(e.message).toContain('must evaluate to a number');
  });

  it('stops a runaway expression even though nothing validated it', async () => {
    // The author-time ban means this cannot normally be saved. A config can
    // still arrive by API or from an older build, so the engine's own limit —
    // not the validator — is the actual guarantee.
    const err = await resolveExpressions(
      { x: '{% ($f := function($n){ $f($n + 1) }; $f(0)) %}' },
      ctx(),
    ).catch((e: unknown) => e);
    expect((err as ExpressionError).code).toBe('D1012');
  }, 10_000);
});

// ─── What an expression may see ───

describe('the expression context', () => {
  it('reads all five documented roots', async () => {
    const { value } = await resolveExpressions(
      {
        a: '{% trigger.context.tier %}',
        b: '{% workflow.metadata.name %}',
        c: '{% execution.id %}',
        d: '{% steps.credit.output.body.amount %}',
        e: '{% vars.label %}',
      },
      ctx(),
    );
    expect(value).toEqual({ a: 'gold', b: 'Refunds', c: 'ex1', d: 50, e: 'Refund' });
  });

  it('cannot see engine internals', async () => {
    const { value } = await resolveExpressions(
      { a: '{% __meta.error %}', b: '{% $string($$) %}' },
      ctx(),
    );
    expect((value as { a: unknown }).a).toBeUndefined();
    expect((value as { b: string }).b).not.toContain('__meta');
    expect((value as { b: string }).b).not.toContain('secret-ish');
  });

  it('cannot reach the host', async () => {
    const { value } = await resolveExpressions(
      {
        env: '{% process.env %}',
        global: '{% globalThis %}',
        req: '{% require %}',
        proto: '{% steps.__proto__ %}',
        ctor: '{% steps.constructor %}',
      },
      ctx(),
    );
    expect(Object.values(value as Record<string, unknown>).every((v) => v === undefined)).toBe(
      true,
    );
  });
});

// ─── The two single-slot primitives ───

describe('resolveReference', () => {
  it('reads a bare dotted path', async () => {
    expect(await resolveReference('steps.invoice.output.body.total', ctx())).toBe(225.5);
  });

  it('reads a {{ref}}', async () => {
    expect(await resolveReference('{{steps.invoice.output.body.total}}', ctx())).toBe(225.5);
    expect(await resolveReference('{{context.trigger.context.tier}}', ctx())).toBe('gold');
  });

  it('evaluates an expression', async () => {
    expect(await resolveReference('{% $sum(steps.invoice.output.body.items.amount) %}', ctx())).toBe(
      225.5,
    );
  });

  it('reads nothing for a path that is not there', async () => {
    expect(await resolveReference('steps.nope.output.x', ctx())).toBeUndefined();
  });
});

describe('resolveValue', () => {
  it('passes a literal through', async () => {
    expect(await resolveValue(42, ctx())).toBe(42);
    expect(await resolveValue('open', ctx())).toBe('open');
    expect(await resolveValue(null, ctx())).toBeNull();
  });

  it('resolves a ref, an expression, and text containing them', async () => {
    expect(await resolveValue('{{vars.threshold}}', ctx())).toBe(75);
    expect(await resolveValue('{% vars.threshold * 2 %}', ctx())).toBe(150);
    expect(await resolveValue('over {{vars.threshold}}, max {% $max([1, 9]) %}', ctx())).toBe(
      'over 75, max 9',
    );
  });

  it('recurses into a structure', async () => {
    expect(await resolveValue({ a: ['{% 1 + 1 %}', '{{vars.label}}'] }, ctx())).toEqual({
      a: [2, 'Refund'],
    });
  });
});

// ─── Evaluation bookkeeping ───

describe('evaluated', () => {
  it('reports each distinct expression once, whatever its field', async () => {
    const { evaluated } = await resolveExpressions(
      { a: '{% vars.threshold %}', b: '{% vars.threshold %}', c: '{% vars.label %}' },
      ctx(),
    );
    expect(evaluated).toEqual([
      { source: 'vars.threshold', value: 75 },
      { source: 'vars.label', value: 'Refund' },
    ]);
  });
});

describe('many expressions in one config', () => {
  const context = {
    trigger: {},
    steps: {},
    vars: {},
    workflow: {},
    execution: {},
  } as unknown as WorkflowContext;

  it('gives each one the whole budget, rather than making them share it', async () => {
    // Each is well inside `EXPRESSION_LIMITS.timeout` on its own. Run together
    // they interleave, the limit is wall-clock, and the step used to fail at
    // 1000ms blaming whichever expression happened to be first.
    const one = (n: number) =>
      `{% $sum($map([1..${String(900 + n)}], function($i){ $sum([1..900]) })) %}`;
    const config = Object.fromEntries(
      Array.from({ length: 8 }, (_, n) => [`f${String(n)}`, one(n)]),
    );

    const { value, evaluated } = await resolveExpressions(config, context);
    expect(evaluated).toHaveLength(8);
    for (const resolved of Object.values(value as Record<string, unknown>)) {
      expect(typeof resolved).toBe('number');
    }
  });

  it('evaluates one distinct expression once, however often it appears', async () => {
    const same = '{% 1 + 1 %}';
    const { value, evaluated } = await resolveExpressions({ a: same, b: same, c: same }, context);
    expect(evaluated).toHaveLength(1);
    expect(value).toEqual({ a: 2, b: 2, c: 2 });
  });
});
