import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { decodeHtmlEntities, replaceUntilStable, stripHtmlTags } from '@/src/utils/htmlText';

describe('replaceUntilStable', () => {
  it('repeats the replacement until nothing changes', () => {
    assert.equal(replaceUntilStable('aaab', /ab/g, 'b'), 'b');
  });

  it('returns the input when the pattern does not match', () => {
    assert.equal(replaceUntilStable('plain', /x/g), 'plain');
  });
});

describe('stripHtmlTags', () => {
  it('removes tags and keeps text', () => {
    assert.equal(stripHtmlTags('<p>Hello <b>world</b></p>'), 'Hello world');
  });

  it('leaves no tag behind when tags are nested inside tags', () => {
    const text = stripHtmlTags('<scr<b>ipt>alert(1)</scr</b>ipt>');
    assert.equal(text.includes('<'), false);
    assert.equal(text.includes('alert(1)'), true);
  });

  it('leaves a lone less-than sign that is not a tag', () => {
    assert.equal(stripHtmlTags('1 < 2'), '1 < 2');
  });
});

describe('decodeHtmlEntities', () => {
  it('decodes named entities', () => {
    assert.equal(
      decodeHtmlEntities('&lt;a&gt; &amp; &quot;b&quot; &apos;c&apos;'),
      '<a> & "b" \'c\'',
    );
  });

  it('decodes &nbsp; to a regular space', () => {
    assert.equal(decodeHtmlEntities('a&nbsp;b'), 'a b');
  });

  it('decodes decimal and hex numeric entities', () => {
    assert.equal(decodeHtmlEntities('&#39;&#x27;&#128512;'), "''😀");
  });

  it('decodes only once', () => {
    assert.equal(decodeHtmlEntities('&amp;lt;b&amp;gt;'), '&lt;b&gt;');
  });

  it('leaves unknown and out-of-range entities unchanged', () => {
    assert.equal(decodeHtmlEntities('&unknown; &#x110000;'), '&unknown; &#x110000;');
  });
});
