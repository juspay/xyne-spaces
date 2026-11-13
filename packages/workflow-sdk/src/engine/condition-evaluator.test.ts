import { describe, it, expect } from 'vitest';
import { ConditionEvaluator } from './condition-evaluator.js';
import { ConditionOperator } from '../types/operators.js';
import type { Condition } from '../types/workflow-config.js';
import type { WorkflowContext } from '../types/context.js';

function makeCtx(
  overrides?: Partial<WorkflowContext>,
): WorkflowContext {
  return {
    workflow: { id: 'wf_1', metadata: {} },
    trigger: {
      type: 'TEST',
      status: 'open',
      priority: 3,
      name: 'Alice',
      tags: ['urgent', 'billing'],
      empty: null,
    },
    steps: {
      step1: {
        type: 'ACTION',
        output: { count: 10, label: 'done' },
      },
    },
    ...overrides,
  };
}

describe('ConditionEvaluator', () => {
  const evaluator = new ConditionEvaluator();
  const ctx = makeCtx();

  // ─── EQ ───

  describe('EQ operator', () => {
    it('matches equal string', async () => {
      expect(
        await evaluator.evaluate(
          {
            variable: '{{trigger.status}}',
            operator: ConditionOperator.EQ,
            value: 'open',
          },
          ctx,
        ),
      ).toBe(true);
    });

    it('rejects unequal string', async () => {
      expect(
        await evaluator.evaluate(
          {
            variable: '{{trigger.status}}',
            operator: ConditionOperator.EQ,
            value: 'closed',
          },
          ctx,
        ),
      ).toBe(false);
    });

    it('loose-equals number and string', async () => {
      expect(
        await evaluator.evaluate(
          {
            variable: '{{trigger.priority}}',
            operator: ConditionOperator.EQ,
            value: '3',
          },
          ctx,
        ),
      ).toBe(true);
    });

    it('matches equal number', async () => {
      expect(
        await evaluator.evaluate(
          {
            variable: '{{trigger.priority}}',
            operator: ConditionOperator.EQ,
            value: 3,
          },
          ctx,
        ),
      ).toBe(true);
    });
  });

  // ─── NEQ ───

  describe('NEQ operator', () => {
    it('returns true for unequal', async () => {
      expect(
        await evaluator.evaluate(
          {
            variable: '{{trigger.status}}',
            operator: ConditionOperator.NEQ,
            value: 'closed',
          },
          ctx,
        ),
      ).toBe(true);
    });

    it('returns false for equal', async () => {
      expect(
        await evaluator.evaluate(
          {
            variable: '{{trigger.status}}',
            operator: ConditionOperator.NEQ,
            value: 'open',
          },
          ctx,
        ),
      ).toBe(false);
    });
  });

  // ─── CONTAINS ───

  describe('CONTAINS operator', () => {
    it('matches substring in string', async () => {
      expect(
        await evaluator.evaluate(
          {
            variable: '{{trigger.name}}',
            operator: ConditionOperator.CONTAINS,
            value: 'lic',
          },
          ctx,
        ),
      ).toBe(true);
    });

    it('rejects missing substring', async () => {
      expect(
        await evaluator.evaluate(
          {
            variable: '{{trigger.name}}',
            operator: ConditionOperator.CONTAINS,
            value: 'Bob',
          },
          ctx,
        ),
      ).toBe(false);
    });

    it('matches element in array', async () => {
      expect(
        await evaluator.evaluate(
          {
            variable: '{{trigger.tags}}',
            operator: ConditionOperator.CONTAINS,
            value: 'urgent',
          },
          ctx,
        ),
      ).toBe(true);
    });

    it('rejects missing element in array', async () => {
      expect(
        await evaluator.evaluate(
          {
            variable: '{{trigger.tags}}',
            operator: ConditionOperator.CONTAINS,
            value: 'low',
          },
          ctx,
        ),
      ).toBe(false);
    });

    it('returns false for non-string, non-array', async () => {
      expect(
        await evaluator.evaluate(
          {
            variable: '{{trigger.priority}}',
            operator: ConditionOperator.CONTAINS,
            value: '3',
          },
          ctx,
        ),
      ).toBe(false);
    });
  });

  // ─── GT / GTE / LT / LTE ───

  describe('comparison operators', () => {
    it('GT: 3 > 2', async () => {
      expect(
        await evaluator.evaluate(
          {
            variable: '{{trigger.priority}}',
            operator: ConditionOperator.GT,
            value: 2,
          },
          ctx,
        ),
      ).toBe(true);
    });

    it('GT: 3 > 3 is false', async () => {
      expect(
        await evaluator.evaluate(
          {
            variable: '{{trigger.priority}}',
            operator: ConditionOperator.GT,
            value: 3,
          },
          ctx,
        ),
      ).toBe(false);
    });

    it('GTE: 3 >= 3', async () => {
      expect(
        await evaluator.evaluate(
          {
            variable: '{{trigger.priority}}',
            operator: ConditionOperator.GTE,
            value: 3,
          },
          ctx,
        ),
      ).toBe(true);
    });

    it('LT: 3 < 5', async () => {
      expect(
        await evaluator.evaluate(
          {
            variable: '{{trigger.priority}}',
            operator: ConditionOperator.LT,
            value: 5,
          },
          ctx,
        ),
      ).toBe(true);
    });

    it('LT: 3 < 3 is false', async () => {
      expect(
        await evaluator.evaluate(
          {
            variable: '{{trigger.priority}}',
            operator: ConditionOperator.LT,
            value: 3,
          },
          ctx,
        ),
      ).toBe(false);
    });

    it('LTE: 3 <= 3', async () => {
      expect(
        await evaluator.evaluate(
          {
            variable: '{{trigger.priority}}',
            operator: ConditionOperator.LTE,
            value: 3,
          },
          ctx,
        ),
      ).toBe(true);
    });

    it('returns false when variable is undefined', async () => {
      expect(
        await evaluator.evaluate(
          {
            variable: '{{trigger.missing}}',
            operator: ConditionOperator.GT,
            value: 0,
          },
          ctx,
        ),
      ).toBe(false);
    });

    it('returns false when variable is null', async () => {
      expect(
        await evaluator.evaluate(
          {
            variable: '{{trigger.empty}}',
            operator: ConditionOperator.GT,
            value: 0,
          },
          ctx,
        ),
      ).toBe(false);
    });
  });

  // ─── EXISTS ───

  describe('EXISTS operator', () => {
    it('returns true for existing field', async () => {
      expect(
        await evaluator.evaluate(
          {
            variable: '{{trigger.name}}',
            operator: ConditionOperator.EXISTS,
          },
          ctx,
        ),
      ).toBe(true);
    });

    it('returns false for missing field', async () => {
      expect(
        await evaluator.evaluate(
          {
            variable: '{{trigger.missing}}',
            operator: ConditionOperator.EXISTS,
          },
          ctx,
        ),
      ).toBe(false);
    });

    it('returns false for null field', async () => {
      expect(
        await evaluator.evaluate(
          {
            variable: '{{trigger.empty}}',
            operator: ConditionOperator.EXISTS,
          },
          ctx,
        ),
      ).toBe(false);
    });
  });

  // ─── Step outputs ───

  describe('step output references', () => {
    it('resolves step output via shorthand', async () => {
      expect(
        await evaluator.evaluate(
          {
            variable: '{{step1.output.count}}',
            operator: ConditionOperator.EQ,
            value: 10,
          },
          ctx,
        ),
      ).toBe(true);
    });
  });

  // ─── ALL / ANY ───

  describe('all (AND)', () => {
    it('returns true when all conditions pass', async () => {
      const condition: Condition = {
        all: [
          {
            variable: '{{trigger.status}}',
            operator: ConditionOperator.EQ,
            value: 'open',
          },
          {
            variable: '{{trigger.priority}}',
            operator: ConditionOperator.GT,
            value: 1,
          },
        ],
      };
      expect(await evaluator.evaluate(condition, ctx)).toBe(true);
    });

    it('returns false when one condition fails', async () => {
      const condition: Condition = {
        all: [
          {
            variable: '{{trigger.status}}',
            operator: ConditionOperator.EQ,
            value: 'open',
          },
          {
            variable: '{{trigger.priority}}',
            operator: ConditionOperator.GT,
            value: 100,
          },
        ],
      };
      expect(await evaluator.evaluate(condition, ctx)).toBe(false);
    });

    it('returns true for empty all', async () => {
      expect(await evaluator.evaluate({ all: [] }, ctx)).toBe(true);
    });
  });

  describe('any (OR)', () => {
    it('returns true when one condition passes', async () => {
      const condition: Condition = {
        any: [
          {
            variable: '{{trigger.status}}',
            operator: ConditionOperator.EQ,
            value: 'closed',
          },
          {
            variable: '{{trigger.name}}',
            operator: ConditionOperator.EQ,
            value: 'Alice',
          },
        ],
      };
      expect(await evaluator.evaluate(condition, ctx)).toBe(true);
    });

    it('returns false when no condition passes', async () => {
      const condition: Condition = {
        any: [
          {
            variable: '{{trigger.status}}',
            operator: ConditionOperator.EQ,
            value: 'closed',
          },
          {
            variable: '{{trigger.name}}',
            operator: ConditionOperator.EQ,
            value: 'Bob',
          },
        ],
      };
      expect(await evaluator.evaluate(condition, ctx)).toBe(false);
    });

    it('returns false for empty any', async () => {
      expect(await evaluator.evaluate({ any: [] }, ctx)).toBe(false);
    });
  });

  // ─── Nested all/any ───

  describe('nested conditions', () => {
    it('evaluates nested all inside any', async () => {
      const condition: Condition = {
        any: [
          {
            all: [
              {
                variable: '{{trigger.status}}',
                operator: ConditionOperator.EQ,
                value: 'open',
              },
              {
                variable: '{{trigger.priority}}',
                operator: ConditionOperator.GTE,
                value: 3,
              },
            ],
          },
          {
            variable: '{{trigger.name}}',
            operator: ConditionOperator.EQ,
            value: 'Bob',
          },
        ],
      };
      expect(await evaluator.evaluate(condition, ctx)).toBe(true);
    });
  });

  // ─── Operators the tree cannot otherwise express ───

  describe('negation and the ends of a string', () => {
    const leaf = (
      variable: string,
      operator: ConditionOperator,
      value?: unknown,
    ): Condition => ({ variable, operator, ...(value !== undefined ? { value } : {}) }) as Condition;

    it('not_contains is the inverse of contains, for text and for lists', async () => {
      expect(await evaluator.evaluate(leaf('{{trigger.name}}', ConditionOperator.NOT_CONTAINS, 'lic'), ctx)).toBe(false);
      expect(await evaluator.evaluate(leaf('{{trigger.name}}', ConditionOperator.NOT_CONTAINS, 'Bob'), ctx)).toBe(true);
      expect(await evaluator.evaluate(leaf('{{trigger.tags}}', ConditionOperator.NOT_CONTAINS, 'urgent'), ctx)).toBe(false);
      expect(await evaluator.evaluate(leaf('{{trigger.tags}}', ConditionOperator.NOT_CONTAINS, 'spam'), ctx)).toBe(true);
    });

    it('a field that is not there does not contain anything', async () => {
      // "the title does not contain WIP" is true of a ticket with no title.
      expect(await evaluator.evaluate(leaf('{{trigger.missing}}', ConditionOperator.NOT_CONTAINS, 'WIP'), ctx)).toBe(true);
    });

    it('starts_with and ends_with read text only', async () => {
      expect(await evaluator.evaluate(leaf('{{trigger.name}}', ConditionOperator.STARTS_WITH, 'Al'), ctx)).toBe(true);
      expect(await evaluator.evaluate(leaf('{{trigger.name}}', ConditionOperator.STARTS_WITH, 'ice'), ctx)).toBe(false);
      expect(await evaluator.evaluate(leaf('{{trigger.name}}', ConditionOperator.ENDS_WITH, 'ice'), ctx)).toBe(true);
      // A number has no ends.
      expect(await evaluator.evaluate(leaf('{{trigger.priority}}', ConditionOperator.STARTS_WITH, '3'), ctx)).toBe(false);
    });
  });

  describe('absent versus empty', () => {
    const emptyCtx = makeCtx({
      trigger: {
        type: 'TEST',
        assignee: '',
        blank: '   ',
        tags: [],
        meta: {},
        name: 'Alice',
        nulled: null,
      },
    });

    it('not_exists is the exact inverse of exists', async () => {
      const missing = { variable: '{{trigger.nope}}', operator: ConditionOperator.NOT_EXISTS } as Condition;
      const present = { variable: '{{trigger.name}}', operator: ConditionOperator.NOT_EXISTS } as Condition;
      expect(await evaluator.evaluate(missing, emptyCtx)).toBe(true);
      expect(await evaluator.evaluate(present, emptyCtx)).toBe(false);
    });

    it('is_empty covers absent, blank, and nothing-in-there', async () => {
      const isEmpty = (path: string): Condition =>
        ({ variable: `{{trigger.${path}}}`, operator: ConditionOperator.IS_EMPTY }) as Condition;

      // The rule this exists for: "escalate if nobody is assigned".
      expect(await evaluator.evaluate(isEmpty('assignee'), emptyCtx)).toBe(true);
      expect(await evaluator.evaluate(isEmpty('blank'), emptyCtx)).toBe(true);
      expect(await evaluator.evaluate(isEmpty('tags'), emptyCtx)).toBe(true);
      expect(await evaluator.evaluate(isEmpty('meta'), emptyCtx)).toBe(true);
      expect(await evaluator.evaluate(isEmpty('nulled'), emptyCtx)).toBe(true);
      expect(await evaluator.evaluate(isEmpty('nope'), emptyCtx)).toBe(true);
      expect(await evaluator.evaluate(isEmpty('name'), emptyCtx)).toBe(false);
    });
  });

  // ─── Expressions ───

  describe('expressions', () => {
    const leaf = (over: Record<string, unknown>): Condition =>
      ({ variable: '{{trigger.status}}', operator: ConditionOperator.EQ, ...over }) as Condition;

    it('compares a computed value', async () => {
      // The case conditions could not express before: a total that has to be
      // worked out before it can be tested.
      expect(
        await evaluator.evaluate(
          leaf({
            variable: '{% $sum([steps.step1.output.count, trigger.priority]) %}',
            operator: ConditionOperator.EQ,
            value: 13,
          }),
          ctx,
        ),
      ).toBe(true);
    });

    it('computes over a list', async () => {
      expect(
        await evaluator.evaluate(
          leaf({
            variable: '{% $count(trigger.tags) %}',
            operator: ConditionOperator.GT,
            value: 1,
          }),
          ctx,
        ),
      ).toBe(true);
    });

    it('accepts an expression on the value side', async () => {
      expect(
        await evaluator.evaluate(
          leaf({
            variable: '{{step1.output.count}}',
            operator: ConditionOperator.EQ,
            value: '{% 5 + 5 %}',
          }),
          ctx,
        ),
      ).toBe(true);
    });

    it('resolves a reference on the value side', async () => {
      // New: `value` used to be compared as a literal, so a reference there
      // could only ever fail. Both halves now read the same three things.
      expect(
        await evaluator.evaluate(
          leaf({
            variable: '{{trigger.priority}}',
            operator: ConditionOperator.EQ,
            value: '{{trigger.priority}}',
          }),
          ctx,
        ),
      ).toBe(true);
    });

    it('leaves a plain literal alone', async () => {
      expect(
        await evaluator.evaluate(leaf({ value: 'open' }), ctx),
      ).toBe(true);
      expect(
        await evaluator.evaluate(leaf({ value: 'closed' }), ctx),
      ).toBe(false);
    });

    it('still short-circuits an all group', async () => {
      // The second leaf would reject if it ran; `all` must not reach it.
      expect(
        await evaluator.evaluate(
          {
            all: [
              leaf({ value: 'closed' }),
              leaf({ variable: '{% $sum( %}', operator: ConditionOperator.EQ, value: 1 }),
            ],
          } as Condition,
          ctx,
        ),
      ).toBe(false);
    });

    it('reports a failing expression rather than answering false', async () => {
      await expect(
        evaluator.evaluate(
          leaf({
            variable: '{% trigger.status * 2 %}',
            operator: ConditionOperator.EQ,
            value: 1,
          }),
          ctx,
        ),
      ).rejects.toThrow(/trigger.status \* 2/);
    });
  });

  // ─── Error ───

  describe('error handling', () => {
    it('rejects for unrecognised condition shape', async () => {
      // Rejects rather than throws synchronously, now that evaluation awaits.
      await expect(
        evaluator.evaluate({ bad: true } as unknown as Condition, ctx),
      ).rejects.toThrow('Unrecognised condition shape');
    });
  });
});
