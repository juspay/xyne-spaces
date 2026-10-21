import {
  convertParagraphsAndBreaksToMarkdown,
  normalizeChatMarkdownNewlines,
} from '@/src/utils/htmlParagraphsToMarkdown';
import { escapePlainTextMarkdownListMarkersInHtmlParagraphs } from '@/src/utils/escapePlainMarkdownListMarkers';
import { normalizeMessageHtmlForSend } from '@/src/utils/normalizeMessageHtml';
import { parseCustomEmojiFromImgAttrs } from '@/src/utils/customEmoji';
import {
  channelMentionLabelFromSpan,
  ensureSpacesBetweenMentionLinks,
  formatMentionMarkdownLink,
  groupMentionLabelFromSpan,
  userMentionLabelFromSpan,
} from '@/src/utils/mentionHtmlToMarkdown';
import { flowDefinitionToMarkdown, parseFlowJsonParts } from '@/src/utils/flowJsonMarkdown';
import { buildMarkdownCodeBlock } from '@/src/utils/markdownCodeFence';
/**
 * In-app mention targets (parsed in MessageContent onLinkPress). Re-exported
 * from the pure `mentionSchemes` module so parsers can depend on them without
 * pulling in this module's React Native transitive imports.
 */
export {
  MENTION_BROADCAST_SCHEME,
  MENTION_CHANNEL_SCHEME,
  MENTION_GROUP_SCHEME,
  MENTION_USER_SCHEME,
} from './mentionSchemes';

import {
  MENTION_BROADCAST_SCHEME,
  MENTION_CHANNEL_SCHEME,
  MENTION_GROUP_SCHEME,
  MENTION_USER_SCHEME,
} from './mentionSchemes';
import { decodeBasicEntities, stripHtmlTags } from '@/src/utils/htmlText';

/**
 * Sentinel placeholder for inline custom emoji `<img data-emoji-id="..." alt=":name:">`.
 * `htmlToMD` emits this so the catch-all tag stripper doesn't drop emojis on the floor.
 * Resolved at render time by `ConversationComposerMarkdownBody` (or
 * `replaceEmojiPlaceholders` for plain-markdown paths):
 *   - markdown image `![:name:](file://...)` when the emoji is cached on disk
 *   - opaque placeholder while still loading (never `:name:` text)
 *   - `:name:` shortcode text only when fetch failed
 *
 * Format: `xemoji:{emojiId}:{urlEncodedName}:emojix`. ASCII-only so it survives both
 * the htmlToMD transforms (no `<`/`>`) and any text-encoding hops, and distinctive
 * enough that it cannot collide with real message text.
 */
const EMOJI_PLACEHOLDER_OPEN = 'xemoji:';
const EMOJI_PLACEHOLDER_CLOSE = ':emojix';
export const EMOJI_PLACEHOLDER_PATTERN = /xemoji:([^:]+):([^:]*):emojix/g;

const buildEmojiPlaceholder = (emojiId: string, name: string): string =>
  `${EMOJI_PLACEHOLDER_OPEN}${emojiId}:${encodeURIComponent(name)}${EMOJI_PLACEHOLDER_CLOSE}`;

/** Pull every distinct emoji id referenced by placeholders in `md`. */
export const extractEmojiIds = (md: string): string[] => {
  if (!md) return [];
  const ids = new Set<string>();
  for (const match of md.matchAll(EMOJI_PLACEHOLDER_PATTERN)) {
    if (match[1]) ids.add(match[1]);
  }
  return Array.from(ids);
};

/**
 * Word-joiner prefix forces `react-native-enriched-markdown` down its inline-image
 * path. Both iOS and Android decide between `image` (block, full-width) and
 * `inlineImage` (square, `inlineImage.size`) by checking whether the rendered
 * output's last char is `\n` or `\u200B`. A standalone emoji message would render
 * with an empty buffer -> block image at intrinsic size. Prepending `\u2060`
 * (invisible, no-line-break, not in the excluded set) guarantees the inline
 * branch - so custom emojis stay 20x20 even when alone in their paragraph.
 */
const INLINE_IMAGE_GUARD = '\u2060';

/** Replace every emoji placeholder using the resolved uri map. */
export const replaceEmojiPlaceholders = (
  md: string,
  uriMap: Record<string, string | null | undefined>,
): string => {
  if (!md) return md;
  return md.replace(EMOJI_PLACEHOLDER_PATTERN, (_, emojiId: string, encodedName: string) => {
    let name: string;
    try {
      name = decodeURIComponent(encodedName);
    } catch {
      name = encodedName;
    }
    const uri = uriMap[emojiId];
    const safeName = name || emojiId;
    if (uri) return `${INLINE_IMAGE_GUARD}![:${safeName}:](${uri})`;
    if (uri === null) return `:${safeName}:`;
    return buildEmojiPlaceholder(emojiId, name);
  });
};

