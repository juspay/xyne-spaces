import { describe, expect, it } from 'vitest';
import type { AccessibleClawAgent } from '../../services/clawAgentListService';
import { ASK_AI_LABEL, matchesText, rankAgentsByQuery } from './agentSearch';

const agent = (slug: string, name: string, description?: string): AccessibleClawAgent => ({
  slug,
  name,
  color: '#000',
  ...(description !== undefined ? { description } : {}),
});

// API returns agents alphabetically; description-only matches come first there.
const AGENTS: AccessibleClawAgent[] = [
  agent('credit-report-generator', 'Credit Report Generator', 'shares the reports in Xyne'),
  agent('mettlegati-doctor', 'MettleGati Doctor', 'Investigates bugs in the xyne-spaces codebase'),
  agent('my-xyne-helper', 'My Xyne Helper'),
  agent('search-doctor', 'Search Doctor', 'xyne search triage agent'),
  agent('spaces-bot', 'Spaces Bot', 'unrelated'),
  agent('xyne-spaces-architect', 'Xyne Spaces Architect', 'architecture reviews'),
];

describe('rankAgentsByQuery', () => {
  it('returns the list unchanged for an empty query', () => {
    expect(rankAgentsByQuery(AGENTS, '   ')).toEqual(AGENTS);
  });

  it('ranks name prefix, then word-start, then description-only matches', () => {
    expect(rankAgentsByQuery(AGENTS, 'xyne').map(a => a.slug)).toEqual([
      'xyne-spaces-architect',
      'my-xyne-helper',
      'credit-report-generator',
      'mettlegati-doctor',
      'search-doctor',
    ]);
  });

  it('is case-insensitive and drops non-matches', () => {
    expect(rankAgentsByQuery(AGENTS, '  DOCTOR ').map(a => a.slug)).toEqual([
      'mettlegati-doctor',
      'search-doctor',
    ]);
  });

  it('matches on slug when the name does not', () => {
    expect(rankAgentsByQuery([agent('foo-bot', 'Helper')], 'foo').map(a => a.slug)).toEqual([
      'foo-bot',
    ]);
  });
});

describe('Ask AI row matching', () => {
  it('matches only queries contained in the label', () => {
    expect(matchesText(ASK_AI_LABEL, 'ask')).toBe(true);
    expect(matchesText(ASK_AI_LABEL, 'xyne')).toBe(false);
  });
});
