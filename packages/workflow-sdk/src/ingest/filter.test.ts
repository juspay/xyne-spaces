import { describe, it, expect } from 'vitest';
import { matchesTriggerFilter } from './filter.js';
import { ConditionOperator } from '../types/operators.js';

describe('matchesTriggerFilter', () => {
  const event = { action: 'created', comment: { body: 'please /deploy' }, issue: { pull_request: { url: 'u' } } };

  it('lets every event through when there is no filter or no conditions', async () => {
    expect(await matchesTriggerFilter(undefined, event, undefined)).toBe(true);
    expect(await matchesTriggerFilter({}, event, undefined)).toBe(true);
  });

  it('keeps an event that satisfies every condition', async () => {
    expect(
      await matchesTriggerFilter(
        {
          conditions: {
            all: [
              { variable: '{{trigger.issue.pull_request}}', operator: ConditionOperator.EXISTS },
              { variable: '{{trigger.comment.body}}', operator: ConditionOperator.CONTAINS, value: '/deploy' },
            ],
          },
        },
        event,
        undefined,
      ),
    ).toBe(true);
  });

  it('drops an event that fails a condition', async () => {
    expect(
      await matchesTriggerFilter(
        { conditions: { variable: '{{trigger.action}}', operator: ConditionOperator.EQ, value: 'deleted' } },
        event,
        undefined,
      ),
    ).toBe(false);
  });

  it('resolves workflow variables, the only other context before a run', async () => {
    expect(
      await matchesTriggerFilter(
        { conditions: { variable: '{{vars.minLength}}', operator: ConditionOperator.EXISTS } },
        event,
        [{ key: 'minLength', type: 'number', value: 3 }] as never,
      ),
    ).toBe(true);
  });
});

describe('a filter that works something out', () => {
  it('admits an event by a computed value', async () => {
    // The schema accepts an expression here, the validator reads it, and this
    // is the third layer: the evaluator actually resolving one.
    const filter = {
      conditions: { variable: '{% $count(trigger.items) %}', operator: ConditionOperator.GT, value: 1 },
    };
    expect(
      await matchesTriggerFilter(filter, { items: [{ n: 1 }, { n: 2 }] }, undefined),
    ).toBe(true);
    expect(await matchesTriggerFilter(filter, { items: [{ n: 1 }] }, undefined)).toBe(false);
  });

  it('compares against a computed value on the right too', async () => {
    const filter = {
      conditions: {
        variable: '{{trigger.total}}',
        operator: ConditionOperator.EQ,
        value: '{% 20 * 3 %}',
      },
    };
    expect(await matchesTriggerFilter(filter, { total: 60 }, undefined)).toBe(true);
    expect(await matchesTriggerFilter(filter, { total: 61 }, undefined)).toBe(false);
  });
});
