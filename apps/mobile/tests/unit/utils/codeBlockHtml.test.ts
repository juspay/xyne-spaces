import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { codeBlockHtmlToEscapedText } from '@/src/utils/codeBlockHtml';

describe('codeBlockHtmlToEscapedText', () => {
  it('returns plain text unchanged', () => {
    assert.equal(codeBlockHtmlToEscapedText('hello world'), 'hello world');
  });

  it('converts <br> into newlines', () => {
    assert.equal(codeBlockHtmlToEscapedText('a<br>b'), 'a\nb');
    assert.equal(codeBlockHtmlToEscapedText('a<br/>b'), 'a\nb');
    assert.equal(codeBlockHtmlToEscapedText('a<br />b'), 'a\nb');
  });

  it('turns paragraph boundaries into newlines and trims trailing whitespace', () => {
    assert.equal(codeBlockHtmlToEscapedText('<p>one</p><p>two</p>'), 'one\ntwo');
  });

  it('strips unknown tags', () => {
    assert.equal(codeBlockHtmlToEscapedText('<span>x</span>'), 'x');
  });

  it('decodes entities then re-escapes so markup is inert', () => {
    assert.equal(codeBlockHtmlToEscapedText('&lt;div&gt;'), '&lt;div&gt;');
    assert.equal(codeBlockHtmlToEscapedText('a &amp; b'), 'a &amp; b');
    assert.equal(codeBlockHtmlToEscapedText('&quot;hi&quot;'), '&quot;hi&quot;');
  });

  it('decodes decimal and hex numeric character references', () => {
    assert.equal(codeBlockHtmlToEscapedText('&#65;&#66;'), 'AB');
    assert.equal(codeBlockHtmlToEscapedText('&#x41;&#x42;'), 'AB');
  });

  it('decodes &nbsp; to a normal space', () => {
    assert.equal(codeBlockHtmlToEscapedText('a&nbsp;b'), 'a b');
  });
});
