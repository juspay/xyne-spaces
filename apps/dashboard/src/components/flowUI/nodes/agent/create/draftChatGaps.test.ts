import { describe, expect, it } from 'vitest';
import {
  addCapabilityRequest,
  capabilityGapFromInvocation,
  withCapabilityGap,
} from './draftChatGaps';

describe('capabilityGapFromInvocation', () => {
  const frame = {
    toolName: 'report_capability_gap',
    status: 'completed',
    isError: false,
    args: { capability: ' Linear ', status: 'not_added', need: 'list your open issues' },
  };

  it('reads a finished report', () => {
    expect(capabilityGapFromInvocation(frame)).toEqual({
      capability: 'Linear',
      status: 'not_added',
      need: 'list your open issues',
    });
  });

  it('ignores running calls, other tools, errors and bad arguments', () => {
    expect(capabilityGapFromInvocation({ ...frame, status: 'running' })).toBeNull();
    expect(capabilityGapFromInvocation({ ...frame, toolName: 'web-search' })).toBeNull();
    expect(capabilityGapFromInvocation({ ...frame, isError: true })).toBeNull();
    expect(
      capabilityGapFromInvocation({ ...frame, args: { ...frame.args, status: 'someday' } }),
    ).toBeNull();
    expect(capabilityGapFromInvocation({ ...frame, args: { capability: 'Linear' } })).toBeNull();
    expect(capabilityGapFromInvocation(null)).toBeNull();
  });
});

describe('withCapabilityGap', () => {
  it('keeps one row per capability and status', () => {
    const linear = { capability: 'Linear', status: 'not_added' as const, need: 'list issues' };
    const once = withCapabilityGap(undefined, linear);
    expect(withCapabilityGap(once, { ...linear, capability: 'linear' })).toBe(once);
    expect(withCapabilityGap(once, { ...linear, status: 'after_save' })).toHaveLength(2);
  });
});

describe('Build chat requests', () => {
  it('asks to add the capability for what the request needed', () => {
    expect(
      addCapabilityRequest({ capability: 'Linear', status: 'not_added', need: 'List your issues.' }),
    ).toBe('Add Linear so the agent can list your issues.');
    expect(
      addCapabilityRequest({ capability: 'GitHub', status: 'not_added', need: 'read PR status ' }),
    ).toBe('Add GitHub so the agent can read PR status.');
  });
});
