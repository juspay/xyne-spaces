/**
 * Converts HTML stored for messages (dashboard / TipTap shape from `rawHtmlTransformer`)
 * back into markup `react-native-enriched`'s `EnrichedTextInput.setValue` can parse.
 *
 * Inverse of the relevant steps in `rawHtmlTransformer.ts`.
 */
import type { HtmlTransformer } from './rawHtmlTransformer';
import {
  formatMentionDisplay,
  normalizeInterMentionWhitespaceForEdit,
  normalizeMentionName,
  resolveChannelMentionName,
  resolveGroupMentionName,
  resolveUserMentionName,
} from './mentionLabelUtils';
import { parseCustomEmojiFromImgAttrs } from './customEmoji';
import { stripHtmlTags } from './htmlText';

function parseAttrs(attrString: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  const pairRegex = /(\w+(?:-\w+)*)\s*=\s*["']([^"']*)["']/g;
  let m: RegExpExecArray | null;
  while ((m = pairRegex.exec(attrString)) !== null) {
    attrs[m[1] ?? ''] = m[2] ?? '';
  }
  return attrs;
}

function escapeAttr(s: string): string {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function customEmojiImgToPlainText(attrs: string): string {
  const parsed = parseCustomEmojiFromImgAttrs(attrs);
  if (parsed) return `:${decodeBasicEntities(parsed.name)}:`;

  const altMatch = /\balt=["']([^"']*)["']/.exec(attrs);
  return decodeBasicEntities(altMatch?.[1] ?? '');
}

function codeTextToNativeCodeblock(innerHtml: string): string {
  const normalized = stripHtmlTags(
    innerHtml
      .replace(/\r\n?/g, '\n')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/p>\s*<p[^>]*>/gi, '\n')
      .replace(/<p[^>]*>/gi, '')
      .replace(/<\/p>/gi, '\n'),
  ).replace(/^\n+|\n+$/g, '');

  const paragraphs = normalized
    .split('\n')
    .map(line => `<p>${line.length > 0 ? line : '<br>'}</p>`)
    .join('');

  return `<codeblock>${paragraphs || '<p><br></p>'}</codeblock>`;
}

/** Undo span inner text escaping from `mentionToDashboardSpan`. */
function decodeBasicEntities(s: string): string {
  return s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&');
}

/**
 * Build `<mention>` markup in the shape `react-native-enriched` emits via setMention /
 * onChangeHtml: `text` first, then `indicator`, inner text matches the visible label.
 */
function formatNativeMentionTag(
  indicator: string,
  text: string,
  extraAttrs: Record<string, string>,
  innerText: string,
): string {
  const parts = [
    `text="${escapeAttr(text)}"`,
    `indicator="${escapeAttr(indicator)}"`,
    ...Object.entries(extraAttrs).map(([key, value]) => `${key}="${escapeAttr(value)}"`),
  ];
  return `<mention ${parts.join(' ')}>${innerText}</mention>`;
}

/** Channel dashboard spans → enriched `<mention>` tags. */
const dashboardChannelSpanToMention: HtmlTransformer = html => {
  const re = /<span\s+([^>]*\bdata-channel-mention\b[^>]*)>([\s\S]*?)<\/span>/gi;
  return html.replace(re, (_, attrStr: string, inner: string) => {
    const attrs = parseAttrs(attrStr);
    const channelId = attrs['data-channel-id'] ?? '';
    const attrChannelName = attrs['data-channel-name'] ?? '';
    const isPrivate = attrs['data-is-private'] ?? 'false';
    const innerDecoded = decodeBasicEntities(inner);
    const channelName = resolveChannelMentionName(attrChannelName, innerDecoded);
    const mentionText = formatMentionDisplay(channelName, '#');

    return formatNativeMentionTag(
      '#',
      mentionText,
      {
        'data-channel-id': channelId,
        'data-channel-name': channelName,
        'data-is-private': isPrivate,
      },
      mentionText,
    );
  });
};