const INLINE_IMAGE_GUARD_PATTERN = /\u2060/g;

export const normalizeActivityPreviewMarkdown = (markdown: string): string => {
  if (!markdown) return '';

  return markdown
    .replace(INLINE_IMAGE_GUARD_PATTERN, '')
    .replace(/\r\n/g, '\n')
    .replace(/\n+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
};

export const normalizeActivityPreviewText = (markdown: string): string => {
  if (!markdown) return '';

  return markdown
    .replace(INLINE_IMAGE_GUARD_PATTERN, '')
    .replace(/\r\n/g, '\n')
    .replace(/```([\s\S]*?)```/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/^\s*>\s?/gm, '')
    .replace(/!\[([^\]]*)\]\([^)]+\)/g, '$1')
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '$1')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/__([^_]+)__/g, '$1')
    .replace(/~~([^~]+)~~/g, '$1')
    .replace(/\*([^*]+)\*/g, '$1')
    .replace(/_([^_]+)_/g, '$1')
    .replace(/\n+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
};

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
 *
 * Custom emoji `<img data-emoji-id="..." alt=":name:">` are preserved as opaque
 * `xemoji:id:name:emojix` placeholders. Use `replaceEmojiPlaceholders` (or the
 * `useResolvedEmojiMarkdown` hook) before handing the markdown to a renderer.
 */
type HtmlToMDResult = {
  markdown: string;
  hasSelfMention: boolean;
};

