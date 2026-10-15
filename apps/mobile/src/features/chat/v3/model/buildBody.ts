import { flowDefinitionToMarkdown, parseFlowJsonParts } from '@/src/utils/flowJsonMarkdown';
import type { ChatBody, ChatRowKind, PreviewSegment } from './chatRow.types';
import type { ConversationInput } from './conversationInput';
import { COLLAPSE_VIEWPORT_HEIGHT_PX, TEXT_CONTAINER_WIDTH_PX } from './layoutConstants';
import { htmlToMD } from './text/htmlToMD';
import {
  getLongMessageCollapseModel,
  LONG_MESSAGE_MAX_COLLAPSED_LINES,
  markdownToCollapsedPreviewText,
  shouldCollapseMessageBody,
} from './text/longMessageCollapse';
import { stripMarkdownForPreview } from './text/markdownPreview';
import { canRenderInlineRich } from './text/parseInlineRich';
import {
  hasCustomEmojiInMarkdown,
  parseCustomEmojiMarkdownSegments,
} from './text/parseCustomEmojiMarkdownSegments';
import { mentionFromUrl } from './mentionPresentation';

export {
  COLLAPSE_VIEWPORT_HEIGHT_PX,
  INLINE_EMOJI_RESERVED_WIDTH_PX,
  TEXT_CONTAINER_WIDTH_PX,
} from './layoutConstants';

const MARKDOWN_LINK = /\[([^\]]+)\]\(([^)]+)\)/g;

const toEmojiSegments = (markdown: string, currentUserId: string): PreviewSegment[] => {
  const parsed = parseCustomEmojiMarkdownSegments(markdown);
  const out: PreviewSegment[] = [];
  for (const part of parsed) {
    if (part.type === 'customEmoji') {
      out.push({
        text: part.name ? `:${part.name}:` : '',
        kind: 'emoji',
        emojiId: part.emojiId,
        name: part.name,
        ...(part.uri ? { uri: part.uri } : {}),
      });
      continue;
    }
    out.push(...splitLinksAndMentions(part.markdown, currentUserId));
  }
  return out;
};

const splitLinksAndMentions = (markdown: string, currentUserId: string): PreviewSegment[] => {
  const segments: PreviewSegment[] = [];
  let last = 0;
  MARKDOWN_LINK.lastIndex = 0;
  for (const match of markdown.matchAll(MARKDOWN_LINK)) {
    const index = match.index ?? 0;
    if (index > last) {
      segments.push({ text: markdown.slice(last, index), kind: 'text' });
    }
    const label = match[1] ?? '';
    const url = match[2] ?? '';
    const mention = mentionFromUrl(url);
    if (mention) {
      const mentionsYou =
        mention.mentionKind === 'broadcast' ||
        (currentUserId.length > 0 && mention.mentionId === currentUserId);
      segments.push({
        text: label,
        kind: 'mention',
        url,
        ...(mentionsYou ? { mentionsYou: true } : {}),
      });
    } else {
      segments.push({ text: label, kind: 'link', url });
    }
    last = index + match[0].length;
  }
  if (last < markdown.length) {
    segments.push({ text: markdown.slice(last), kind: 'text' });
  }
  return segments.filter(segment => segment.text.length > 0);
};

export const buildBody = (
  input: ConversationInput,
  rowKind: ChatRowKind,
  currentUserId = '',
): ChatBody => {
  const suppress = rowKind === 'TICKET' || !!input.ticketPreview;
  const flowParts = !suppress ? parseFlowJsonParts(input.html) : [];
  const flowPreviewMarkdown =
    flowParts.length > 0
      ? flowParts
          .map(part =>
            part.type === 'flow'
              ? flowDefinitionToMarkdown(part.definition, { omitButtons: true })
              : htmlToMD(part.html),
          )
          .filter(Boolean)
          .join('\n\n')
      : '';
  const markdown = suppress
    ? ''
    : flowPreviewMarkdown || input.markdown || (input.html ? htmlToMD(input.html) : '');
  const plainText = suppress ? '' : stripMarkdownForPreview(markdown);
  const collapseModel = getLongMessageCollapseModel({
    markdown,
    maxWidth: TEXT_CONTAINER_WIDTH_PX,
    viewportHeight: COLLAPSE_VIEWPORT_HEIGHT_PX,
  });
  const collapse = {
    isCollapsible: suppress ? false : shouldCollapseMessageBody(collapseModel, rowKind),
    collapsedLines: collapseModel.collapsedNumberOfLines || LONG_MESSAGE_MAX_COLLAPSED_LINES,
  };
  const segments = suppress ? [] : toEmojiSegments(markdown, currentUserId);
  const customEmojiIds = [...new Set(segments.filter(s => s.kind === 'emoji').map(s => s.emojiId))];
  return {
    markdown,
    plainText,
    segments,
    customEmojiIds,
    collapse,
    collapsedPreviewText: collapse.isCollapsible
      ? markdownToCollapsedPreviewText(plainText)
      : plainText,
    isVisibleToCurrentUser: input.isVisibleToCurrentUser,
    inlineMarkdown:
      !suppress &&
      flowParts.length === 0 &&
      canRenderInlineRich(markdown) &&
      !hasCustomEmojiInMarkdown(markdown)
        ? markdown
        : undefined,
    flowParts,
  };
};
