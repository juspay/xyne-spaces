import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { stripHtml } from '@/src/features/xyne-desks/detail/utils/strip-html';

describe('stripHtml', () => {
  it('returns an empty string for empty input', () => {
    assert.equal(stripHtml(''), '');
  });

  it('removes tags and trims surrounding whitespace', () => {
    assert.equal(stripHtml('<p>Hello</p>'), 'Hello');
  });

  it('collapses &nbsp; into a normal space', () => {
    assert.equal(stripHtml('<p>Hello&nbsp;World</p>'), 'Hello World');
  });

  it('converts <br> variants into newlines', () => {
    assert.equal(stripHtml('a<br>b<br/>c<br />d'), 'a\nb\nc\nd');
  });

  it('drops <style> and <script> blocks entirely', () => {
    assert.equal(stripHtml('<style>.x{color:red}</style>Visible'), 'Visible');
    assert.equal(stripHtml('<script>alert(1)</script>Safe'), 'Safe');
  });

  it('decodes the common named entities', () => {
    assert.equal(stripHtml('Tom &amp; Jerry'), 'Tom & Jerry');
    assert.equal(stripHtml('&lt;tag&gt; &quot;q&quot; &#39;a&#39;'), '<tag> "q" \'a\'');
  });

  it('decodes numeric entities', () => {
    assert.equal(stripHtml('&#65;&#66;&#67;'), 'ABC');
  });

  it('collapses runs of spaces and excess blank lines', () => {
    assert.equal(stripHtml('a    b'), 'a b');
    assert.equal(stripHtml('a<br><br><br><br>b'), 'a\n\nb');
  });
});
