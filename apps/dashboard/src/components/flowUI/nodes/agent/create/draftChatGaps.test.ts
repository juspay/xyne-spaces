import { describe, expect, it } from 'vitest';
import {
  addCapabilityRequest,
  capabilityGapFromInvocation,
  connectorForGap,
  inferredCapabilityGaps,
  isConnectGap,
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
      addCapabilityRequest({
        capability: 'Linear',
        status: 'not_added',
        need: 'List your issues.',
      }),
    ).toBe('Add Linear so the agent can list your issues.');
    expect(
      addCapabilityRequest({ capability: 'GitHub', status: 'not_added', need: 'read PR status ' }),
    ).toBe('Add GitHub so the agent can read PR status.');
  });
});

describe('inferredCapabilityGaps', () => {
  const github = { label: 'GitHub', serverType: 'github', onAgent: false, usable: false };
  const google = { label: 'Google', serverType: 'google', onAgent: true, usable: false };
  const spaces = { label: 'Xyne Spaces', serverType: 'xyne-spaces', onAgent: true, usable: true };
  const cannot = "I don't have access to GitHub in this test run, so I can't check PR status.";

  it('adds the row the model left out, with Add for a connector the agent lacks', () => {
    expect(
      inferredCapabilityGaps('Also check which of these have an open GitHub PR', cannot, [
        github,
        spaces,
      ]),
    ).toEqual([
      {
        capability: 'GitHub',
        status: 'not_added',
        need: 'check which of these have an open GitHub PR',
      },
    ]);
  });

  it('asks to connect one that is on the agent without a key, by any of its names', () => {
    const reply = "I can't read your Gmail in this test.";
    expect(inferredCapabilityGaps('and my Gmail too?', reply, [google])).toEqual([
      { capability: 'Google', status: 'not_connected', need: 'my Gmail too' },
    ]);
  });

  it('stays out of the way when the reply managed, the product works, or the gap was reported', () => {
    expect(
      inferredCapabilityGaps('check GitHub PRs', 'Here are the open PRs: …', [github]),
    ).toEqual([]);
    expect(inferredCapabilityGaps('summarise my Xyne Spaces tickets', cannot, [spaces])).toEqual(
      [],
    );
    const reported = [{ capability: 'GitHub', status: 'not_added' as const, need: 'list PRs' }];
    expect(inferredCapabilityGaps('check GitHub PRs', cannot, [github], reported)).toEqual([]);
  });
});

describe('inferredCapabilityGaps wording', () => {
  const github = { label: 'GitHub', serverType: 'github', onAgent: false, usable: false };
  it('reads "not set up yet" and "once it is connected" as not able to', () => {
    const reply =
      "That needs your GitHub account, which isn't set up on this agent yet. Once GitHub is connected I can pull your open PRs.";
    expect(
      inferredCapabilityGaps('Check which of my GitHub PRs need a review', reply, [github]),
    ).toEqual([
      {
        capability: 'GitHub',
        status: 'not_added',
        need: 'check which of my GitHub PRs need a review',
      },
    ]);
  });
});

describe('connectorForGap', () => {
  const catalog = [
    { label: 'GitHub', slug: 'github', serverType: 'github' },
    { label: 'Google / Gmail', slug: 'google', serverType: 'google' },
    { label: 'Xyne Spaces', slug: 'xyne-spaces', serverType: 'xyne-spaces' },
  ];
  const gap = (capability: string) => ({ capability, status: 'not_added' as const, need: 'x' });

  it('matches a connector by name, with the words models add around it', () => {
    expect(connectorForGap(gap('GitHub'), catalog)?.slug).toBe('github');
    expect(connectorForGap(gap('the GitHub MCP'), catalog)?.slug).toBe('github');
    expect(connectorForGap(gap('Xyne Spaces connector'), catalog)?.slug).toBe('xyne-spaces');
  });

  it('matches a product by the connector that provides it', () => {
    expect(connectorForGap(gap('Gmail'), catalog)?.slug).toBe('google');
    expect(connectorForGap(gap('Google'), catalog)?.slug).toBe('google');
  });

  it('leaves gaps that are not connectors alone', () => {
    expect(connectorForGap(gap('Web search'), catalog)).toBeUndefined();
    expect(connectorForGap(gap('GitHub Actions runner'), catalog)).toBeUndefined();
  });

  it('offers Connect for missing or unconnected connectors only', () => {
    expect(isConnectGap({ ...gap('GitHub'), status: 'not_added' })).toBe(true);
    expect(isConnectGap({ ...gap('GitHub'), status: 'not_connected' })).toBe(true);
    expect(isConnectGap({ ...gap('GitHub'), status: 'after_save' })).toBe(false);
    expect(isConnectGap({ ...gap('Slack'), status: 'test_blocked' })).toBe(false);
  });
});
