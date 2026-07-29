/**
 * Convert TipTap HTML to Slack mrkdwn format.
 *
 * Uses `node-html-markdown` with Slack-specific options and a custom
 * translator for TipTap @mention spans → Slack `<@U123>` format.
 */

import { NodeHtmlMarkdown } from 'node-html-markdown';
import type { TranslatorConfigObject } from 'node-html-markdown';
import type { HTMLElement as NHPElement } from 'node-html-parser';

const slackTranslators: TranslatorConfigObject = {
  /* Slack links: <url|text> instead of [text](url) */
  a: ({ node: _node }) => {
    const node = _node as NHPElement;
    const href = node.getAttribute('href');
    if (!href) return {};

    return {
      postprocess: ({ content }) => {
        const text = content.replace(/(?:\r?\n)+/g, ' ');
        if (text && text !== href) return `<${href}|${text}>`;
        return `<${href}>`;
      },
    };
  },

  /* Slack has no headings — render as bold */
  'h1,h2,h3,h4,h5,h6': {
    postprocess: ({ content }) => (content.trim() ? `*${content.trim()}*` : ''),
  },

  /* TipTap mention spans → Slack mention format */
  span: ({ node: _node }) => {
    const node = _node as NHPElement;
    if (node.hasAttribute('data-mention')) {
      const userId = node.getAttribute('data-user-id');
      if (userId) return { content: `<@${userId}>`, recurse: false };

      const mentionType = node.getAttribute('data-mention-type');
      if (mentionType === 'channel' || mentionType === 'here') {
        return { content: `<!${mentionType}>`, recurse: false };
      }
    }
    return {};
  },
};

const nhm = new NodeHtmlMarkdown(
  {
    strongDelimiter: '*',
    strikeDelimiter: '~',
    bulletMarker: '•',
    globalEscape: [/(?!)/g, ''],      // no-op — disable markdown escaping for Slack
    lineStartEscape: [/(?!)/g, ''],
  },
  slackTranslators,
);

export function htmlToSlackMrkdwn(html: string): string {
  return nhm
    .translate(html)
    .replace(/\u200B/g, '') // strip TipTap zero-width space cursor guards
    .trim();
}
