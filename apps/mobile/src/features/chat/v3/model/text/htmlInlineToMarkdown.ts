/**
 * §8.1 reuse gate: **Adopt (copy)**. Pure port of v2 htmlToMD's inline
 * conversions. v2's module is entangled with Expo (`customEmoji` → `config` →
 * `expo-constants`), so the pure helpers are copied here to keep the v3 model
 * layer hermetic (no React, no react-native, no `@/src/config`). Characterised
 * against v2 in htmlInlineToMarkdown.test.ts.
 *
 * Converts the inline rich-HTML that message bodies actually carry — custom
 * emoji `<img>`, mention spans, code, bold/italic/underline/strikethrough,
 * links, blockquotes — into markdown BEFORE the generic tag-stripper runs.
 * Emoji become opaque `xemoji:{id}:{name}:emojix` placeholders resolved at
 * render time by `CustomEmoji` / `useMtlsEmoji`.
 */
import {
  MENTION_BROADCAST_SCHEME,
  MENTION_CHANNEL_SCHEME,
  MENTION_GROUP_SCHEME,
  MENTION_USER_SCHEME,
} from './mentionSchemes';
import { decodeBasicEntities, stripHtmlTags } from '@/src/utils/htmlText';

const EMOJI_PLACEHOLDER_OPEN = 'xemoji:';
const EMOJI_PLACEHOLDER_CLOSE = ':emojix';

export const buildEmojiPlaceholder = (emojiId: string, name: string): string =>
  `${EMOJI_PLACEHOLDER_OPEN}${emojiId}:${encodeURIComponent(name)}${EMOJI_PLACEHOLDER_CLOSE}`;

function parseSpanAttrs(attrStr: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  const pairRegex = /(\w+(?:-\w+)*)\s*=\s*["']([^"']*)["']/g;
  let match: RegExpExecArray | null;
  while ((match = pairRegex.exec(attrStr)) !== null) {
    attrs[match[1] ?? ''] = match[2] ?? '';
  }
  return attrs;
}

function spanInnerToPlainText(inner: string): string {
  return decodeBasicEntities(stripHtmlTags(inner)).trim();
}

