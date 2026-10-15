import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { stripMarkdownForPreview } from '@/src/features/chat/v2/components/conversation-composer/utils/markdownPreview';

describe('stripMarkdownForPreview', () => {
  it('returns an empty string for empty input', () => {
    assert.equal(stripMarkdownForPreview(''), '');
  });

  it('unwraps inline code', () => {
    assert.equal(stripMarkdownForPreview('a `code` b'), 'a code b');
  });

  it('removes bold, italic and strikethrough markers', () => {
    assert.equal(stripMarkdownForPreview('**bold**'), 'bold');
    assert.equal(stripMarkdownForPreview('_italic_'), 'italic');
    assert.equal(stripMarkdownForPreview('~~gone~~'), 'gone');
  });

  it('keeps only the text of a link', () => {
    assert.equal(stripMarkdownForPreview('[text](https://example.com)'), 'text');
  });

  it('keeps only the alt text of an image', () => {
    assert.equal(stripMarkdownForPreview('![alt](https://example.com/x.png)'), 'alt');
  });

  it('strips heading and blockquote markers', () => {
    assert.equal(stripMarkdownForPreview('# Title'), 'Title');
    assert.equal(stripMarkdownForPreview('> quote'), 'quote');
  });

  it('normalizes list markers', () => {
    assert.equal(stripMarkdownForPreview('- item'), '• item');
    assert.equal(stripMarkdownForPreview('1) item'), '1. item');
  });

  it('collapses runs of spaces and blank lines', () => {
    assert.equal(stripMarkdownForPreview('a    b'), 'a b');
    assert.equal(stripMarkdownForPreview('a\n\n\n\nb'), 'a\n\nb');
  });

  it('removes the inline image guard character', () => {
    assert.equal(stripMarkdownForPreview('a\u2060b'), 'ab');
  });
});
