import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  decodeHtmlEntities,
  stripHtmlForPlainText,
} from '@/src/components/input-composer/utils/html-plain-text';

describe('decodeHtmlEntities', () => {
  it('decodes the named entities', () => {
    assert.equal(decodeHtmlEntities('a &amp; b'), 'a & b');
    assert.equal(decodeHtmlEntities('&lt;tag&gt;'), '<tag>');
    assert.equal(decodeHtmlEntities('&quot;q&quot;'), '"q"');
    assert.equal(decodeHtmlEntities('&#39;s&#39; &apos;t&apos;'), "'s' 't'");
    assert.equal(decodeHtmlEntities('a&nbsp;b'), 'a b');
  });

  it('decodes numeric (decimal and hex) references', () => {
    assert.equal(decodeHtmlEntities('&#66;&#x41;'), 'BA');
  });

  it('leaves out-of-range numeric references untouched', () => {
    assert.equal(decodeHtmlEntities('&#x110000;'), '&#x110000;');
  });

  it('decodes &amp; last so &amp;lt; becomes &lt; (not <)', () => {
    assert.equal(decodeHtmlEntities('&amp;lt;'), '&lt;');
  });
});

describe('stripHtmlForPlainText', () => {
  it('unwraps html/body and drops paragraph tags', () => {
    assert.equal(stripHtmlForPlainText('<html><body><p>Hello</p></body></html>'), 'Hello');
  });

  it('turns <br> into a newline', () => {
    assert.equal(stripHtmlForPlainText('a<br>b'), 'a\nb');
  });

  it('separates block elements with newlines', () => {
    assert.equal(stripHtmlForPlainText('<p>one</p><p>two</p>'), 'one\ntwo');
  });

  it('preserves an intentional empty paragraph as a blank line', () => {
    assert.equal(stripHtmlForPlainText('<p>a</p><p><br></p><p>b</p>'), 'a\n\nb');
  });

  it('decodes entities in the stripped text', () => {
    assert.equal(stripHtmlForPlainText('<p>a &amp; b</p>'), 'a & b');
  });
});
