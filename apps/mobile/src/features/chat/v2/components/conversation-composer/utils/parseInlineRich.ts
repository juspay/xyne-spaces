import { hasMarkdownTable } from '@/src/utils/markdownTable';

import {
  MENTION_BROADCAST_SCHEME,
  MENTION_CHANNEL_SCHEME,
  MENTION_GROUP_SCHEME,
  MENTION_USER_SCHEME,
} from './mentionSchemes';

/**
 * Custom emoji markers emitted by `htmlToMD` (`xemoji:...:emojix` placeholder or a
 * `file://.../emojis/...` markdown image). Kept in sync with
 * `parseCustomEmojiMarkdownSegments.hasCustomEmojiInMarkdown`; inlined here so
 * this parser stays free of React Native transitive imports.
 */
const CUSTOM_EMOJI_MARKERS: readonly RegExp[] = [
  /xemoji:[^:]+:[^:]*:emojix/,
  /file:\/\/[^)]*\/emojis\//,
];

/**
 * Inline-rich renderer AST.
 *
 * The composer pipeline (`htmlToMD`) emits a small, controlled subset of
 * markdown. `parseInlineRich` turns that subset into this tree so it can be
 * rendered into a single native `<Text>` - giving mentions their own color and
 * highlight (which md4c's shared `link` style cannot do) while keeping correct
 * text wrapping and synchronous first paint.
 */
export type MentionKind = 'user' | 'channel' | 'group' | 'broadcast';

export type InlineNode =
  | { type: 'text'; text: string }
  | { type: 'strong'; children: InlineNode[] }
  | { type: 'em'; children: InlineNode[] }
  | { type: 'underline'; children: InlineNode[] }
  | { type: 'strike'; children: InlineNode[] }
  | { type: 'code'; text: string }
  | { type: 'link'; href: string; children: InlineNode[] }
  | { type: 'mention'; mentionKind: MentionKind; id: string; label: string };

/**
 * Block-level markdown that the inline renderer intentionally does not handle.
 * When present we fall back to md4c (`EnrichedMarkdownText`) so nothing regresses.
 */
