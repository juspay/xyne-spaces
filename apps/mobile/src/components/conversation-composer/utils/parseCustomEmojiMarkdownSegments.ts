const CUSTOM_EMOJI_SEGMENT_REGEX =
  /(?:\u2060)?!\[:([^:\]]*):\]\((file:\/\/[^)]*\/emojis\/([^/.)]+)[^)]*)\)|xemoji:([^:]+):([^:]*):emojix/g;

export type CustomEmojiMarkdownSegment =
  | { type: 'markdown'; markdown: string }
  | { type: 'customEmoji'; emojiId: string; name: string; uri?: string };

function decodeEmojiName(encodedName: string): string {
  try {
    return decodeURIComponent(encodedName);
  } catch {
    return encodedName;
  }
}

export function hasCustomEmojiInMarkdown(markdown: string): boolean {
  if (!markdown) return false;
  return /xemoji:[^:]+:[^:]*:emojix/.test(markdown) || /file:\/\/[^)]*\/emojis\//.test(markdown);
}

/**
 * htmlToMD emits `\n` between content paragraphs and `\n\n` for empty `<p></p>`.
 * When text and a custom emoji land in separate paragraphs (native composer) or
 * carry double spaces before `<img>`, those artifacts end up in markdown segments
 * and show as gaps in the flex-row emoji layout. Trim only at emoji boundaries —
 * leave all other markdown intact.
 */
function trimMarkdownAtEmojiBoundary(markdown: string, side: 'beforeEmoji' | 'afterEmoji'): string {
  if (!markdown) return markdown;

  if (side === 'beforeEmoji') {
    return markdown.replace(/\n+$/, '').replace(/[ \t]{2,}$/, ' ');
  }

  return markdown.replace(/^\n+/, '').replace(/^[ \t]{2,}/, ' ');
}

function normalizeCustomEmojiSegmentBoundaries(
  segments: CustomEmojiMarkdownSegment[],
): CustomEmojiMarkdownSegment[] {
  const normalized = segments.map((segment, index) => {
    if (segment.type !== 'markdown') return segment;

    let { markdown } = segment;
    const prev = segments[index - 1];
    const next = segments[index + 1];

    if (prev?.type === 'customEmoji') {
      markdown = trimMarkdownAtEmojiBoundary(markdown, 'afterEmoji');
    }
    if (next?.type === 'customEmoji') {
      markdown = trimMarkdownAtEmojiBoundary(markdown, 'beforeEmoji');
    }

    return { ...segment, markdown };
  });

  return normalized.filter(
    segment => segment.type !== 'markdown' || segment.markdown.trim().length > 0,
  );
}

export function parseCustomEmojiMarkdownSegments(markdown: string): CustomEmojiMarkdownSegment[] {
  if (!markdown) return [];

  const segments: CustomEmojiMarkdownSegment[] = [];
  let lastIndex = 0;

  for (const match of markdown.matchAll(CUSTOM_EMOJI_SEGMENT_REGEX)) {
    const index = match.index ?? 0;
    if (index > lastIndex) {
      const chunk = markdown.slice(lastIndex, index);
      if (chunk.length > 0) {
        segments.push({ type: 'markdown', markdown: chunk });
      }
    }

    if (match[2] && match[3]) {
      segments.push({
        type: 'customEmoji',
        emojiId: match[3],
        name: match[1] ?? '',
        uri: match[2],
      });
    } else if (match[4]) {
      segments.push({
        type: 'customEmoji',
        emojiId: match[4],
        name: decodeEmojiName(match[5] ?? ''),
      });
    }

    lastIndex = index + match[0].length;
  }

  if (lastIndex < markdown.length) {
    const tail = markdown.slice(lastIndex);
    if (tail.length > 0) {
      segments.push({ type: 'markdown', markdown: tail });
    }
  }

  if (segments.length === 0) {
    return [{ type: 'markdown', markdown }];
  }

  return normalizeCustomEmojiSegmentBoundaries(segments);
}

/**
 * Split markdown onto its own flex row at each explicit newline.
 *
 * Custom emoji is a sibling of markdown in a wrapped row, not a glyph inside
 * the native text tree. If the text after an emoji keeps a later newline in the
 * same flex item, that next line is measured against the leftover width after
 * the emoji and paints indented.
 */
export function groupCustomEmojiMarkdownSegmentsByLine(
  segments: CustomEmojiMarkdownSegment[],
): CustomEmojiMarkdownSegment[][] {
  const lines: CustomEmojiMarkdownSegment[][] = [];
  let current: CustomEmojiMarkdownSegment[] = [];

  const pushLine = (): void => {
    lines.push(current);
    current = [];
  };

  for (const segment of segments) {
    if (segment.type === 'customEmoji') {
      current.push(segment);
      continue;
    }

    const parts = segment.markdown.replace(/\r\n/g, '\n').split('\n');
    parts.forEach((part, index) => {
      if (index > 0) pushLine();
      if (part.length > 0) {
        current.push({ type: 'markdown', markdown: part });
      }
    });
  }

  if (current.length > 0 || lines.length === 0) {
    lines.push(current);
  }

  return lines;
}
