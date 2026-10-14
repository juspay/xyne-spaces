import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { htmlToMD, extractEmojiIds, replaceEmojiPlaceholders } from '../model/text/htmlToMD';
import {
  buildEmojiPlaceholder,
  ensureSpacesBetweenMentionLinks,
  htmlInlineToMarkdown,
} from '../model/text/htmlInlineToMarkdown';
import {
  MENTION_BROADCAST_SCHEME,
  MENTION_CHANNEL_SCHEME,
  MENTION_GROUP_SCHEME,
  MENTION_USER_SCHEME,
} from '../model/text/mentionSchemes';

/**
 * Characterisation tests locking v3 htmlToMD to v2's rich-HTML → markdown
 * behaviour. Regression guard for the production bug where the v3 stub stripped
 * every tag, so mentions rendered as plain text, custom emoji leaked raw
 * `custom:id:name` tokens, and bold/italic/code/lists lost all styling.
 */
describe('htmlToMD passthrough', () => {
  it('returns plain text unchanged when there are no tags', () => {
    assert.equal(htmlToMD('just plain text'), 'just plain text');
  });

  it('returns empty for empty input', () => {
    assert.equal(htmlToMD(''), '');
  });
});

describe('htmlToMD custom emoji', () => {
  it('converts a dashboard emoji <img> (data-emoji-id) to an xemoji placeholder', () => {
    const html =
      '<p>hi <img src="/api/emojis/cmrc367rq2jlnfvjnwoflxmu1/stream" alt=":claude_logo:" data-emoji-id="cmrc367rq2jlnfvjnwoflxmu1" class="inline-emoji"></p>';
    const md = htmlToMD(html);
    assert.match(md, /xemoji:cmrc367rq2jlnfvjnwoflxmu1:claude_logo:emojix/);
    assert.deepEqual(extractEmojiIds(md), ['cmrc367rq2jlnfvjnwoflxmu1']);
  });

  it('converts an /api/emojis/{id}/stream <img> without data-emoji-id', () => {
    const html = '<img src="/api/emojis/abc123def456/stream" alt=":party:">';
    assert.match(htmlToMD(html), /xemoji:abc123def456:party:emojix/);
  });

  it('converts a native file:// emoji <img>', () => {
    const html = '<img src="file:///var/emojis/xyz987wvu654.gif" alt=":tada:">';
    assert.match(htmlToMD(html), /xemoji:xyz987wvu654:tada:emojix/);
  });

  it('rescues a leaked composer custom:{id}:{name} shortcode in body text', () => {
    const md = htmlToMD('<p>look custom:cmrc367rq2jlnfvjnwoflxmu1:claude_logo done</p>');
    assert.match(md, /xemoji:cmrc367rq2jlnfvjnwoflxmu1:claude_logo:emojix/);
    assert.doesNotMatch(md, /custom:cmrc/);
  });

  it('resolves Flow placeholders without breaking surrounding markdown', () => {
    const markdown = '**Ship** xemoji:e1:rocket:emojix [docs](https://x.dev)';
    assert.equal(
      replaceEmojiPlaceholders(markdown, { e1: 'file:///tmp/e1.png' }),
      '**Ship** \u2060![:rocket](file:///tmp/e1.png) [docs](https://x.dev)',
    );
  });

  it('uses a readable shortcode when the authenticated preview is unavailable', () => {
    assert.equal(replaceEmojiPlaceholders('xemoji:e1:rocket:emojix', { e1: null }), ':rocket:');
    assert.equal(replaceEmojiPlaceholders('xemoji:e1:rocket:emojix', {}), ':rocket:');
  });
});

