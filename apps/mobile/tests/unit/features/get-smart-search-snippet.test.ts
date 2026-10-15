import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { getSmartSearchSnippet } from '@/src/features/xyne-desks/tickets/utils/get-smart-search-snippet';

describe('getSmartSearchSnippet', () => {
  it('returns an empty string for empty input', () => {
    assert.equal(getSmartSearchSnippet(''), '');
  });

  it('returns an empty string when the input has no words after stripping tags', () => {
    assert.equal(getSmartSearchSnippet('<p>   </p>'), '');
  });

  it('strips surrounding tags but preserves <hi> highlight tags', () => {
    assert.equal(getSmartSearchSnippet('<p>hello <hi>world</hi></p>'), 'hello <hi>world</hi>');
  });

  it('decodes entities while keeping highlights', () => {
    assert.equal(getSmartSearchSnippet('a &amp; b <hi>c</hi>'), 'a & b <hi>c</hi>');
  });

  it('merges adjacent highlighted words into a single <hi> span', () => {
    assert.equal(getSmartSearchSnippet('<hi>a</hi> <hi>b</hi> c'), '<hi>a b</hi> c');
  });

  it('returns the whole text unchanged when word count is within the limit', () => {
    assert.equal(getSmartSearchSnippet('w0 w1 <hi>h</hi> w3 w4', 5), 'w0 w1 <hi>h</hi> w3 w4');
  });

  it('omits the leading ellipsis when the best window starts at the beginning', () => {
    const startHot = ['<hi>k0</hi>', '<hi>k1</hi>', 'w2', 'w3', 'w4', 'w5', 'w6', 'w7'].join(' ');
    assert.equal(getSmartSearchSnippet(startHot, 3), '<hi>k0 k1</hi> w2 ...');
  });

  it('centres the window on the densest highlight and adds both ellipses when clipped mid-text', () => {
    const long = Array.from({ length: 60 }, (_, i) =>
      i === 50 ? '<hi>needle</hi>' : `w${i}`,
    ).join(' ');
    assert.equal(getSmartSearchSnippet(long, 5), '... w46 w47 w48 w49 <hi>needle</hi> ...');
  });
});
