import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { convertHtmlListsToMarkdown } from '@/src/features/chat/v2/components/conversation-composer/utils/htmlListsToMarkdown';

describe('convertHtmlListsToMarkdown', () => {
  it('preserves parent and nested list hierarchy from TipTap HTML', () => {
    const html = [
      '<p>Feedback from Vimal on RN App</p>',
      '<ul>',
      '<li><p>The initial loading was fast</p></li>',
      '<li>',
      '<p>But we need to innovate on the Tab switching UX</p>',
      '<ul>',
      '<li><p>WhatsApp tab switch is instant and the ripple effect like animation is smooth.</p></li>',
      '<li><p>Check the web app.. it switches immediately and loads inside the tab later.</p></li>',
      '<li><p>Xyne - it take times to switch and the ripple effect is also slow.</p></li>',
      '</ul>',
      '</li>',
      '<li>',
      '<p>For message loading inside channels.</p>',
      '<ul><li><p>It seems like it is loading twice.. with a flicker.</p></li></ul>',
      '</li>',
      '</ul>',
    ].join('');

    const markdown = convertHtmlListsToMarkdown(html);

    assert.match(markdown, /<p>Feedback from Vimal on RN App<\/p>\n- The initial loading was fast/);
    assert.match(markdown, /- But we need to innovate on the Tab switching UX\n {3}- WhatsApp/);
    assert.match(
      markdown,
      / {3}- Xyne - it take times to switch and the ripple effect is also slow\.\n- For/,
    );
    assert.match(
      markdown,
      /- For message loading inside channels\.\n {3}- It seems like it is loading twice/,
    );
    assert.doesNotMatch(markdown, /- But we need to innovate on the Tab switching UX\n- WhatsApp/);
  });

  it('keeps ordered-list start and explicit item values', () => {
    const markdown = convertHtmlListsToMarkdown(
      '<ol start="3"><li><p>Parent</p><ul><li>Child</li></ul></li><li value="8">Next</li></ol>',
    );

    assert.equal(markdown, '\n3. Parent\n   - Child\n8. Next\n\n');
  });

  it('preserves nested ordered-list numbering when the child starts above one', () => {
    assert.equal(
      convertHtmlListsToMarkdown(
        '<ol><li>Parent<ol start="2"><li>Child two</li><li>Child three</li></ol></li><li>Sibling</li></ol>',
      ),
      '\n1. Parent\n   2. Child two\n   3. Child three\n2. Sibling\n\n',
    );
  });

  it('supports mixed list types at multiple nesting levels', () => {
    const markdown = convertHtmlListsToMarkdown(
      '<ul><li>one<ul><li>two<ol start="4"><li>three</li></ol></li></ul></li></ul>',
    );

    assert.equal(markdown, '\n- one\n   - two\n      4. three\n\n');
  });

  it('keeps class-indented adjacent list blocks as root lists', () => {
    const html = [
      '<ol class="my-2"><li class="my-1"><p>efeofjoejfoejfoejf</p></li></ol>',
      '<ul class="pl-6 my-2"><li class="my-1"><p>ffefdefd</p></li><li class="my-1"><p>efef</p></li></ul>',
      '<ol class="my-2" start="2"><li class="my-1"><p>fefefewfwefjowefjoewjf</p></li></ol>',
      '<ul class="pl-6 my-2"><li class="my-1"><p>efef</p></li><li class="my-1"><p>fefe</p></li></ul>',
    ].join('');

    assert.equal(
      convertHtmlListsToMarkdown(html),
      '\n1. efeofjoejfoejfoejf\n\n- ffefdefd\n- efef\n\n2. fefefewfwefjowefjoewjf\n\n- efef\n- fefe\n\n',
    );
  });

  it('does not treat mobile/dashboard root list padding as nested markdown', () => {
    const html = [
      '<ul class="list-disc pl-6 my-2">',
      '<li class="my-1"><p>First point</p></li>',
      '<li class="my-1"><p>Second point</p></li>',
      '<li class="my-1"><p>Third point</p></li>',
      '</ul>',
    ].join('');

    assert.equal(
      convertHtmlListsToMarkdown(html),
      '\n- First point\n- Second point\n- Third point\n\n',
    );
  });

  it('keeps adjacent same-type list blocks aligned as one visual list', () => {
    const html = [
      '<ol><li><p>First point</p></li></ol>',
      '<ol class="pl-6"><li><p>Second point</p></li><li><p>Third point</p></li></ol>',
    ].join('');

    assert.equal(
      convertHtmlListsToMarkdown(html),
      '\n1. First point\n2. Second point\n3. Third point\n\n',
    );
  });

  it('does not silently reparent an independent adjacent bullet list', () => {
    const markdown = convertHtmlListsToMarkdown('<ol><li>One</li></ol><ul><li>Separate</li></ul>');

    assert.equal(markdown, '\n1. One\n\n- Separate\n\n');
  });

  it('keeps a bullet list separate when a content block separates it from an ordered list', () => {
    const markdown = convertHtmlListsToMarkdown(
      '<ol><li>Parent</li></ol><p>Separate section</p><ul class="pl-6"><li>Sibling</li></ul>',
    );

    assert.doesNotMatch(markdown, /1\. Parent\n {3}- Sibling/);
    assert.match(markdown, /<p>Separate section<\/p>/);
    assert.match(markdown, /- Sibling/);
  });

  it('keeps line breaks and content spacing inside list items', () => {
    const markdown = convertHtmlListsToMarkdown(
      '<ul><li><p>Long first line<br />wrapped  second line</p></li></ul><p>After</p>',
    );

    assert.equal(markdown, '\n- Long first line\n  wrapped  second line\n\n<p>After</p>');
  });

  it('does not interpret HTML-looking Markdown code as a list', () => {
    const markdown = convertHtmlListsToMarkdown(
      '<ul><li>item</li></ul>\n\n```html\n<ul><li>literal</li></ul>\n```\n\n`<ul><li>inline</li></ul>`',
    );

    assert.match(markdown, /- item/);
    assert.match(markdown, /```html\n<ul><li>literal<\/li><\/ul>\n```/);
    assert.match(markdown, /`<ul><li>inline<\/li><\/ul>`$/);
    assert.doesNotMatch(markdown, /- literal|- inline/);
  });

  it('uses a fast path when the input has no list tags', () => {
    const html = '<p>Plain message</p><strong>without lists</strong>';
    assert.equal(convertHtmlListsToMarkdown(html), html);
  });
});