describe('htmlToMD mentions', () => {
  it('converts a user mention span to a xyne://user link', () => {
    const html = '<span data-user-id="u_123" data-username="Vinit">@Vinit</span>';
    assert.equal(htmlToMD(html), `[@Vinit](${MENTION_USER_SCHEME}u_123)`);
  });

  it('converts a channel mention span to a xyne://channel link', () => {
    const html =
      '<span data-channel-mention data-channel-id="c_9" data-channel-name="general">#general</span>';
    assert.equal(htmlToMD(html), `[#general](${MENTION_CHANNEL_SCHEME}c_9)`);
  });

  it('converts a group mention span to a xyne://group link', () => {
    const html =
      '<span data-mention-type="group" data-group-id="g_5" data-group-name="Eng">@Eng</span>';
    assert.equal(htmlToMD(html), `[@Eng](${MENTION_GROUP_SCHEME}g_5)`);
  });

  it('converts a broadcast mention (@here) to a xyne://broadcast link', () => {
    const html = '<span data-mention-type="here">@here</span>';
    assert.equal(htmlToMD(html), `[@here](${MENTION_BROADCAST_SCHEME}here)`);
  });

  it('inserts a space between back-to-back mention links', () => {
    const html =
      '<span data-user-id="a" data-username="A">@A</span><span data-user-id="b" data-username="B">@B</span>';
    assert.equal(htmlToMD(html), `[@A](${MENTION_USER_SCHEME}a) [@B](${MENTION_USER_SCHEME}b)`);
  });
});

describe('htmlToMD inline formatting', () => {
  it('converts bold', () => {
    assert.equal(htmlToMD('<strong>bold</strong>'), '**bold**');
    assert.equal(htmlToMD('<b>bold</b>'), '**bold**');
  });

  it('converts italic', () => {
    assert.equal(htmlToMD('<em>it</em>'), '*it*');
    assert.equal(htmlToMD('<i>it</i>'), '*it*');
  });

  it('converts underline and strikethrough', () => {
    assert.equal(htmlToMD('<u>u</u>'), '__u__');
    assert.equal(htmlToMD('<s>x</s>'), '~~x~~');
    assert.equal(htmlToMD('<del>x</del>'), '~~x~~');
  });

  it('converts inline code', () => {
    assert.equal(htmlToMD('<code>x = 1</code>'), '`x = 1`');
  });

  it('converts a fenced code block with language', () => {
    const md = htmlToMD('<pre><code class="language-ts">const a = 1;</code></pre>');
    assert.match(md, /```ts\nconst a = 1;\n```/);
  });

  it('converts a link', () => {
    assert.equal(htmlToMD('<a href="https://x.dev">site</a>'), '[site](https://x.dev)');
  });

  it('converts a blockquote', () => {
    assert.equal(htmlToMD('<blockquote>quoted</blockquote>'), '> quoted');
  });
});

describe('htmlToMD lists', () => {
  it('converts an unordered list to markdown bullets', () => {
    const md = htmlToMD('<ul><li>one</li><li>two</li></ul>');
    assert.match(md, /- one/);
    assert.match(md, /- two/);
  });
});

describe('htmlToMD mixed content', () => {
  it('keeps mention, emoji and bold together', () => {
    const html =
      '<p><span data-user-id="u1" data-username="Ann">@Ann</span> <strong>ship</strong> <img data-emoji-id="e1" alt=":rocket:"></p>';
    const md = htmlToMD(html);
    assert.match(md, new RegExp(`\\[@Ann\\]\\(${MENTION_USER_SCHEME}u1\\)`));
    assert.match(md, /\*\*ship\*\*/);
    assert.match(md, /xemoji:e1:rocket:emojix/);
  });
});

describe('htmlInlineToMarkdown exports', (): void => {
  it('builds a round-trippable emoji placeholder', (): void => {
    assert.equal(buildEmojiPlaceholder('e1', 'wave'), 'xemoji:e1:wave:emojix');
  });

  it('converts inline tags without waiting for the outer htmlToMD pass', (): void => {
    assert.match(htmlInlineToMarkdown('<strong>hi</strong>'), /\*\*hi\*\*/);
  });

  it('inserts a space between adjacent mention links', (): void => {
    const a = `[@Ann](${MENTION_USER_SCHEME}u1)`;
    const b = `[@Bob](${MENTION_USER_SCHEME}u2)`;
    assert.equal(ensureSpacesBetweenMentionLinks(`${a}${b}`), `${a} ${b}`);
  });
});
