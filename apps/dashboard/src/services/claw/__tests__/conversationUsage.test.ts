import { describe, expect, it } from 'vitest';
import {
  agentPagePath,
  agentScopeLabel,
  formatTokenCount,
  summarizeConversationRuns,
} from '../conversationUsage';

const run = (
  tokensIn: number | null,
  tokensOut: number | null,
  tokensCacheRead: number | null = null,
  tokensCacheWrite: number | null = null,
): {
  tokensIn: number | null;
  tokensOut: number | null;
  tokensCacheRead: number | null;
  tokensCacheWrite: number | null;
} => ({ tokensIn, tokensOut, tokensCacheRead, tokensCacheWrite });

describe('conversationUsage', () => {
  it('adds up tokens across every run of the chat', () => {
    expect(
      summarizeConversationRuns([run(1200, 300, 800, 100), run(4000, 50, 2000), run(10, 5)]),
    ).toEqual({ tokensIn: 5210, tokensOut: 355, tokensCached: 2900, total: 5565, runs: 3 });
  });

  it('counts runs without token data as zero but still as runs', () => {
    expect(summarizeConversationRuns([run(null, null), run(null, 7)])).toEqual({
      tokensIn: 0,
      tokensOut: 7,
      tokensCached: 0,
      total: 7,
      runs: 2,
    });
    expect(summarizeConversationRuns([]).runs).toBe(0);
  });

  it('formats token counts compactly', () => {
    expect(formatTokenCount(0)).toBe('0');
    expect(formatTokenCount(999)).toBe('999');
    expect(formatTokenCount(1234)).toBe('1.2k');
    expect(formatTokenCount(56_789)).toBe('57k');
    expect(formatTokenCount(1_234_567)).toBe('1.2M');
    expect(formatTokenCount(23_456_789)).toBe('23M');
  });

  it('labels the agent scope', () => {
    expect(agentScopeLabel('global')).toBe('Global');
    expect(agentScopeLabel('personal')).toBe('Personal');
  });

  it('links to the agent page tabs with an encoded slug', () => {
    expect(agentPagePath('pokemon-dex', 'activity')).toBe(
      '/ai/library/agent/pokemon-dex?tab=activity',
    );
    expect(agentPagePath('a b', 'persona')).toBe('/ai/library/agent/a%20b?tab=persona');
  });
});
