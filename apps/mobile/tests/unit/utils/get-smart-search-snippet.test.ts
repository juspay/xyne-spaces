import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { getSmartSearchSnippet } from '@/src/features/xyne-desks/tickets/utils/get-smart-search-snippet';

describe('getSmartSearchSnippet', () => {
  it('returns empty string for empty or tag-only input', () => {
    assert.equal(getSmartSearchSnippet(''), '');
    assert.equal(getSmartSearchSnippet('<p></p>'), '');
  });

  it('strips markup and collapses whitespace for a short snippet', () => {
    assert.equal(getSmartSearchSnippet('<p>hi   <b>there</b></p>'), 'hi there');
  });

  it('converts <br> to a space', () => {
    assert.equal(getSmartSearchSnippet('a<br>b'), 'a b');
  });

  it('decodes the supported HTML entities', () => {
    assert.equal(
      getSmartSearchSnippet('a &amp; b &lt;x&gt; &quot;q&quot; &#39;s&#39;'),
      'a & b <x> "q" \'s\'',
    );
  });

  it('preserves <hi> highlight tags', () => {
    assert.equal(getSmartSearchSnippet('<hi>foo</hi> bar'), '<hi>foo</hi> bar');
  });

  it('merges adjacent highlighted words into one <hi> run', () => {
    assert.equal(getSmartSearchSnippet('<hi>foo</hi> <hi>bar</hi>'), '<hi>foo bar</hi>');
  });

  it('adds a trailing ellipsis when truncating from the start', () => {
    assert.equal(getSmartSearchSnippet('one two three', 2), 'one two ...');
  });

  it('windows around the densest highlight and prefixes an ellipsis', () => {
    const filler = Array.from({ length: 45 }, () => 'x').join(' ');
    const result = getSmartSearchSnippet(`${filler} <hi>KEY</hi>`, 40);
    assert.ok(result.startsWith('... '), `expected leading ellipsis, got: ${result}`);
    assert.ok(result.includes('<hi>KEY</hi>'), `expected highlight retained, got: ${result}`);
    assert.ok(!result.endsWith('...'), `did not expect trailing ellipsis, got: ${result}`);
  });
});
