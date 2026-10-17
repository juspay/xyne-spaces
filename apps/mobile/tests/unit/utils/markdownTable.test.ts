import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { hasBlockMarkdown } from '@/src/features/chat/v2/components/conversation-composer/utils/parseInlineRich';
import {
  getMarkdownTableLineIndexes,
  hasMarkdownTable,
  markdownFlavorFor,
} from '@/src/utils/markdownTable';
import { prepareChatMarkdownForMd4c } from '@/src/utils/markdownNativePreparation';

const AGENT_TABLE = [
  '| Ticket | Title | Priority |',
  '| --- | --- | --- |',
  '| `XYNE-62465` | Mobile notification navigation | HIGH |',
  '| `XYNE-62469` | Tickets in Mobile | MEDIUM |',
].join('\n');

const BARE_PIPE_TABLE = ['Ticket | Priority', '--- | ---', 'XYNE-62465 | HIGH'].join('\n');

describe('GFM table classification', () => {
  it('detects the agent table and selects the github renderer', () => {
    assert.equal(hasMarkdownTable(AGENT_TABLE), true);
    assert.equal(markdownFlavorFor(AGENT_TABLE), 'github');
  });

  it('detects rows without leading or trailing pipes', () => {
    assert.equal(hasMarkdownTable(BARE_PIPE_TABLE), true);
    assert.equal(hasBlockMarkdown(BARE_PIPE_TABLE), true);
  });

  it('accepts mixed optional boundary pipes', () => {
    const markdown = ['| A | B', '--- | --- |', '| 1 | 2'].join('\n');
    assert.equal(hasMarkdownTable(markdown), true);
  });

  it('normalizes CRLF input', () => {
    assert.equal(hasMarkdownTable('A | B\r\n--- | ---\r\n1 | 2'), true);
  });

  it('detects a table that follows prose and a blank line', () => {
    const markdown = ['Here are your open issues.', '', 'A | B', ':--- | ---:', '1 | 2'].join('\n');
    assert.equal(hasMarkdownTable(markdown), true);
  });

  it('detects a blockquoted table', () => {
    const markdown = ['> A | B', '> --- | ---', '> 1 | 2'].join('\n');
    assert.equal(hasMarkdownTable(markdown), true);
  });

  it('ignores table-like content inside fenced code', () => {
    const markdown = ['```md', 'A | B', '--- | ---', '1 | 2', '```'].join('\n');
    assert.equal(hasMarkdownTable(markdown), false);
  });

  it('rejects a header/delimiter column-count mismatch', () => {
    assert.equal(hasMarkdownTable('A | B | C\n--- | ---\n1 | 2'), false);
  });

  it('ignores pipes in ordinary prose and rows without a delimiter', () => {
    assert.equal(hasMarkdownTable('use `a | b` to pipe, or | this |'), false);
    assert.equal(hasMarkdownTable('Ticket | Priority\nXYNE-1 | HIGH'), false);
    assert.equal(markdownFlavorFor('no table here'), undefined);
  });

  it('marks only the physical lines belonging to a table', () => {
    const indexes = getMarkdownTableLineIndexes(
      ['intro', '', BARE_PIPE_TABLE, '', 'outro'].join('\n'),
    );
    assert.deepEqual([...indexes], [2, 3, 4]);
  });

  it('keeps bare-pipe table rows structural during md4c preparation', () => {
    const prepared = prepareChatMarkdownForMd4c(BARE_PIPE_TABLE);
    assert.equal(prepared, BARE_PIPE_TABLE);
    assert.equal(hasMarkdownTable(prepared), true);
  });
});
