import {
  convertParagraphsAndBreaksToMarkdown,
  normalizeChatMarkdownNewlines,
} from '@/src/utils/htmlParagraphsToMarkdown';
import { normalizeMessageHtmlForSend } from '@/src/utils/normalizeMessageHtml';
import { decodeBasicEntities, stripHtmlTags } from '@/src/utils/htmlText';

/** In-app mention targets (parsed in MessageContent onLinkPress). */
export const MENTION_USER_SCHEME = 'xyne://user/';
export const MENTION_CHANNEL_SCHEME = 'xyne://channel/';
export const MENTION_GROUP_SCHEME = 'xyne://group/';

function escapeMarkdownLinkLabel(s: string): string {
  return s.replace(/[\\\]]/g, '\\$&');
}

/** Escape characters that would break * / ** / _ emphasis in markdown. */
function escapeMarkdownInlineChars(s: string): string {
  return s.replace(/\*/g, '\\*').replace(/_/g, '\\_');
}

function spanInnerToLabel(inner: string): string {
  const textOnly = stripHtmlTags(inner);
  return escapeMarkdownLinkLabel(decodeBasicEntities(textOnly).trim());
}

function ensureMentionPrefix(label: string): string {
  return label.startsWith('@') ? label : `@${label}`;
}

/**
 * Normalize inner HTML of `<li>` after inline HTML → MD steps:
 * dashboard shape is usually <p class="...">...</p>.
 */
function listItemInnerToMarkdownFragment(inner: string): string {
  let s = inner.trim();
  s = s.replace(/<p[^>]*>([\s\S]*?)<\/p>/gi, (_, c: string) => c.trim());
  s = s.replace(/<br\s*\/?>/gi, '\n');
  s = s.replace(/[ \t]*\n[ \t]*/g, ' ').trim();
  return s;
}

/**
 * Convert HTML lists to CommonMark list syntax so md4c / EnrichedMarkdownText render bullets/numbers.
 * Run before global `<p>` → newline conversion so list structure is preserved.
 */
function convertHtmlListsToMarkdown(html: string): string {
  let md = html;
  const maxPasses = 6;
  for (let pass = 0; pass < maxPasses; pass++) {
    const before = md;

    md = md.replace(/<ol\b[^>]*>([\s\S]*?)<\/ol>/gi, (_, inner: string) => {
      const items = Array.from(inner.matchAll(/<li\b[^>]*>([\s\S]*?)<\/li>/gi));
      if (items.length === 0) return '';
      const lines = items.map((m, i) => {
        const fragment = listItemInnerToMarkdownFragment(m[1] ?? '');
        return `${i + 1}. ${fragment}`;
      });
      return `\n${lines.join('\n')}\n\n`;
    });

    md = md.replace(/<ul\b[^>]*>([\s\S]*?)<\/ul>/gi, (_, inner: string) => {
      const items = Array.from(inner.matchAll(/<li\b[^>]*>([\s\S]*?)<\/li>/gi));
      if (items.length === 0) return '';
      const lines = items.map(m => {
        const fragment = listItemInnerToMarkdownFragment(m[1] ?? '');
        return `- ${fragment}`;
      });
      return `\n${lines.join('\n')}\n\n`;
    });

    if (md === before) break;
  }
  return md;
}

/**
 * Converts HTML (from react-native-enriched + rawHtmlTransformer / TipTap / web) to Markdown.
 * Uses regex only - no DOM - so it works in React Native.
 *
 * Underline uses `__text__` → requires `EnrichedMarkdownText` `md4cFlags.underline: true`.
 * Strikethrough uses `~~text~~` (md4c always enables MD_FLAG_STRIKETHROUGH).
 */