const BLOCK_MARKDOWN_PATTERNS: readonly RegExp[] = [
  /```/, // fenced code block
  /(^|\n)(?: {4,}|\t+)(?=\S)/, // indented code block
  /(^|\n)\s{0,3}>/, // blockquote
  /(^|\n)\s{0,3}#{1,6}\s/, // ATX heading
  /(^|\n)\s{0,3}([-*+]|\d+[.)])\s/, // bullet / ordered list item
  /(^|\n)\s{0,3}(-{3,}|\*{3,}|_{3,})\s*(\n|$)/, // thematic break
  /\$\$?[^$]/, // LaTeX math ($...$ / $$...$$)
  /!\[/, // image (incl. file:// custom emoji form)
];

/**
 * True when `markdown` is "inline only" and safe to render with the custom
 * inline renderer. Block constructs and custom emoji fall back to md4c.
 */
export const canRenderInlineRich = (markdown: string): boolean => {
  if (!markdown) return false;
  if (CUSTOM_EMOJI_MARKERS.some(pattern => pattern.test(markdown))) return false;
  if (hasMarkdownTable(markdown)) return false;
  return !BLOCK_MARKDOWN_PATTERNS.some(pattern => pattern.test(markdown));
};

export const hasBlockMarkdown = (markdown: string): boolean =>
  hasMarkdownTable(markdown) || BLOCK_MARKDOWN_PATTERNS.some(pattern => pattern.test(markdown));

const decodeMentionId = (raw: string): string => {
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
};

/** Flatten an inline subtree to plain text (used for mention labels). */
const flattenToText = (nodes: InlineNode[]): string =>
  nodes
    .map(node => {
      switch (node.type) {
        case 'text':
        case 'code':
          return node.text;
        case 'mention':
          return node.label;
        case 'link':
          return flattenToText(node.children);
        default:
          return flattenToText(node.children);
      }
    })
    .join('');

const ensureSpacingBetweenAdjacentMentions = (nodes: InlineNode[]): InlineNode[] => {
  const spaced: InlineNode[] = [];

  for (const node of nodes) {
    const previous = spaced[spaced.length - 1];
    if (node.type === 'mention' && previous?.type === 'mention') {
      spaced.push({ type: 'text', text: ' ' });
    }
    spaced.push(node);
  }

  return spaced;
};

/** Classify a `[label](url)` link as a typed mention or a plain link. */
const buildLinkNode = (labelRaw: string, url: string): InlineNode => {
  const toMention = (mentionKind: MentionKind, idPart: string): InlineNode => ({
    type: 'mention',
    mentionKind,
    id: decodeMentionId(idPart),
    label: flattenToText(parseInlineRich(labelRaw)),
  });

  if (url.startsWith(MENTION_USER_SCHEME)) {
    return toMention('user', url.slice(MENTION_USER_SCHEME.length));
  }
  if (url.startsWith(MENTION_CHANNEL_SCHEME)) {
    return toMention('channel', url.slice(MENTION_CHANNEL_SCHEME.length));
  }
  if (url.startsWith(MENTION_GROUP_SCHEME)) {
    return toMention('group', url.slice(MENTION_GROUP_SCHEME.length));
  }
  if (url.startsWith(MENTION_BROADCAST_SCHEME)) {
    return toMention('broadcast', url.slice(MENTION_BROADCAST_SCHEME.length));
  }
  return { type: 'link', href: url, children: parseInlineRich(labelRaw) };
};

/**
 * Parse a `[label](url)` starting at `s[start]` (which must be `[`).
 * Returns the node and the index just past the closing `)`, or null if the
 * text is not a well-formed link (caller then treats `[` as literal).
 */
const parseLinkAt = (s: string, start: number): { node: InlineNode; end: number } | null => {
  let i = start + 1;
  let label = '';
  while (i < s.length && s[i] !== ']') {
    if (s[i] === '\\' && i + 1 < s.length) {
      label += s[i + 1];
      i += 2;
      continue;
    }
    label += s[i];
    i += 1;
  }
  if (s[i] !== ']' || s[i + 1] !== '(') return null;

  i += 2;
  let url = '';
  let parenDepth = 0;
  while (i < s.length) {
    const char = s[i];
    if (char === '\\' && i + 1 < s.length) {
      url += s[i + 1];
      i += 2;
      continue;
    }
    if (char === '(') {
      parenDepth += 1;
      url += char;
      i += 1;
      continue;
    }
    if (char === ')') {
      if (parenDepth === 0) break;
      parenDepth -= 1;
      url += char;
      i += 1;
      continue;
    }
    url += char;
    i += 1;
  }
  if (s[i] !== ')') return null;

  return { node: buildLinkNode(label, url), end: i + 1 };
};

/** Find the next index of `delimiter` at/after `from`, or -1. */
const indexOfDelimiter = (s: string, delimiter: string, from: number): number =>
  s.indexOf(delimiter, from);

/**
 * A bare URL (one not wrapped in `[label](url)`) anchored at the current scan
 * position. Matched atomically so characters inside the URL - notably `_` - are
 * never interpreted as markdown emphasis, and so the URL becomes a `link` node
 * (rendered in the link color, tappable). Kept in step with the paint-preview
 * path's `BARE_URL_PATTERN` in `buildChatPaintRows` so first paint (lite) and
 * final paint (rich) render bare URLs identically.
 */
const BARE_URL_AT_START = /^https?:\/\/[^\s<>()]+/;
/** Trailing sentence punctuation that should not be swallowed into the URL. */
const TRAILING_URL_PUNCTUATION = /[.,;:!?]+$/;
const ARCHIVE_URL_WITH_SUFFIX_PATTERN =
  /^(https?:\/\/[^/\s<>()]+\/archives\/[A-Z0-9]+\/p\d{16})([A-Z][^\s<>()]*)$/;
const IDENTIFIER_UNDERSCORE_PATTERN = /[A-Za-z0-9]_[A-Za-z0-9]/;

const splitBareUrlCandidate = (raw: string): { url: string; suffix: string; trailing: string } => {
  const trailing = TRAILING_URL_PUNCTUATION.exec(raw)?.[0] ?? '';
  const withoutTrailing = trailing ? raw.slice(0, -trailing.length) : raw;
  const archiveMatch = ARCHIVE_URL_WITH_SUFFIX_PATTERN.exec(withoutTrailing);
  if (archiveMatch) {
    return {
      url: archiveMatch[1] ?? withoutTrailing,
      suffix: archiveMatch[2] ?? '',
      trailing,
    };
  }
  return { url: withoutTrailing, suffix: '', trailing };
};

/**
 * Parse the controlled markdown subset into an inline AST.
 *
 * Supported: `**bold**`, `*em*`, `_em_`, `__underline__`, `~~strike~~`,
 * `` `code` ``, `[label](url)` (links + mentions), `\` escapes and newlines.
 * Unbalanced delimiters degrade to literal text.
 */
export const parseInlineRich = (markdown: string): InlineNode[] => {
  const s = markdown;
  const nodes: InlineNode[] = [];
  let buffer = '';
  let i = 0;

  const flush = (): void => {
    if (buffer.length > 0) {
      nodes.push({ type: 'text', text: buffer });
      buffer = '';
    }
  };

  const wrap = (delimiter: string, type: 'strong' | 'em' | 'underline' | 'strike'): boolean => {
    if (delimiter.includes('_')) {
      const previous = i > 0 ? (s[i - 1] ?? '') : '';
      const next = s[i + delimiter.length] ?? '';
      if (/[A-Za-z0-9_]/.test(previous) || /\s/.test(next)) return false;
    }
    const close = indexOfDelimiter(s, delimiter, i + delimiter.length);
    if (close === -1 || close === i + delimiter.length) return false;
    if (delimiter.includes('_')) {
      const after = s[close + delimiter.length] ?? '';
      const inner = s.slice(i + delimiter.length, close);
      if (/[A-Za-z0-9_]/.test(after) || IDENTIFIER_UNDERSCORE_PATTERN.test(inner)) {
        return false;
      }
    }
    flush();
    const inner = s.slice(i + delimiter.length, close);
    nodes.push({ type, children: parseInlineRich(inner) });
    i = close + delimiter.length;
    return true;
  };

  const wrapStrongEm = (): boolean => {
    const delimiter = '***';
    const close = indexOfDelimiter(s, delimiter, i + delimiter.length);
    if (close === -1 || close === i + delimiter.length) return false;
    flush();
    const inner = s.slice(i + delimiter.length, close);
    nodes.push({
      type: 'strong',
      children: [{ type: 'em', children: parseInlineRich(inner) }],
    });
    i = close + delimiter.length;
    return true;
  };

  while (i < s.length) {
    const c = s[i];

    if (c === '\\' && i + 1 < s.length) {
      buffer += s[i + 1];
      i += 2;
      continue;
    }

    if (c === '`') {
      const close = indexOfDelimiter(s, '`', i + 1);
      if (close !== -1) {
        flush();
        nodes.push({ type: 'code', text: s.slice(i + 1, close) });
        i = close + 1;
        continue;
      }
    }

    if (c === '[') {
      const link = parseLinkAt(s, i);
      if (link) {
        flush();
        nodes.push(link.node);
        i = link.end;
        continue;
      }
    }

    // Detect bare URLs before emphasis parsing so `_` inside a URL is not treated
    // as `_em_` (which leaked stray underscores / italics) and so the URL renders
    // in the link color like the paint-preview path. Only `http(s)://...` matches.
    if (c === 'h') {
      const urlMatch = BARE_URL_AT_START.exec(s.slice(i));
      if (urlMatch) {
        const { url, suffix, trailing } = splitBareUrlCandidate(urlMatch[0]);
        if (url.length > 0) {
          flush();
          nodes.push({ type: 'link', href: url, children: [{ type: 'text', text: url }] });
          if (suffix || trailing) {
            nodes.push({ type: 'text', text: `${suffix ? ` ${suffix}` : ''}${trailing}` });
          }
          i += urlMatch[0].length;
          continue;
        }
      }
    }

    if (s.startsWith('***', i) && wrapStrongEm()) continue;
    if (s.startsWith('**', i) && wrap('**', 'strong')) continue;
    if (s.startsWith('__', i) && wrap('__', 'underline')) continue;
    if (s.startsWith('~~', i) && wrap('~~', 'strike')) continue;
    if (c === '*' && wrap('*', 'em')) continue;
    if (c === '_' && wrap('_', 'em')) continue;

    buffer += c;
    i += 1;
  }

  flush();
  return ensureSpacingBetweenAdjacentMentions(nodes);
};
