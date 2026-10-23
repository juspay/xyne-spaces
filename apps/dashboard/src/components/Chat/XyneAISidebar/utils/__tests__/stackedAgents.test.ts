import { describe, expect, it } from 'vitest';
import { MAX_STACKED_AGENTS, stackedAgents } from '../XyneAIUtils';

describe('stackedAgents', () => {
  it('shows every agent when there are at most three', () => {
    expect(stackedAgents(['xyne', 'ask-ai'])).toEqual({
      shown: ['xyne', 'ask-ai'],
      hiddenCount: 0,
    });
    expect(stackedAgents(['xyne', 'ask-ai', 'claw'])).toEqual({
      shown: ['xyne', 'ask-ai', 'claw'],
      hiddenCount: 0,
    });
  });

  it('shows the first three and counts the rest', () => {
    expect(stackedAgents(['xyne', 'ask-ai', 'assistant', 'claw', 'grok'])).toEqual({
      shown: ['xyne', 'ask-ai', 'assistant'],
      hiddenCount: 2,
    });
  });

  it('counts each agent once', () => {
    expect(stackedAgents(['xyne', 'ask-ai', 'xyne', 'claw', 'ask-ai', 'grok'])).toEqual({
      shown: ['xyne', 'ask-ai', 'claw'],
      hiddenCount: 1,
    });
  });

  it('handles an empty list', () => {
    expect(stackedAgents([])).toEqual({ shown: [], hiddenCount: 0 });
  });

  it('caps at three by default', () => {
    expect(MAX_STACKED_AGENTS).toBe(3);
  });
});
