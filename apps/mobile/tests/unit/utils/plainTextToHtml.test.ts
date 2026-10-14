import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { plainTextToHtml } from '@/src/utils/plainTextToHtml';

describe('plainTextToHtml', () => {
  it('wraps a single line in a paragraph', () => {
    assert.equal(plainTextToHtml('hello'), '<p>hello</p>');
  });

  it('renders an empty string as one empty paragraph with a break', () => {
    // ''.split('\n') === [''] -> a single zero-length line.
    assert.equal(plainTextToHtml(''), '<p><br></p>');
  });

  it('wraps each newline-separated line in its own paragraph', () => {
    assert.equal(plainTextToHtml('a\nb'), '<p>a</p><p>b</p>');
  });

  it('preserves a blank line between two lines as <p><br></p>', () => {
    assert.equal(plainTextToHtml('a\n\nb'), '<p>a</p><p><br></p><p>b</p>');
  });

  it('preserves a trailing newline as a trailing empty paragraph', () => {
    assert.equal(plainTextToHtml('a\n'), '<p>a</p><p><br></p>');
  });

  it('preserves a leading newline as a leading empty paragraph', () => {
    assert.equal(plainTextToHtml('\na'), '<p><br></p><p>a</p>');
  });

  it('escapes all five HTML-sensitive characters', () => {
    assert.equal(plainTextToHtml('&<>"\''), '<p>&amp;&lt;&gt;&quot;&#039;</p>');
  });

  it('escapes ampersands first so entities are not double-encoded', () => {
    // If '<' were escaped before '&', the output would contain '&amp;lt;'.
    assert.equal(plainTextToHtml('<'), '<p>&lt;</p>');
    assert.equal(plainTextToHtml('&amp;'), '<p>&amp;amp;</p>');
  });

  it('neutralises a script payload rather than emitting live markup', () => {
    assert.equal(
      plainTextToHtml('<script>alert(1)</script>'),
      '<p>&lt;script&gt;alert(1)&lt;/script&gt;</p>',
    );
  });

  it('escapes per line while keeping paragraph structure', () => {
    assert.equal(plainTextToHtml('a & b\n<c>'), '<p>a &amp; b</p><p>&lt;c&gt;</p>');
  });

  it('must not be used to load TipTap HTML (escapes tags)', () => {
    // getEditComposerInitialContent routes HTML through storedHtmlToComposerHtml.
    assert.match(plainTextToHtml('<p>a</p><p></p><p>b</p>'), /&lt;p&gt;/);
  });
});
