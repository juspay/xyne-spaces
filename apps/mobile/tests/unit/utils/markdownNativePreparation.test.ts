import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { prepareChatMarkdownForMd4c } from '@/src/utils/markdownNativePreparation';

const ZERO_WIDTH_GUARD = '\n\u200b';

describe('prepareChatMarkdownForMd4c — bare URL linkification', () => {
  it('wraps a bare http(s) URL in an inline markdown link', () => {
    assert.equal(
      prepareChatMarkdownForMd4c('visit https://x.com'),
      'visit [https://x.com](https://x.com)',
    );
  });

  it('keeps trailing sentence punctuation outside the link', () => {
    assert.equal(
      prepareChatMarkdownForMd4c('see https://x.com.'),
      'see [https://x.com](https://x.com).',
    );
  });

  it('does not re-link an existing markdown link', () => {
    assert.equal(prepareChatMarkdownForMd4c('[x](https://y.com)'), '[x](https://y.com)');
  });

  it('does not link a URL inside inline code', () => {
    assert.equal(prepareChatMarkdownForMd4c('`https://x.com`'), '`https://x.com`');
  });
});

describe('prepareChatMarkdownForMd4c — hard breaks', () => {
  it('promotes a lone newline to a CommonMark hard break', () => {
    assert.equal(prepareChatMarkdownForMd4c('a\nb'), 'a  \nb');
  });

  it('keeps a newline before a list marker structural (no hard break)', () => {
    assert.equal(prepareChatMarkdownForMd4c('a\n- b'), 'a\n- b');
    assert.equal(prepareChatMarkdownForMd4c('a\n1. b'), 'a\n1. b');
  });

  it('leaves single-line input without a newline untouched', () => {
    assert.equal(prepareChatMarkdownForMd4c('hello world'), 'hello world');
  });
});

describe('prepareChatMarkdownForMd4c — fenced code blocks', () => {
  it('preserves fenced content verbatim and does not linkify URLs inside it', () => {
    const input = '```\nhttps://x.com\nline2\n```';
    const output = prepareChatMarkdownForMd4c(input);
    assert.ok(output.startsWith('```\nhttps://x.com\nline2\n```'));
    assert.ok(!output.includes('](https://x.com)'));
  });

  it('appends a zero-width guard when the message ends with a fenced block', () => {
    const output = prepareChatMarkdownForMd4c('```\ncode\n```');
    assert.ok(output.endsWith(ZERO_WIDTH_GUARD));
  });

  it('does not append the guard when text follows the fenced block', () => {
    const output = prepareChatMarkdownForMd4c('```\ncode\n```\nafter');
    assert.ok(!output.endsWith(ZERO_WIDTH_GUARD));
  });
});
