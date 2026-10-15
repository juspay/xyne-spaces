import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { stripHtml } from '@/src/features/xyne-desks/detail/utils/strip-html';

describe('stripHtml', () => {
  it('returns an empty string for empty input', () => {
    assert.equal(stripHtml(''), '');
  });

  it('turns paragraph breaks into blank lines', () => {
    assert.equal(stripHtml('<p>Hello</p><p>World</p>'), 'Hello\n\n World');
  });

  it('turns <br> variants into single newlines', () => {
    assert.equal(stripHtml('a<br>b<br/>c'), 'a\nb\nc');
  });

  it('turns closing div tags into newlines', () => {
    assert.equal(stripHtml('<div>x</div><div>y</div>'), 'x\n y');
  });

  it('decodes common and numeric HTML entities', () => {
    assert.equal(
      stripHtml('Tom &amp; Jerry &lt;3 &gt; 2 &quot;q&quot; &#39;s&#39; &#65;'),
      'Tom & Jerry <3 > 2 "q" \'s\' A',
    );
  });

  it('drops <style> and <script> blocks entirely', () => {
    assert.equal(stripHtml('<style>.a{}</style><script>bad()</script>keep'), 'keep');
  });

  it('collapses non-breaking spaces into a single space', () => {
    assert.equal(stripHtml('a&nbsp;&nbsp;b'), 'a b');
  });
});
