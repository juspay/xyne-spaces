import { ensureSpacesBetweenMentionSpans } from '@/src/utils/mentionHtmlToMarkdown';
import {
  formatMentionDisplay,
  normalizeMentionName,
  resolveUserMentionNameFromNativeAttrs,
} from '@/src/utils/mentionLabelUtils';
import { normalizeMessageHtmlForSend } from '@/src/utils/normalizeMessageHtml';
import { codeBlockHtmlToEscapedText } from '@/src/utils/codeBlockHtml';

/**
 * A single transformation step: takes HTML in, returns HTML out.
 * Add new steps to the pipeline in rawHtmlTransformer().
 */
export type HtmlTransformer = (html: string) => string;

/**
 * Strips the outer <html> and optional <body> wrapper, returning only the inner content.
 * Handles optional attributes and whitespace.
 */
const removeHtmlWrapper: HtmlTransformer = (html: string): string => {
  let result = html.trim();
  const htmlMatch = result.match(/^\s*<\s*html[^>]*>([\s\S]*?)<\s*\/\s*html\s*>\s*$/i);
  if (htmlMatch) {
    result = htmlMatch[1]?.trim() ?? '';
  }
  const bodyMatch = result.match(/^\s*<\s*body[^>]*>([\s\S]*?)<\s*\/\s*body\s*>\s*$/i);
  if (bodyMatch) {
    result = bodyMatch[1]?.trim() ?? '';
  }
  return result;
};