function escapeMarkdownLinkLabel(s: string): string {
  return s.replace(/[\\\]]/g, '\\$&').replace(/`/g, '');
}

function withMentionPrefix(label: string, prefix: '@' | '#'): string {
  const trimmed = label.trim();
  if (!trimmed) return prefix;
  return trimmed.startsWith(prefix) ? trimmed : `${prefix}${trimmed}`;
}

function pickLongerName(attrName: string, innerName: string): string {
  const a = attrName.trim();
  const i = innerName.trim();
  if (!a) return i;
  if (!i) return a;
  return a.length >= i.length ? a : i;
}

function formatMentionMarkdownLink(label: string, url: string): string {
  return `[${escapeMarkdownLinkLabel(label)}](${url})`;
}

function userMentionLabelFromSpan(attrs: string, inner: string): string {
  const parsed = parseSpanAttrs(attrs);
  const fromAttr = decodeBasicEntities(parsed['data-username'] ?? '');
  const fromInner = spanInnerToPlainText(inner).replace(/^@/, '');
  return withMentionPrefix(pickLongerName(fromAttr, fromInner), '@');
}

function channelMentionLabelFromSpan(attrs: string, inner: string): string {
  const parsed = parseSpanAttrs(attrs);
  const fromAttr = decodeBasicEntities(parsed['data-channel-name'] ?? '');
  const fromInner = spanInnerToPlainText(inner).replace(/^#/, '');
  return withMentionPrefix(pickLongerName(fromAttr, fromInner), '#');
}

function groupMentionLabelFromSpan(attrs: string, inner: string): string {
  const parsed = parseSpanAttrs(attrs);
  const alias = decodeBasicEntities(parsed['data-group-alias'] ?? '');
  const name = decodeBasicEntities(parsed['data-group-name'] ?? '');
  const fromAttr = alias || name;
  const fromInner = spanInnerToPlainText(inner).replace(/^@/, '');
  return withMentionPrefix(pickLongerName(fromAttr, fromInner), '@');
}

/** EnrichedMarkdownText draws adjacent `[mention](xyne://…)` links flush; add a space. */
const NEXT_MENTION_LINK = '(?=\\[[^\\]]*\\]\\(xyne:\\/\\/)';
export function ensureSpacesBetweenMentionLinks(markdown: string): string {
  if (!markdown) return markdown;
  return markdown
    .replace(new RegExp(`\\)${NEXT_MENTION_LINK}`, 'g'), ') ')
    .replace(new RegExp(`,${NEXT_MENTION_LINK}`, 'g'), ', ');
}

function longestMarkerRun(value: string, marker: '`' | '~'): number {
  let longest = 0;
  let current = 0;
  for (const char of value) {
    if (char === marker) {
      current += 1;
      longest = Math.max(longest, current);
    } else {
      current = 0;
    }
  }
  return longest;
}

function buildMarkdownCodeBlock(innerText: string, language = ''): string {
  const backtickLength = Math.max(3, longestMarkerRun(innerText, '`') + 1);
  const tildeLength = Math.max(3, longestMarkerRun(innerText, '~') + 1);
  const marker = backtickLength <= tildeLength ? '`' : '~';
  const fence = marker.repeat(marker === '`' ? backtickLength : tildeLength);
  return `\n\n${fence}${language.trim()}\n${innerText}\n${fence}\n\n`;
}

/** Parse dashboard (`data-emoji-id`), API-stream, or native `file://` emoji `<img>` attrs. */
function parseCustomEmojiFromImgAttrs(attrs: string): { emojiId: string; name: string } | null {
  const idMatch = /\bdata-emoji-id=["']([^"']+)["']/.exec(attrs);
  if (idMatch?.[1]) {
    const altMatch = /\balt=["']([^"']*)["']/.exec(attrs);
    const name = (altMatch?.[1] ?? '').replace(/^:|:$/g, '') || idMatch[1];
    return { emojiId: idMatch[1], name };
  }
  const fileSrcMatch = /\bsrc=["']file:\/\/[^"']*\/emojis\/([^/.]+)\.[^"']+["']/.exec(attrs);
  if (fileSrcMatch?.[1]) {
    const emojiId = fileSrcMatch[1];
    const altMatch = /\balt=["']([^"']*)["']/.exec(attrs);
    const name = (altMatch?.[1] ?? '').replace(/^:|:$/g, '') || emojiId;
    return { emojiId, name };
  }
  const apiSrcMatch = /\bsrc=["']\/api\/emojis\/([^/"']+)\/stream["']/.exec(attrs);
  if (apiSrcMatch?.[1]) {
    const emojiId = apiSrcMatch[1];
    const altMatch = /\balt=["']([^"']*)["']/.exec(attrs);
    const name = (altMatch?.[1] ?? '').replace(/^:|:$/g, '') || emojiId;
    return { emojiId, name };
  }
  return null;
}

/** Custom-emoji shortcode `custom:{id}:{name}` (composer token) that leaked into body text. */
const CUSTOM_EMOJI_SHORTCODE = /custom:([A-Za-z0-9_-]{8,}):([A-Za-z0-9_+-]{1,80})/g;

function codeBlockInnerToText(innerHtml: string): string {
  return decodeBasicEntities(
    stripHtmlTags(
      innerHtml
        .replace(/<br\s*\/?>/gi, '\n')
        .replace(/<\/p>\s*<p[^>]*>/gi, '\n')
        .replace(/<p[^>]*>/gi, '')
        .replace(/<\/p>/gi, '\n'),
    ),
  ).trim();
}

function inlineCodeHtmlToText(innerHtml: string): string {
  return decodeBasicEntities(stripHtmlTags(innerHtml.replace(/<br\s*\/?>/gi, '\n')));
}

/**
 * Convert every inline rich-HTML construct into markdown. Ordering mirrors v2's
 * htmlToMDInternal so back-to-back constructs (e.g. a mention inside bold)
 * resolve identically. Lists, paragraph flattening and the catch-all tag strip
 * stay in the caller (`htmlToMD`).
 */
export function htmlInlineToMarkdown(html: string): string {
  if (typeof html !== 'string' || html.trim() === '') return '';
  let md = html;

  // Blockquotes first — before the tag stripper removes the only quoted signal.
  md = md.replace(/<blockquote\b[^>]*>([\s\S]*?)<\/blockquote>/gi, (_, inner: string) => {
    const quoted = stripHtmlTags(inner.replace(/<br\s*\/?>/gi, '\n').replace(/<\/p>/gi, '\n'))
      .split('\n')
      .map(line => line.trim())
      .filter(line => line.length > 0)
      .map(line => `> ${decodeBasicEntities(line)}`)
      .join('\n');
    return quoted ? `\n${quoted}\n\n` : '';
  });

  // Code blocks (with / without language, plus native <codeblock>).
  md = md.replace(
    /<pre[^>]*>\s*<code[^>]*class="[^"]*language-(\w+)[^"]*"[^>]*>([\s\S]*?)<\/code>\s*<\/pre>/gi,
    (_, lang: string, text: string) => buildMarkdownCodeBlock(codeBlockInnerToText(text), lang),
  );
  md = md.replace(/<pre[^>]*>\s*<code[^>]*>([\s\S]*?)<\/code>\s*<\/pre>/gi, (_, text: string) =>
    buildMarkdownCodeBlock(codeBlockInnerToText(text)),
  );
  md = md.replace(/<codeblock[^>]*>([\s\S]*?)<\/codeblock>/gi, (_, text: string) =>
    buildMarkdownCodeBlock(codeBlockInnerToText(text)),
  );

  // Inline code (not the language block variant).
  md = md.replace(
    /<code(?![^>]*language-)[^>]*>([\s\S]*?)<\/code>/gi,
    (_, text: string) => `\`${inlineCodeHtmlToText(text)}\``,
  );

  // Custom emoji <img> → opaque placeholder.
  md = md.replace(/<img\b([^>]*)\/?>/gi, (_, attrs: string) => {
    const parsed = parseCustomEmojiFromImgAttrs(attrs);
    return parsed ? buildEmojiPlaceholder(parsed.emojiId, parsed.name) : '';
  });

  // Strikethrough.
  md = md.replace(/<(?:s|del|strike)\b[^>]*>\s*([\s\S]*?)\s*<\/(?:s|del|strike)>/gi, '~~$1~~');
  md = md.replace(
    /<span\b[^>]*\bstyle="[^"]*text-decoration:\s*line-through\b[^"]*"[^>]*>([\s\S]*?)<\/span>/gi,
    '~~$1~~',
  );

  // Mentions → [label](scheme+id). Channel, then user, then group, then broadcast.
  md = md.replace(
    /<span([^>]*\bdata-channel-mention[^>]*)>([\s\S]*?)<\/span>/gi,
    (_, attrs: string, inner: string) => {
      const channelId = /\bdata-channel-id=["']([^"']*)["']/.exec(attrs)?.[1] ?? '';
      const label = channelMentionLabelFromSpan(attrs, inner);
      return channelId
        ? formatMentionMarkdownLink(
            label,
            `${MENTION_CHANNEL_SCHEME}${encodeURIComponent(channelId)}`,
          )
        : label;
    },
  );
  md = md.replace(
    /<span([^>]*\bdata-user-id=["']([^"']*)["'][^>]*)>([\s\S]*?)<\/span>/gi,
    (_, attrs: string, userId: string, inner: string) => {
      const label = userMentionLabelFromSpan(attrs, inner);
      return userId
        ? formatMentionMarkdownLink(label, `${MENTION_USER_SCHEME}${encodeURIComponent(userId)}`)
        : label;
    },
  );
  md = md.replace(
    /<span([^>]*\bdata-mention-type=["']group["'][^>]*\bdata-group-id=["']([^"']*)["'][^>]*)>([\s\S]*?)<\/span>/gi,
    (_, attrs: string, groupId: string, inner: string) => {
      const label = groupMentionLabelFromSpan(attrs, inner);
      return groupId
        ? formatMentionMarkdownLink(label, `${MENTION_GROUP_SCHEME}${encodeURIComponent(groupId)}`)
        : label;
    },
  );
  md = md.replace(
    /<(span|mention)[^>]*\bdata-mention-type=["'](channel|here)["'][^>]*>[\s\S]*?<\/\1>/gi,
    (match, _tag: string, type: string) => {
      if (/\bdata-channel-mention\b/.test(match) || /\bdata-channel-id=/.test(match)) return match;
      return formatMentionMarkdownLink(`@${type}`, `${MENTION_BROADCAST_SCHEME}${type}`);
    },
  );

  // Class/style based inline formatting from TipTap / dashboard prose.
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

  // Bold, italic+underline combo, underline, italic, links.
  md = md.replace(/<(?:strong|b)\b[^>]*>\s*([\s\S]*?)\s*<\/(?:strong|b)>/gi, '**$1**');
  md = md.replace(
    /<(?:em|i)\b[^>]*>\s*<u\b[^>]*>\s*([\s\S]*?)\s*<\/u>\s*<\/(?:em|i)>/gi,
    '*__$1__*',
  );
  md = md.replace(/<u\b[^>]*>\s*([\s\S]*?)\s*<\/u>/gi, '__$1__');
  md = md.replace(/<(?:em|i)\b[^>]*>\s*([\s\S]*?)\s*<\/(?:em|i)>/gi, '*$1*');
  md = md.replace(/<a[^>]*href=["']([^"']*)["'][^>]*>([\s\S]*?)<\/a>/gi, '[$2]($1)');

  // Defensive: composer custom-emoji shortcode that leaked into body text.
  md = md.replace(CUSTOM_EMOJI_SHORTCODE, (_, id: string, name: string) =>
    buildEmojiPlaceholder(id, name),
  );

  return md;
}
