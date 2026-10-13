import { describe, expect, it } from 'vitest';
import { lastAgentSlugOf, shouldRouteStreamState } from '../xyneAIStreamRouting';

describe('lastAgentSlugOf', () => {
  it('returns the newest message that names an agent', () => {
    expect(
      lastAgentSlugOf([
        { agentSlug: 'agent-x' },
        { agentSlug: 'agent-y' },
        { agentSlug: null },
        {},
      ]),
    ).toBe('agent-y');
  });

  it('returns undefined when no message names an agent', () => {
    expect(lastAgentSlugOf([{}, { agentSlug: null }])).toBeUndefined();
    expect(lastAgentSlugOf([])).toBeUndefined();
  });
});

describe('shouldRouteStreamState', () => {
  const base = {
    streamSessionKey: 'slot-a',
    currentStreamId: null,
    conversationId: 'chat-a',
    dispatchedAgentSlug: null,
  };

  it('routes a driving stream of the selected agent that matches the slot', () => {
    expect(
      shouldRouteStreamState({
        ...base,
        expectedAgentSlug: 'agent-x',
        state: { streamId: 's1', agentSlug: 'agent-x', streamSlotKey: 'slot-a' },
      }),
    ).toBe(true);
  });

  it('drops a driving stream of another agent (unchanged behaviour)', () => {
    expect(
      shouldRouteStreamState({
        ...base,
        expectedAgentSlug: 'agent-x',
        state: {
          streamId: 's1',
          agentSlug: 'agent-y',
          streamSlotKey: 'slot-a',
          sessionId: 'chat-a',
        },
      }),
    ).toBe(false);
  });

  it('routes a driving stream of the agent the hook last dispatched', () => {
    expect(
      shouldRouteStreamState({
        ...base,
        expectedAgentSlug: 'agent-x',
        dispatchedAgentSlug: 'agent-y',
        state: { streamId: 's1', agentSlug: 'agent-y', streamSlotKey: 'slot-a' },
      }),
    ).toBe(true);
  });

  it('treats a missing agent as ask-ai on both sides', () => {
    expect(
      shouldRouteStreamState({
        ...base,
        expectedAgentSlug: null,
        state: { streamId: 's1', streamSlotKey: 'slot-a' },
      }),
    ).toBe(true);
  });

  // XYNE-66346: reload mid-run — the viewer was attached as the stale picked
  // agent (Y) while the hook re-rendered onto the chat's last agent (X).
  it('routes a live viewer of this conversation whatever its agent', () => {
    expect(
      shouldRouteStreamState({
        ...base,
        expectedAgentSlug: 'agent-x',
        state: { streamId: 'live-123-abc', agentSlug: 'agent-y', sessionId: 'chat-a' },
      }),
    ).toBe(true);
    expect(
      shouldRouteStreamState({
        ...base,
        expectedAgentSlug: 'agent-x',
        state: { streamId: 'live-123-abc', agentSlug: 'agent-y', streamSlotKey: 'slot-a' },
      }),
    ).toBe(true);
  });

  it('drops a live viewer of a different conversation', () => {
    expect(
      shouldRouteStreamState({
        ...base,
        expectedAgentSlug: 'agent-x',
        state: {
          streamId: 'live-123-abc',
          agentSlug: 'agent-x',
          streamSlotKey: 'slot-b',
          sessionId: 'chat-b',
        },
      }),
    ).toBe(false);
  });

  it('routes the tracked stream by id even after slot and session change', () => {
    expect(
      shouldRouteStreamState({
        ...base,
        currentStreamId: 's1',
        expectedAgentSlug: 'agent-x',
        state: { streamId: 's1', agentSlug: 'agent-x', streamSlotKey: 'other', sessionId: 'other' },
      }),
    ).toBe(true);
  });
});
