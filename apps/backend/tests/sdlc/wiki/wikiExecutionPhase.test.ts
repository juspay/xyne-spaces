import { effectiveWikiRunPhase } from '../../../src/sdlc/wiki/wikiExecutionPhase';

describe('effectiveWikiRunPhase', () => {
  it('does not expose a stale active phase after the workflow failed', () => {
    expect(effectiveWikiRunPhase('FAILURE', 'PROCESSING')).toBe('PARTIALLY_FAILED');
  });

  it('does not expose a stale active phase after the workflow was cancelled', () => {
    expect(effectiveWikiRunPhase('CANCELLED', 'PROCESSING')).toBe('CANCELLED');
  });

  it('keeps the durable phase while the workflow is active', () => {
    expect(effectiveWikiRunPhase('RUNNING', 'PROCESSING')).toBe('PROCESSING');
  });
});