const htmlToMDInternal = (html: string, selfUserId?: string): HtmlToMDResult => {
  if (typeof html !== 'string' || html.trim() === '') {
    return { markdown: '', hasSelfMention: false };
  }
  // Flow-JSON blocks must be removed before the generic tag-stripper sees their
  // attribute value, because that value contains the message's raw <mention>
  // tokens. Keep any surrounding HTML in its original order so mixed messages
  // do not lose their non-Flow content.
  const flowParts = parseFlowJsonParts(html);
  if (flowParts.some(part => part.type === 'flow')) {
    const convertedParts = flowParts.map(part =>
      part.type === 'flow'
        ? { markdown: flowDefinitionToMarkdown(part.definition), hasSelfMention: false }
        : htmlToMDInternal(part.html, selfUserId),
    );
    return {
      markdown: convertedParts
        .map(part => part.markdown)
        .filter(Boolean)
        .join('\n\n'),
      hasSelfMention: convertedParts.some(part => part.hasSelfMention),
    };
  }

  let md = normalizeMessageHtmlForSend(html);
  let hasSelfMention = false;

  // 1. Code blocks: <pre...><code class="language-xxx">...</code></pre>
  md = md.replace(
    /<pre[^>]*>\s*<code[^>]*class="[^"]*language-(\w+)[^"]*"[^>]*>([\s\S]*?)<\/code>\s*<\/pre>/gi,
    (_, lang: string, text: string) => buildMarkdownCodeBlock(text.trim(), lang),
  );

  // 2. Code blocks: <pre...><code>...</code></pre> (no language)
  md = md.replace(/<pre[^>]*>\s*<code[^>]*>([\s\S]*?)<\/code>\s*<\/pre>/gi, (_, text: string) =>
    buildMarkdownCodeBlock(text.trim()),
  );

  // 2.5. Native react-native-enriched code blocks: <codeblock>...</codeblock>
  md = md.replace(/<codeblock[^>]*>([\s\S]*?)<\/codeblock>/gi, (_, text: string) =>
    buildMarkdownCodeBlock(text.trim()),
  );

  // 3. Inline code: <code>...</code> (not inside pre - simple case)
  md = md.replace(/<code(?![^>]*language-)[^>]*>([\s\S]*?)<\/code>/gi, '`$1`');

  // 3.5. Custom emoji `<img>` — dashboard (`data-emoji-id`), API stream, or legacy
  //      native `file://…/emojis/{id}.gif` from broken optimistic sends.
  md = md.replace(/<img\b([^>]*)\/?>/gi, (_, attrs: string) => {
    const parsed = parseCustomEmojiFromImgAttrs(attrs);
    if (!parsed) return '';
    return buildEmojiPlaceholder(parsed.emojiId, parsed.name);
  });

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

  // 5. Mentions — plain `[label](url)` via mentionHtmlToMarkdown; before bold/italic rules.
  md = md.replace(
    /<span([^>]*\bdata-channel-mention[^>]*)>([\s\S]*?)<\/span>/gi,
    (_, attrs: string, inner: string) => {
      const idMatch = /\bdata-channel-id=["']([^"']*)["']/.exec(attrs);
      const channelId = idMatch?.[1] ?? '';
      const label = channelMentionLabelFromSpan(attrs, inner);
      if (!channelId) return label;
      return formatMentionMarkdownLink(
        label,
        `${MENTION_CHANNEL_SCHEME}${encodeURIComponent(channelId)}`,
      );
    },
  );

  md = md.replace(
    /<span([^>]*\bdata-user-id=["']([^"']*)["'][^>]*)>([\s\S]*?)<\/span>/gi,
    (_, attrs: string, userId: string, inner: string) => {
      if (selfUserId && userId === selfUserId) hasSelfMention = true;
      const label = userMentionLabelFromSpan(attrs, inner);
      if (!userId) return label;
      return formatMentionMarkdownLink(
        label,
        `${MENTION_USER_SCHEME}${encodeURIComponent(userId)}`,
      );
    },
  );

  md = md.replace(
    /<span([^>]*\bdata-mention-type=["']group["'][^>]*\bdata-group-id=["']([^"']*)["'][^>]*)>([\s\S]*?)<\/span>/gi,
    (_, attrs: string, groupId: string, inner: string) => {
      const label = groupMentionLabelFromSpan(attrs, inner);
      if (!groupId) return label;
      return formatMentionMarkdownLink(
        label,
        `${MENTION_GROUP_SCHEME}${encodeURIComponent(groupId)}`,
      );
    },
  );

  // Broadcast mentions (@channel, @here). Real channel mentions carry
  // `data-channel-mention` and were already consumed above; what's left with
  // `data-mention-type="channel"|"here"` is the dashboard's special-mention span.
  md = md.replace(
    /<span[^>]*\bdata-mention-type=["'](channel|here)["'][^>]*>[\s\S]*?<\/span>/gi,
    (match, type: string) => {
      if (/\bdata-channel-mention\b/.test(match) || /\bdata-channel-id=/.test(match)) {
        return match;
      }
      const label = `@${type}`;
      return formatMentionMarkdownLink(label, `${MENTION_BROADCAST_SCHEME}${type}`);
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
  md = md.replace(/<(?:strong|b)\b[^>]*>\s*([\s\S]*?)\s*<\/(?:strong|b)>/gi, '**$1**');

  // 8. Combined italic+underline: <em><u>...</u></em>
  md = md.replace(
    /<(?:em|i)\b[^>]*>\s*<u\b[^>]*>\s*([\s\S]*?)\s*<\/u>\s*<\/(?:em|i)>/gi,
    '*__$1__*',
  );

  // 9. Underline: <u> (requires md4cFlags.underline = true on EnrichedMarkdownText)
  md = md.replace(/<u\b[^>]*>\s*([\s\S]*?)\s*<\/u>/gi, '__$1__');

  // 10. Italic: <em>, <i> (covers <em class="italic"> from rawHtmlTransformer)
  md = md.replace(/<(?:em|i)\b[^>]*>\s*([\s\S]*?)\s*<\/(?:em|i)>/gi, '*$1*');

  // 11. Links: <a href="url">text</a>
  md = md.replace(/<a[^>]*href=["']([^"']*)["'][^>]*>([\s\S]*?)<\/a>/gi, '[$2]($1)');

  // 12. Escape paragraph text that only looks like a Markdown list. Real
  // <ul>/<ol> structure is converted below and remains a list.
  md = escapePlainTextMarkdownListMarkersInHtmlParagraphs(md);

  // 13. Lists → markdown (before <p> flattens <li> contents)
  md = convertHtmlListsToMarkdown(md);

  // 14–15. Paragraphs / line breaks — tight chat newlines (empty <p> = blank line).
  md = convertParagraphsAndBreaksToMarkdown(md);
  md = normalizeChatMarkdownNewlines(md);

  // 16. Strip remaining tags
  md = stripHtmlTags(md);

  // 17. Entities
  md = decodeBasicEntities(md);

  md = ensureSpacesBetweenMentionLinks(md);

  return { markdown: md.trim(), hasSelfMention };
};

export const htmlToMD = (html: string): string => htmlToMDInternal(html).markdown;

export const htmlToMDWithSelfMention = (html: string, selfUserId?: string): HtmlToMDResult =>
  htmlToMDInternal(html, selfUserId);