/** Escape attribute value for safe HTML (no unescaped " or &). */
function escapeAttr(s: string): string {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/** Match <mention ...>inner</mention> and capture attributes string + inner content */
const MENTION_TAG_REGEX = /<\s*mention\s+([^>]+)\s*>([\s\S]*?)<\s*\/\s*mention\s*>/gi;

/** Parse key="value" or key='value' from opening tag. */
function parseMentionAttrs(attrString: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  const pairRegex = /(\w+(?:-\w+)*)\s*=\s*["']([^"']*)["']/g;
  let m: RegExpExecArray | null;
  while ((m = pairRegex.exec(attrString)) !== null) {
    attrs[m[1] ?? ''] = m[2] ?? '';
  }
  return attrs;
}

/**
 * Recover @channel / @here when iOS drops `data-mention-type` from native `<mention>` HTML.
 * Only applies when the tag is not a real user/group/channel-id mention.
 */
function inferBroadcastMentionType(
  attrs: Record<string, string>,
  text: string,
  innerContent: string,
): 'channel' | 'here' | null {
  if (attrs['data-user-id'] || attrs['data-group-id'] || attrs['data-channel-id']) {
    return null;
  }

  const label = normalizeMentionName(text || innerContent.trim(), '@').toLowerCase();
  if (label === 'channel') return 'channel';
  if (label === 'here') return 'here';
  return null;
}

/**
 * Convert react-native-enriched <mention ...> to dashboard-style spans (with full
 * editor/accessibility attributes): user and channel mentions match dashboard output.
 */
const mentionToDashboardSpan: HtmlTransformer = (html: string): string => {
  return html.replace(MENTION_TAG_REGEX, (_, attrStr, innerContent) => {
    const attrs = parseMentionAttrs(attrStr);
    const text = attrs['text'] ?? innerContent.trim() ?? '';
    const indicator = (attrs['indicator'] ?? '@').trim();
    let mentionType = (attrs['data-mention-type'] ?? '').trim();
    if (mentionType !== 'channel' && mentionType !== 'here') {
      const inferredBroadcast = inferBroadcastMentionType(attrs, text, innerContent);
      if (inferredBroadcast) {
        mentionType = inferredBroadcast;
      }
    }

    if (indicator === '#') {
      // Channel mention → dashboard channel span (with contenteditable, role, aria-label, tabindex)
      const channelId = attrs['data-channel-id'] ?? attrs['id'] ?? '';
      const channelName = normalizeMentionName(
        attrs['data-channel-name'] ?? attrs['name'] ?? text,
        '#',
      );
      const isPrivate = attrs['data-is-private'] ?? 'false';
      const displayText = formatMentionDisplay(channelName, '#');

      const channelParts = [
        'data-channel-mention=""',
        `data-channel-id="${escapeAttr(channelId)}"`,
        `data-channel-name="${escapeAttr(channelName)}"`,
        `data-is-private="${escapeAttr(isPrivate)}"`,
        'class="chat-input-channel-mention"',
        'contenteditable="false"',
        'role="button"',
        `aria-label="Mention channel ${escapeAttr(channelName)}"`,
        'tabindex="-1"',
      ];
      return `<span ${channelParts.join(' ')}>${escapeAttr(displayText)}</span>`;
    }

    if (mentionType === 'channel' || mentionType === 'here') {
      const specialParts = [
        'data-mention=""',
        `data-mention-type="${escapeAttr(mentionType)}"`,
        'class="chat-input-special-mention"',
        'contenteditable="false"',
        'role="button"',
        `aria-label="Mention ${escapeAttr(mentionType)}"`,
        'tabindex="-1"',
      ];
      return `<span ${specialParts.join(' ')}>@${escapeAttr(mentionType)}</span>`;
    }

    if (mentionType === 'group' || attrs['data-group-id']) {
      const groupId = attrs['data-group-id'] ?? attrs['id'] ?? '';
      const groupName = normalizeMentionName(
        attrs['data-group-name'] ?? attrs['name'] ?? text,
        '@',
      );
      const groupAlias = normalizeMentionName(attrs['data-group-alias'] ?? '', '@');
      const description = attrs['data-description'] ?? '';
      const memberCount = attrs['data-member-count'] ?? '0';
      const displayName = groupAlias || groupName;
      const displayText = formatMentionDisplay(displayName, '@');

      const groupParts = [
        'data-mention=""',
        'data-mention-type="group"',
        `data-group-id="${escapeAttr(groupId)}"`,
        `data-group-name="${escapeAttr(groupName)}"`,
        `data-group-alias="${escapeAttr(groupAlias)}"`,
        `data-description="${escapeAttr(description)}"`,
        `data-member-count="${escapeAttr(memberCount)}"`,
        'class="chat-input-group-mention"',
        'contenteditable="false"',
        'role="button"',
        `aria-label="Mention group ${escapeAttr(displayName)}"`,
        'tabindex="-1"',
      ];
      return `<span ${groupParts.join(' ')}>${escapeAttr(displayText)}</span>`;
    }

    // User mention → dashboard user span (with contenteditable, role, aria-label, tabindex, data-member-count)
    const userId = attrs['data-user-id'] ?? attrs['id'] ?? '';
    const username = resolveUserMentionNameFromNativeAttrs(attrs, innerContent);
    const userEmail = attrs['data-user-email'] ?? '';
    const userPicture = attrs['data-user-picture'] ?? attrs['picture'] ?? '';
    const displayText = formatMentionDisplay(username, '@');

    const userParts = [
      'data-mention=""',
      'data-mention-type="user"',
      `data-user-id="${escapeAttr(userId)}"`,
      `data-username="${escapeAttr(username)}"`,
    ];
    if (userEmail) userParts.push(`data-user-email="${escapeAttr(userEmail)}"`);
    if (userPicture) userParts.push(`data-user-picture="${escapeAttr(userPicture)}"`);
    userParts.push(
      'class="chat-input-mention"',
      'contenteditable="false"',
      'role="button"',
      `aria-label="Mention ${escapeAttr(username)}"`,
      'tabindex="-1"',
      'data-member-count="0"',
    );

    return `<span ${userParts.join(' ')}>${escapeAttr(displayText)}</span>`;
  });
};

/** Add dashboard paragraph class to <p> tags that don't already have a class. */
const PARAGRAPH_CLASS = 'm-0 leading-6';

const normalizeParagraphClass: HtmlTransformer = (html: string): string => {
  return html.replace(/<\s*p(\s[^>]*)?>/gi, match => {
    if (/class\s*=/i.test(match)) return match;
    return match.replace(/<\s*p(\s*)/i, `<p class="${PARAGRAPH_CLASS}"$1`);
  });
};

/** Convert <b> / </b> to dashboard-style <strong class="font-semibold"> / </strong>. */
const boldToStrong: HtmlTransformer = (html: string): string => {
  return html
    .replace(/<\s*b\s*>/gi, '<strong class="font-semibold">')
    .replace(/<\s*\/\s*b\s*>/gi, '</strong>');
};

/** Convert <i> / </i> to dashboard-style <em class="italic"> / </em>. */
const italicToEm: HtmlTransformer = (html: string): string => {
  return html.replace(/<\s*i\s*>/gi, '<em class="italic">').replace(/<\s*\/\s*i\s*>/gi, '</em>');
};

/** Dashboard link class for rich text links */
const LINK_CLASS = 'text-blue-600 hover:text-blue-700 underline cursor-text';

/** Normalize href: prepend https:// if no protocol. */
function normalizeHref(href: string): string {
  const trimmed = href.trim();
  if (!trimmed) return trimmed;
  // Skip if already has a protocol (http:, https:, mailto:, tel:, etc.)
  if (/^[a-z][a-z0-9+.-]*:/i.test(trimmed)) {
    return trimmed;
  }
  return `https://${trimmed}`;
}

/** Match <a ...>inner</a> and capture attributes + inner content */
const A_TAG_REGEX = /<\s*a\s+([^>]*)>([\s\S]*?)<\s*\/\s*a\s*>/gi;

/** Convert links to dashboard-style: target, rel, class, normalized href */
const linksToDashboard: HtmlTransformer = (html: string): string => {
  return html.replace(A_TAG_REGEX, (_, attrStr, innerContent) => {
    const attrs = parseMentionAttrs(attrStr);
    const rawHref = attrs['href'] ?? '';
    const href = normalizeHref(rawHref);

    const parts = [
      'target="_blank"',
      'rel="noopener noreferrer"',
      `class="${LINK_CLASS}"`,
      `href="${escapeAttr(href)}"`,
    ];

    return `<a ${parts.join(' ')}>${innerContent}</a>`;
  });
};

/** Normalize native react-native-enriched code blocks to dashboard/web HTML. */
const nativeCodeBlockToPreCode: HtmlTransformer = (html: string): string => {
  return html.replace(
    /<\s*codeblock(\s[^>]*)?>([\s\S]*?)<\s*\/\s*codeblock\s*>/gi,
    (_match, _attrs: string | undefined, innerContent: string) =>
      `<pre><code>${codeBlockHtmlToEscapedText(innerContent)}</code></pre>`,
  );
};

/** Dashboard list classes (from InputBox/TipTap config) */
const UL_CLASS = 'list-disc pl-6 my-2';
const OL_CLASS = 'list-decimal pl-6 my-2';
const LI_CLASS = 'my-1';

/** Add dashboard class to <ul> tags that don't already have a class. */
const normalizeUlClass: HtmlTransformer = (html: string): string => {
  return html.replace(/<\s*ul(\s[^>]*)?>/gi, match => {
    if (/class\s*=/i.test(match)) return match;
    return match.replace(/<\s*ul(\s*)/i, `<ul class="${UL_CLASS}"$1`);
  });
};

/** Add dashboard class to <ol> tags that don't already have a class. */
const normalizeOlClass: HtmlTransformer = (html: string): string => {
  return html.replace(/<\s*ol(\s[^>]*)?>/gi, match => {
    if (/class\s*=/i.test(match)) return match;
    return match.replace(/<\s*ol(\s*)/i, `<ol class="${OL_CLASS}"$1`);
  });
};

/** Match <li ...>inner</li> - capture attributes + inner content */
const LI_TAG_REGEX = /<\s*li(\s[^>]*)?>([\s\S]*?)<\s*\/\s*li\s*>/gi;

/** Add dashboard class to <li> and wrap content in <p class="m-0 leading-6"> if not already wrapped. */
const normalizeListItem: HtmlTransformer = (html: string): string => {
  return html.replace(LI_TAG_REGEX, (_, __, innerContent) => {
    const trimmed = innerContent.trim();
    // If already a single <p>...</p>, add class to p if missing
    const pMatch = trimmed.match(/^\s*<\s*p(\s[^>]*)?>([\s\S]*?)<\s*\/\s*p\s*>\s*$/i);
    if (pMatch) {
      const attrPart = pMatch[1] ?? '';
      const pContent = pMatch[2] ?? '';
      const pClass = /class\s*=/i.test(attrPart) ? attrPart : ` class="${PARAGRAPH_CLASS}"`;
      const pTag = `<p${pClass}>${pContent}</p>`;
      return `<li class="${LI_CLASS}">${pTag}</li>`;
    }
    return `<li class="${LI_CLASS}"><p class="${PARAGRAPH_CLASS}">${innerContent}</p></li>`;
  });
};

/**
 * Pipeline of transformers. Add more steps here as requirements grow
 * (e.g. normalizeParagraphClass, sanitizeMentions, stripScripts).
 */

const TRANSFORMERS: HtmlTransformer[] = [
  removeHtmlWrapper,
  mentionToDashboardSpan,
  nativeCodeBlockToPreCode,
  normalizeParagraphClass,
  boldToStrong,
  italicToEm,
  linksToDashboard,
  normalizeUlClass,
  normalizeOlClass,
  normalizeListItem,
  normalizeMessageHtmlForSend,
  ensureSpacesBetweenMentionSpans,
];

/**
 * Transforms raw HTML (e.g. from react-native-enriched) into the favored format
 * (e.g. fragment-only, dashboard-compatible).
 */
export function rawHtmlTransformer(rawHtml: string): string {
  if (typeof rawHtml !== 'string' || rawHtml.trim() === '') {
    return rawHtml;
  }
  return TRANSFORMERS.reduce((acc, transform) => transform(acc), rawHtml);
}
