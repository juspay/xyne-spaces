import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { normalizeMarkdownListIndentation } from '@/src/utils/markdownListNormalization';

describe('normalizeMarkdownListIndentation', () => {
  it('aligns consecutive ordered items with incidental indentation', () => {
    const markdown = ['1. First', '  2. Second', '  3. Third', '  4. Fourth'].join('\n');

    assert.equal(
      normalizeMarkdownListIndentation(markdown),
      ['1. First', '2. Second', '3. Third', '4. Fourth'].join('\n'),
    );
  });

  it('preserves a nested ordered list whose numbering starts above one', () => {
    const markdown = ['1. Parent', '   2. Child', '   3. Child', '2. Sibling'].join('\n');

    assert.equal(normalizeMarkdownListIndentation(markdown), markdown);
  });

  it('canonicalizes mixed line endings and non-breaking list indentation', () => {
    const markdown = ['1. First', '\u00a0\u00a0\u00a02. Second', '\u00a0\u00a0\u00a03. Third'].join(
      '\r\n',
    );

    assert.equal(
      normalizeMarkdownListIndentation(markdown),
      ['1. First', '2. Second', '3. Third'].join('\n'),
    );
  });

  it('aligns sequential items separated by blank lines', () => {
    const markdown = ['1. First', '', '  2. Second', '', '  3. Third'].join('\n');

    assert.equal(
      normalizeMarkdownListIndentation(markdown),
      ['1. First', '', '2. Second', '', '3. Third'].join('\n'),
    );
  });

  it('preserves a nested ordered list that restarts its numbering', () => {
    const markdown = ['1. Parent', '   1. Child', '   2. Child', '2. Parent'].join('\n');

    assert.equal(normalizeMarkdownListIndentation(markdown), markdown);
  });

  it('does not rewrite ordered-looking lines inside fenced code', () => {
    const markdown = ['```', '1. First', '   2. Second', '```'].join('\n');

    assert.equal(normalizeMarkdownListIndentation(markdown), markdown);
  });
});
