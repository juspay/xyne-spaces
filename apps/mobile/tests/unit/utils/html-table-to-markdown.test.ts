import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  convertHtmlTablesToMarkdown,
  quoteMarkdownHoistingTables,
} from '@/src/features/chat/v2/components/conversation-composer/utils/htmlTableToMarkdown';
import { decodeEntitySet, stripHtmlTags } from '@/src/utils/htmlText';

/** Stand-in for htmlToMD's cell converter: strip tags, decode the entities we use. */
const cell = (html: string): string =>
  decodeEntitySet(stripHtmlTags(html), { nbsp: ' ', amp: '&' }).trim();

describe('convertHtmlTablesToMarkdown', () => {
  it('leaves html without a table untouched', () => {
    const html = '<p>no table here</p>';
    assert.equal(convertHtmlTablesToMarkdown(html, cell), html);
  });

  it('converts a th/td data table to a GFM pipe table', () => {
    const html =
      '<table><thead><tr><th>external_id</th><th>amount</th></tr></thead>' +
      '<tbody><tr><td>9fda7782</td><td>5000</td></tr>' +
      '<tr><td>bf916ff6</td><td>695</td></tr></tbody></table>';

    assert.equal(
      convertHtmlTablesToMarkdown(html, cell).trim(),
      [
        '| external_id | amount |',
        '| --- | --- |',
        '| 9fda7782 | 5000 |',
        '| bf916ff6 | 695 |',
      ].join('\n'),
    );
  });

  it('promotes the first row to a header when the table has no th', () => {
    const html = '<table><tr><td>a</td><td>b</td></tr><tr><td>1</td><td>2</td></tr></table>';

    assert.equal(
      convertHtmlTablesToMarkdown(html, cell).trim(),
      ['| a | b |', '| --- | --- |', '| 1 | 2 |'].join('\n'),
    );
  });

  it('pads short rows so every row has the same column count', () => {
    const html = '<table><tr><td>a</td><td>b</td><td>c</td></tr><tr><td>1</td></tr></table>';

    assert.equal(
      convertHtmlTablesToMarkdown(html, cell).trim(),
      ['| a | b | c |', '| --- | --- | --- |', '| 1 |  |  |'].join('\n'),
    );
  });

  it('never emits `||`, which the renderer parses as spoiler syntax', () => {
    const html = '<table><tr><td>a</td><td></td></tr><tr><td></td><td></td></tr></table>';
    assert.ok(!convertHtmlTablesToMarkdown(html, cell).includes('||'));
  });

  it('escapes pipes inside cell text', () => {
    const html = '<table><tr><td>a|b</td><td>c</td></tr><tr><td>1</td><td>2</td></tr></table>';
    const out = convertHtmlTablesToMarkdown(html, cell);
    assert.ok(out.includes('| a\\|b | c |'));
  });

  it('flattens multi-line cell content onto one row', () => {
    const html = '<table><tr><td>a</td><td>b</td></tr><tr><td>one\ntwo</td><td>3</td></tr></table>';
    const out = convertHtmlTablesToMarkdown(html, cell);
    assert.ok(out.includes('| one two | 3 |'));
    assert.ok(!out.includes('one\ntwo'));
  });

  it('unwraps a single-column layout table instead of converting it', () => {
    const html = '<table><tr><td>just chrome</td></tr><tr><td>more chrome</td></tr></table>';
    const out = convertHtmlTablesToMarkdown(html, cell);
    assert.ok(!out.includes('|'));
    assert.ok(out.includes('just chrome'));
    assert.ok(out.includes('more chrome'));
  });

  it('converts the inner data table when a layout table wraps it', () => {
    const html =
      '<table><tr><td><table><tr><th>h1</th><th>h2</th></tr>' +
      '<tr><td>v1</td><td>v2</td></tr></table></td></tr></table>';
    const out = convertHtmlTablesToMarkdown(html, cell);
    assert.ok(out.includes('| h1 | h2 |'));
    assert.ok(out.includes('| --- | --- |'));
    assert.ok(out.includes('| v1 | v2 |'));
  });

  it('terminates on an unclosed table tag', () => {
    const html = '<table><tr><td>a</td><td>b</td></tr>';
    assert.equal(convertHtmlTablesToMarkdown(html, cell), html);
  });
});

describe('quoteMarkdownHoistingTables', () => {
  it('prefixes ordinary quoted lines', () => {
    assert.equal(quoteMarkdownHoistingTables('one\ntwo'), '> one\n> two');
  });

  it('drops blank lines and returns empty for empty input', () => {
    assert.equal(quoteMarkdownHoistingTables('\n\n  \n'), '');
  });

  it('leaves a table block unquoted so it stays a document-root child', () => {
    const md = ['intro line', '| a | b |', '| --- | --- |', '| 1 | 2 |'].join('\n');

    assert.equal(
      quoteMarkdownHoistingTables(md),
      ['> intro line', '', '| a | b |', '| --- | --- |', '| 1 | 2 |'].join('\n'),
    );
  });

  it('re-quotes text that follows a table', () => {
    const md = ['before', '| a | b |', '| --- | --- |', 'after'].join('\n');

    assert.equal(
      quoteMarkdownHoistingTables(md),
      ['> before', '', '| a | b |', '| --- | --- |', '', '> after'].join('\n'),
    );
  });
});
