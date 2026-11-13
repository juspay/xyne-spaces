import { describe, it, expect } from 'vitest';
import type { ValidationResult } from '@xyne/workflow-sdk';
import { groupIssues, fieldErrors } from './issue-mapping.js';

const result: ValidationResult = {
  valid: false,
  issues: [
    { path: 'trigger.config.channel', code: 'shape' as never, message: 'channel required', location: { scope: 'trigger', field: 'channel' } },
    { path: 'steps[0].config.to', code: 'shape' as never, message: 'to required', location: { scope: 'step', stepId: 'a', field: 'to' } },
    { path: 'steps[0].config.body', code: 'shape' as never, message: 'body required', location: { scope: 'step', stepId: 'a', field: 'body' } },
    { path: 'steps[1].config.x', code: 'forwardReference' as never, message: 'broken ref', location: { scope: 'step', stepId: 'b', field: 'x' } },
    { path: 'steps[2].id', code: 'duplicateStepId' as never, message: 'dup', location: { scope: 'step', stepId: 'c' } },
  ],
};

describe('groupIssues', () => {
  it('buckets by step and trigger, preserving document order', () => {
    const g = groupIssues(result);
    expect(g.total).toBe(5);
    expect(g.trigger).toHaveLength(1);
    expect(g.orderedStepIds).toEqual(['a', 'b', 'c']);
    expect(g.byStep.get('a')).toHaveLength(2);
    expect(g.byStep.get('b')).toHaveLength(1);
    expect(g.unlocated).toHaveLength(0);
  });

  it('handles null / empty', () => {
    expect(groupIssues(null).total).toBe(0);
    expect(groupIssues({ valid: true, issues: [] }).orderedStepIds).toEqual([]);
  });

  it('collects issues without a location into `unlocated`', () => {
    const g = groupIssues({
      valid: false,
      issues: [{ path: 'x', code: 'shape' as never, message: 'm' }],
    });
    expect(g.unlocated).toHaveLength(1);
    expect(g.orderedStepIds).toEqual([]);
  });
});

describe('fieldErrors', () => {
  it('maps location.field → message (first wins), skipping field-less issues', () => {
    const g = groupIssues(result);
    expect(fieldErrors(g.byStep.get('a'))).toEqual({ to: 'to required', body: 'body required' });
    expect(fieldErrors(g.byStep.get('c'))).toEqual({}); // whole-step issue, no field
  });
});
