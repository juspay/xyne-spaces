import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { SELF_MENTION_INDICATOR, ensureSelfMentionIndicator } from '@/src/utils/mention-indicator';

describe('SELF_MENTION_INDICATOR', () => {
  it('is the private-use sentinel U+FFF0', () => {
    assert.equal(SELF_MENTION_INDICATOR, '\uFFF0');
  });
});

describe('ensureSelfMentionIndicator', () => {
  it('appends the sentinel when it is missing', () => {
    assert.deepEqual(ensureSelfMentionIndicator([]), [SELF_MENTION_INDICATOR]);
    assert.deepEqual(ensureSelfMentionIndicator(['@channel']), [
      '@channel',
      SELF_MENTION_INDICATOR,
    ]);
  });

  it('returns the same array reference when the sentinel is already present', () => {
    const input = ['@here', SELF_MENTION_INDICATOR];
    assert.equal(ensureSelfMentionIndicator(input), input);
  });

  it('does not mutate the input when appending', () => {
    const input = ['@here'];
    const copy = [...input];
    ensureSelfMentionIndicator(input);
    assert.deepEqual(input, copy);
  });

  it('does not add a duplicate sentinel', () => {
    const result = ensureSelfMentionIndicator([SELF_MENTION_INDICATOR]);
    assert.equal(result.filter(x => x === SELF_MENTION_INDICATOR).length, 1);
  });
});
