import {
  computeWikiFreshness,
  wikiAskAiFreshnessInstruction,
} from '../../../src/sdlc/wiki/wikiFreshness';

describe('Wiki freshness', () => {
  it('is current only when both commit identities match', () => {
    expect(
      computeWikiFreshness({ wikiCommitSha: 'A'.repeat(40), baseBranchHeadSha: 'a'.repeat(40) })
        .freshness
    ).toBe('CURRENT');
    expect(
      computeWikiFreshness({ wikiCommitSha: 'a'.repeat(40), baseBranchHeadSha: 'b'.repeat(40) })
        .freshness
    ).toBe('STALE');
    expect(computeWikiFreshness({ wikiCommitSha: null, baseBranchHeadSha: null }).freshness).toBe(
      'UNKNOWN'
    );
  });

  it('requires live-code verification and stale disclosure', () => {
    const instruction = wikiAskAiFreshnessInstruction({
      wikiCommitSha: 'a'.repeat(40),
      baseBranchHeadSha: 'b'.repeat(40),
      freshness: 'STALE',
    });
    expect(instruction).toContain('Use the Wiki only for orientation');
    expect(instruction).toContain('Inspect live code');
    expect(instruction).toContain('disclose');
    expect(instruction).toContain('current code wins');
  });
});