/** User dashboard spans → enriched `<mention>` tags. */
const dashboardUserSpanToMention: HtmlTransformer = html => {
  const re = /<span\s+([^>]*\bclass\s*=\s*["']chat-input-mention["'][^>]*)>([\s\S]*?)<\/span>/gi;
  return html.replace(re, (_, attrStr: string, inner: string) => {
    const attrs = parseAttrs(attrStr);
    const userId = attrs['data-user-id'] ?? '';
    const userEmail = attrs['data-user-email'] ?? '';
    const userPicture = attrs['data-user-picture'] ?? '';
    const innerDecoded = decodeBasicEntities(inner);
    const username = resolveUserMentionName(attrs['data-username'] ?? '', innerDecoded);
    const mentionText = formatMentionDisplay(username, '@');

    const extraAttrs: Record<string, string> = {
      'data-mention-type': 'user',
      'data-user-id': userId,
      'data-username': username,
    };
    if (userEmail) extraAttrs['data-user-email'] = userEmail;
    if (userPicture) extraAttrs['data-user-picture'] = userPicture;

    return formatNativeMentionTag('@', mentionText, extraAttrs, mentionText);
  });
};

/** Group dashboard spans → enriched `<mention>` tags. */
const dashboardGroupSpanToMention: HtmlTransformer = html => {
  const re =
    /<span\s+([^>]*\bclass\s*=\s*["'][^"']*chat-input-group-mention[^"']*["'][^>]*)>([\s\S]*?)<\/span>/gi;
  return html.replace(re, (_, attrStr: string, inner: string) => {
    const attrs = parseAttrs(attrStr);
    const groupId = attrs['data-group-id'] ?? '';
    const groupName = attrs['data-group-name'] ?? '';
    const groupAlias = attrs['data-group-alias'] ?? '';
    const description = attrs['data-description'] ?? '';
    const memberCount = attrs['data-member-count'] ?? '0';
    const innerDecoded = decodeBasicEntities(inner);
    const displayName = resolveGroupMentionName(groupAlias, groupName, innerDecoded);
    const mentionText = formatMentionDisplay(displayName, '@');

    return formatNativeMentionTag(
      '@',
      mentionText,
      {
        'data-mention-type': 'group',
        'data-group-id': groupId,
        'data-group-name': normalizeMentionName(groupName, '@'),
        'data-group-alias': normalizeMentionName(groupAlias, '@'),
        'data-description': description,
        'data-member-count': memberCount,
      },
      mentionText,
    );
  });
};

/** Special dashboard spans (@channel/@here) → enriched `<mention>` tags. */
const dashboardSpecialSpanToMention: HtmlTransformer = html => {
  const re =
    /<span\s+([^>]*\bclass\s*=\s*["'][^"']*chat-input-special-mention[^"']*["'][^>]*)>([\s\S]*?)<\/span>/gi;
  return html.replace(re, (_, attrStr: string, inner: string) => {
    const attrs = parseAttrs(attrStr);
    const mentionType = attrs['data-mention-type'] ?? '';
    const innerDecoded = decodeBasicEntities(inner);
    const cleaned = normalizeMentionName(innerDecoded.trim() || mentionType, '@');
    const special = mentionType || cleaned;
    if (special !== 'channel' && special !== 'here') return inner;
    const mentionText = formatMentionDisplay(special, '@');

    return formatNativeMentionTag('@', mentionText, { 'data-mention-type': special }, mentionText);
  });
};

/** Undo `normalizeListItem`: `<li …><p …>…</p></li>` → `<li>…</li>`. */
const unwrapDashboardListItems: HtmlTransformer = html => {
  return html.replace(
    /<\s*li(?:\s[^>]*)?>\s*<\s*p(?:\s[^>]*)?>([\s\S]*?)<\s*\/\s*p\s*>\s*<\s*\/\s*li\s*>/gi,
    '<li>$1</li>',
  );
};

const stripLiUlOlOpeningAttrs: HtmlTransformer = html => {
  return html
    .replace(/<\s*li(?:\s[^>]*)?>/gi, '<li>')
    .replace(/<\s*ul(?:\s[^>]*)?>/gi, '<ul>')
    .replace(/<\s*ol(?:\s[^>]*)?>/gi, '<ol>');
};

/** Undo `linksToDashboard`: keep href only for enriched input. */
const simplifyDashboardLinks: HtmlTransformer = html => {
  return html.replace(/<\s*a\s+([^>]*)>([\s\S]*?)<\s*\/\s*a\s*>/gi, (_, attrStr, inner) => {
    const attrs = parseAttrs(attrStr);
    const href = attrs['href'] ?? '';
    return `<a href="${escapeAttr(href)}">${inner}</a>`;
  });
};

/** Dashboard/server code blocks → native enriched `<codeblock>` tags. */
const dashboardPreCodeToCodeblock: HtmlTransformer = html => {
  return html
    .replace(
      /<pre\b[^>]*>\s*<code\b[^>]*>([\s\S]*?)<\/code>\s*<\/pre>/gi,
      (_match, inner: string) => codeTextToNativeCodeblock(inner),
    )
    .replace(/<pre\b[^>]*>([\s\S]*?)<\/pre>/gi, (_match, inner: string) =>
      codeTextToNativeCodeblock(inner),
    );
};

/** Undo `boldToStrong` / `italicToEm` wrappers to native enriched tags. */
const simplifyStrongEm: HtmlTransformer = html => {
  return html
    .replace(/<\s*strong(?:\s[^>]*)?>/gi, '<b>')
    .replace(/<\s*\/\s*strong\s*>/gi, '</b>')
    .replace(/<\s*em(?:\s[^>]*)?>/gi, '<i>')
    .replace(/<\s*\/\s*em\s*>/gi, '</i>');
};

/** Remove TipTap / dashboard classes so native HTML parser accepts tags. */
const stripAllClassAttributes: HtmlTransformer = html => {
  return html.replace(/\s+class="[^"]*"/gi, '');
};

/**
 * Android's enriched parser collapses an empty `<p></p>` into the preceding
 * paragraph boundary. Give stored blank paragraphs an explicit break while
 * they are inside the composer; send normalization converts them back.
 */
const preserveEmptyParagraphsForComposer: HtmlTransformer = html =>
  html.replace(/<p\b([^>]*)>\s*(?:&nbsp;|&#160;|\u00a0|\u200b|\ufeff)*\s*<\/p>/gi, '<p$1><br></p>');

const ensureTrailingSpaceAfterMentionsForEdit: HtmlTransformer = html => {
  if (!html) return html;
  return html.replace(/<\/mention>(?!(?:\s|&nbsp;))/gi, '</mention> ');
};

/**
 * Keep adjacent mentions separated by a non-breaking space when loading into the
 * composer for edit. The native `setValue` parser drops the first of two mentions
 * separated only by a regular space (it collapses that gap so the two mention
 * ranges become adjacent). A non-breaking space is a non-collapsible text
 * node between them, so both mentions survive; it still renders as a normal space.
 */
const separateAdjacentMentionsForEdit: HtmlTransformer = html => {
  if (!html) return html;
  return html.replace(/(<\/mention>)[ \t\u00a0]*(<mention\b)/gi, '$1\u00a0$2');
};

/**
 * `EnrichedTextInput.setValue` cannot render dashboard/API custom emoji `<img>`
 * tags. Use the visible shortcode as the synchronous fallback; edit mode can
 * asynchronously hydrate those tags into native `file://` images later.
 */
const customEmojiImgsToPlainText: HtmlTransformer = html => {
  return html.replace(/<img\b([^>]*)\/?>/gi, (_, attrs: string) =>
    customEmojiImgToPlainText(attrs),
  );
};

const STORED_TO_COMPOSER: HtmlTransformer[] = [
  normalizeInterMentionWhitespaceForEdit,
  dashboardChannelSpanToMention,
  dashboardUserSpanToMention,
  dashboardGroupSpanToMention,
  dashboardSpecialSpanToMention,
  normalizeInterMentionWhitespaceForEdit,
  unwrapDashboardListItems,
  stripLiUlOlOpeningAttrs,
  dashboardPreCodeToCodeblock,
  simplifyDashboardLinks,
  simplifyStrongEm,
  stripAllClassAttributes,
  preserveEmptyParagraphsForComposer,
  ensureTrailingSpaceAfterMentionsForEdit,
  separateAdjacentMentionsForEdit,
];

/**
 * `EnrichedTextInput.setValue` only parses HTML when the string is a full document:
 * Android requires prefix `<html>` and suffix `</html>`; iOS `initiallyProcessHtml` expects
 * the same (or a `<body>` extract). Fragments like `<p>…</p>` are shown as plain text.
 */
export function wrapForEnrichedSetValue(fragment: string): string {
  const t = fragment.trim();
  if (t.length === 0) return fragment;
  if (/^<html\b/i.test(t) && /<\/html>\s*$/i.test(t)) {
    return fragment;
  }
  return `<html>\n${t}\n</html>`;
}

/** Dashboard / Zero message HTML → enriched-input fragment (no `<html>` wrapper). */
export function storedHtmlToComposerFragment(storedHtml: string): string {
  if (typeof storedHtml !== 'string' || storedHtml.trim() === '') {
    return storedHtml;
  }
  return STORED_TO_COMPOSER.reduce((acc, step) => step(acc), storedHtml);
}

export function storedHtmlToComposerSafeFragment(storedHtml: string): string {
  return customEmojiImgsToPlainText(storedHtmlToComposerFragment(storedHtml));
}

/**
 * @param storedHtml HTML as returned from the server / Zero (post-`rawHtmlTransformer` shape).
 */
export function storedHtmlToComposerHtml(storedHtml: string): string {
  return wrapForEnrichedSetValue(storedHtmlToComposerSafeFragment(storedHtml));
}
