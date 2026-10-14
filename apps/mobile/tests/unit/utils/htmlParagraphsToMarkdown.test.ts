import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { escapePlainTextMarkdownListMarkersInHtmlParagraphs } from '@/src/utils/escapePlainMarkdownListMarkers';
import { prepareChatMarkdownForMd4c } from '@/src/utils/markdownNativePreparation';

describe('prepareChatMarkdownForMd4c', () => {
  const nativeCodeBlockEndGuard = '\n\u200B';

  it('preserves sibling list markers as structural newlines', () => {
    const markdown = '1. First item\n2. Second item\n3. Third item';

    assert.equal(prepareChatMarkdownForMd4c(markdown), markdown);
  });

  it('preserves GFM table rows as structural newlines', () => {
    const markdown = '| a | b |\n| --- | --- |\n| 1 | 2 |';

    assert.equal(prepareChatMarkdownForMd4c(markdown), markdown);
  });

  it('does not hard-break the line that introduces a table', () => {
    const markdown = 'Totals\n| a | b |\n| --- | --- |\n| 1 | 2 |';

    assert.equal(prepareChatMarkdownForMd4c(markdown), markdown);
  });

  it('keeps ordinary single newlines as visible hard breaks', () => {
    assert.equal(
      prepareChatMarkdownForMd4c('First line\nSecond line'),
      'First line  \nSecond line',
    );
  });

  it('preserves nested list boundaries', () => {
    const markdown = '1. Parent\n   - Child\n2. Sibling';

    assert.equal(prepareChatMarkdownForMd4c(markdown), markdown);
  });

  it('preserves deeper ordered-list boundaries', () => {
    const markdown = '1. Parent\n      2. Child\n3. Sibling';

    assert.equal(prepareChatMarkdownForMd4c(markdown), markdown);
  });

  it('preserves longer fenced code blocks without adding hard breaks inside', () => {
    const markdown = ['````ts', 'const fence = "```";', '1. not a list item', '````'].join('\n');

    assert.equal(prepareChatMarkdownForMd4c(markdown), `${markdown}${nativeCodeBlockEndGuard}`);
  });

  it('preserves tilde fenced code blocks without adding hard breaks inside', () => {
    const markdown = ['~~~', 'first line', 'https://example.com/raw_url', '~~~'].join('\n');

    assert.equal(prepareChatMarkdownForMd4c(markdown), `${markdown}${nativeCodeBlockEndGuard}`);
  });

  it('does not add a code block end guard when text follows the fenced block', () => {
    const markdown = ['```', 'first line', '```', '', 'after'].join('\n');
    const prepared = prepareChatMarkdownForMd4c(markdown);

    assert.equal(prepared.includes(nativeCodeBlockEndGuard), false);
    assert.equal(prepared.endsWith('after'), true);
  });
});

describe('escapePlainTextMarkdownListMarkersInHtmlParagraphs', () => {
  it('escapes literal unordered list markers in plain paragraphs', () => {
    const html = '<p>- literal hyphen</p><p>+ literal plus</p><p>* literal star</p>';

    assert.equal(
      escapePlainTextMarkdownListMarkersInHtmlParagraphs(html),
      '<p>\\- literal hyphen</p><p>\\+ literal plus</p><p>\\* literal star</p>',
    );
  });

  it('escapes literal ordered list markers in plain paragraphs', () => {
    const html = '<p>1. literal number</p><p>2) literal paren</p>';

    assert.equal(
      escapePlainTextMarkdownListMarkersInHtmlParagraphs(html),
      '<p>1\\. literal number</p><p>2\\) literal paren</p>',
    );
  });

  it('keeps real list html available for structural list conversion', () => {
    const html = '<ul><li><p>real bullet</p></li></ul>';

    assert.equal(escapePlainTextMarkdownListMarkersInHtmlParagraphs(html), html);
  });
});