export const htmlToMD = (html: string): string => {
  if (typeof html !== 'string' || html.trim() === '') {
    return '';
  }

  let md = normalizeMessageHtmlForSend(html);

  // 1. Code blocks: <pre...><code class="language-xxx">...</code></pre>
  md = md.replace(
    /<pre[^>]*>\s*<code[^>]*class="[^"]*language-(\w+)[^"]*"[^>]*>([\s\S]*?)<\/code>\s*<\/pre>/gi,
    (_, lang, text) => `\n\n\`\`\`${lang}\n${text.trim()}\n\`\`\`\n\n`,
  );

  // 2. Code blocks: <pre...><code>...</code></pre> (no language)
  md = md.replace(
    /<pre[^>]*>\s*<code[^>]*>([\s\S]*?)<\/code>\s*<\/pre>/gi,
    (_, text) => `\n\n\`\`\`\n${text.trim()}\n\`\`\`\n\n`,
  );

  // 3. Inline code: <code>...</code> (not inside pre - simple case)
  md = md.replace(/<code(?![^>]*language-)[^>]*>([\s\S]*?)<\/code>/gi, '`$1`');

  // 4. Strikethrough — before generic spans are stripped (md4c: ~~text~~)
  md = md.replace(/<(?:s|del|strike)\b[^>]*>\s*([\s\S]*?)\s*<\/(?:s|del|strike)>/gi, '~~$1~~');
  md = md.replace(
    /<span\b[^>]*\bstyle="[^"]*text-decoration:\s*line-through\b[^"]*"[^>]*>([\s\S]*?)<\/span>/gi,
    '~~$1~~',
  );
  md = md.replace(
    /<span\b[^>]*\bclass="[^"]*\bline-through\b[^"]*"[^>]*>([\s\S]*?)<\/span>/gi,
    '~~$1~~',
  );

  // 5. Mentions — before bold/italic span rules so nested font-semibold inside mention HTML
  // is not turned into **…** and then escaped into invalid markdown.
  md = md.replace(
    /<span([^>]*\bdata-channel-mention[^>]*)>([\s\S]*?)<\/span>/gi,
    (_, attrs: string, inner: string) => {
      const idMatch = /\bdata-channel-id=["']([^"']*)["']/.exec(attrs);
      const channelId = idMatch?.[1] ?? '';
      const label = escapeMarkdownInlineChars(ensureMentionPrefix(spanInnerToLabel(inner)));
      if (!channelId) return label;
      return `[**${label}**](${MENTION_CHANNEL_SCHEME}${encodeURIComponent(channelId)})`;
    },
  );

  md = md.replace(
    /<span([^>]*\bdata-user-id=["']([^"']*)["'][^>]*)>([\s\S]*?)<\/span>/gi,
    (_, _attrs: string, userId: string, inner: string) => {
      const label = escapeMarkdownInlineChars(ensureMentionPrefix(spanInnerToLabel(inner)));
      if (!userId) return label;
      return `[**${label}**](${MENTION_USER_SCHEME}${encodeURIComponent(userId)})`;
    },
  );

  md = md.replace(
    /<span([^>]*\bdata-mention-type=["']group["'][^>]*\bdata-group-id=["']([^"']*)["'][^>]*)>([\s\S]*?)<\/span>/gi,
    (_, _attrs: string, groupId: string, inner: string) => {
      const label = escapeMarkdownInlineChars(ensureMentionPrefix(spanInnerToLabel(inner)));
      if (!groupId) return label;
      return `[**${label}**](${MENTION_GROUP_SCHEME}${encodeURIComponent(groupId)})`;
    },
  );

  // 6. Inline styles from TipTap / dashboard (class-based prose)
  md = md.replace(
    /<span\b[^>]*\bstyle="[^"]*font-style:\s*italic\b[^"]*"[^>]*>([\s\S]*?)<\/span>/gi,
    '*$1*',
  );
  md = md.replace(
    /<span\b[^>]*\bstyle="[^"]*font-weight:\s*(?:bold|[67]00)\b[^"]*"[^>]*>([\s\S]*?)<\/span>/gi,
    '**$1**',
  );
  md = md.replace(
    /<span\b[^>]*\bstyle="[^"]*text-decoration:\s*underline\b[^"]*"[^>]*>([\s\S]*?)<\/span>/gi,
    '__$1__',
  );
  md = md.replace(/<span\b[^>]*\bclass="[^"]*\bitalic\b[^"]*"[^>]*>([\s\S]*?)<\/span>/gi, '*$1*');
  md = md.replace(
    /<span\b[^>]*\bclass="[^"]*\bfont-semibold\b[^"]*"[^>]*>([\s\S]*?)<\/span>/gi,
    '**$1**',
  );
  md = md.replace(
    /<span\b[^>]*\bclass="[^"]*\bunderline\b[^"]*"[^>]*>([\s\S]*?)<\/span>/gi,
    '__$1__',
  );

  // 7. Bold: <strong>, <b>
  md = md.replace(/<(?:strong|b)[^>]*>\s*([\s\S]*?)\s*<\/(?:strong|b)>/gi, '**$1**');

  // 8. Combined italic+underline: <em><u>...</u></em>
  md = md.replace(/<(?:em|i)[^>]*>\s*<u[^>]*>\s*([\s\S]*?)\s*<\/u>\s*<\/(?:em|i)>/gi, '*__$1__*');

  // 9. Underline: <u> (requires md4cFlags.underline = true on EnrichedMarkdownText)
  md = md.replace(/<u[^>]*>\s*([\s\S]*?)\s*<\/u>/gi, '__$1__');

  // 10. Italic: <em>, <i> (covers <em class="italic"> from rawHtmlTransformer)
  md = md.replace(/<(?:em|i)[^>]*>\s*([\s\S]*?)\s*<\/(?:em|i)>/gi, '*$1*');

  // 11. Links: <a href="url">text</a>
  md = md.replace(/<a[^>]*href=["']([^"']*)["'][^>]*>([\s\S]*?)<\/a>/gi, '[$2]($1)');

  // 12. Lists → markdown (before <p> flattens <li> contents)
  md = convertHtmlListsToMarkdown(md);

  // 13–14. Paragraphs / line breaks — tight chat newlines (empty <p> = blank line).
  md = convertParagraphsAndBreaksToMarkdown(md);
  md = normalizeChatMarkdownNewlines(md);

  // 15. Strip remaining tags
  md = stripHtmlTags(md);

  // 16. Entities
  md = decodeBasicEntities(md);

  return md.trim();
};
