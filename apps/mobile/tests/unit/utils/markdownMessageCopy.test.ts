import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { isMarkdownMessageBody, markdownToMessageCopy } from '@/src/utils/markdownMessageCopy';

describe('isMarkdownMessageBody', () => {
  it('treats tag-free bodies (agent responses) as markdown', () => {
    assert.equal(isMarkdownMessageBody('**Ticket:** done\n- a\n- b'), true);
    assert.equal(isMarkdownMessageBody('a < b and c > d'), true);
  });

  it('keeps composer HTML on the HTML path', () => {
    assert.equal(isMarkdownMessageBody('<p><strong>hi</strong></p>'), false);
    assert.equal(isMarkdownMessageBody('hello<br>world'), false);
    assert.equal(isMarkdownMessageBody('   '), false);
  });
});

describe('markdownToMessageCopy', () => {
  it('converts inline emphasis, code and links', () => {
    const result = markdownToMessageCopy(
      '**Bold** *it* ~~old~~ `a<b` [docs](https://x.y) snake_case_name',
    );
    assert.equal(
      result.storedHtml,
      '<p><strong>Bold</strong> <em>it</em> <s>old</s> <code>a&lt;b</code> <a href="https://x.y">docs</a> snake_case_name</p>',
    );
    assert.equal(result.plainText, 'Bold it old a<b docs snake_case_name');
  });

  it('keeps paragraphs, blank-line gaps and lists as blocks', () => {
    const result = markdownToMessageCopy(
      'Intro line\n\n- **Ticket:** XYNE-1\n- **CI:** passed\n\nNext:\n1. Add reviewers\n2. Run checks',
    );
    assert.equal(
      result.storedHtml,
      '<p>Intro line</p><p></p>' +
        '<ul><li><p><strong>Ticket:</strong> XYNE-1</p></li><li><p><strong>CI:</strong> passed</p></li></ul>' +
        '<p></p><p>Next:</p>' +
        '<ol><li><p>Add reviewers</p></li><li><p>Run checks</p></li></ol>',
    );
    assert.equal(
      result.plainText,
      'Intro line\n\n• Ticket: XYNE-1\n• CI: passed\n\nNext:\n1. Add reviewers\n2. Run checks',
    );
  });

  it('flattens nested list items without line breaks inside an item', () => {
    const result = markdownToMessageCopy('1. Run checks:\n   - iOS\n   - Android');
    assert.equal(
      result.storedHtml,
      '<ol><li><p>Run checks:</p></li></ol><ul><li><p>iOS</p></li><li><p>Android</p></li></ul>',
    );
    assert.equal(result.plainText, '1. Run checks:\n   • iOS\n   • Android');
    assert.equal(result.storedHtml.includes('<br>'), false);
  });

  it('converts code fences without interpreting markdown inside them', () => {
    const result = markdownToMessageCopy('```ts\nconst x = a < b && **c**;\n```');
    assert.equal(result.storedHtml, '<pre><code>const x = a &lt; b &amp;&amp; **c**;</code></pre>');
    assert.equal(result.plainText, 'const x = a < b && **c**;');
  });

  it('maps headings to bold paragraphs, quotes to blockquotes and tables to rows', () => {
    const result = markdownToMessageCopy('## Summary\n> note\n\n| a | b |\n|---|---|\n| 1 | 2 |');
    assert.equal(
      result.storedHtml,
      '<p><strong>Summary</strong></p><blockquote><p>note</p></blockquote>' +
        '<p></p><p><strong>a</strong> | <strong>b</strong></p><p>1 | 2</p>',
    );
    assert.equal(result.plainText, 'Summary\nnote\n\na | b\n1 | 2');
  });

  it('turns Spaces user-mention links into dashboard mention spans', () => {
    const result = markdownToMessageCopy('Ping [**@Ada**](xyne://user/u3) now');
    assert.equal(
      result.storedHtml,
      '<p>Ping <span class="chat-input-mention" data-user-id="u3" data-username="Ada">@Ada</span> now</p>',
    );
    assert.equal(result.plainText, 'Ping @Ada now');
  });

  it('escapes raw HTML-like text so it cannot inject markup', () => {
    const result = markdownToMessageCopy('use "x" & <y');
    assert.equal(result.storedHtml, '<p>use &quot;x&quot; &amp; &lt;y</p>');
  });
});
