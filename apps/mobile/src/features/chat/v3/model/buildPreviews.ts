import type { ForwardedPreview, LinkPreview, ParentPreview, PreviewSegment } from './chatRow.types';
import type { ConversationInput } from './conversationInput';
import { linkPreviewSeedFrom } from './linkPreview';
import { parseCustomEmojiMarkdownSegments } from './text/parseCustomEmojiMarkdownSegments';
import { stripMarkdownForPreview } from './text/markdownPreview';
import { htmlToMD } from './text/htmlToMD';
import { getUserColorIndex } from './text/getUserColor';
import { AVG_CHAR_WIDTH_PX, TEXT_CONTAINER_WIDTH_PX } from './layoutConstants';
import { TEXT_LINE_HEIGHT } from './text/markdownStyle';

export const PARENT_PREVIEW_HEIGHT_PX = 82;
export const LINK_PREVIEW_HEIGHT_PX = 86;
export const FORWARDED_QUOTE_MIN_HEIGHT_PX = 96;

const parentSegments = (markdown: string): PreviewSegment[] => {
  const parsed = parseCustomEmojiMarkdownSegments(markdown);
  return parsed.map(part =>
    part.type === 'customEmoji'
      ? {
          text: part.name ? `:${part.name}:` : '',
          kind: 'emoji' as const,
          emojiId: part.emojiId,
          name: part.name,
          ...(part.uri ? { uri: part.uri } : {}),
        }
      : { text: part.markdown, kind: 'text' as const },
  );
};

export const buildParentPreview = (input: ConversationInput): ParentPreview | null => {
  if (!input.parentConversationId || !input.parentMarkdown) return null;
  const markdown = input.parentMarkdown.includes('<')
    ? htmlToMD(input.parentMarkdown)
    : input.parentMarkdown;
  const segments = parentSegments(markdown);
  return {
    conversationId: input.parentConversationId,
    messageId: input.parentMessageId ?? input.parentConversationId,
    text: stripMarkdownForPreview(markdown),
    segments,
    customEmojiIds: segments.filter(s => s.kind === 'emoji').map(s => s.emojiId),
    reservedHeightPx: PARENT_PREVIEW_HEIGHT_PX,
  };
};

export const buildLinkPreview = (input: ConversationInput): LinkPreview | null => {
  if (input.ticketPreview) return null;
  const preview = linkPreviewSeedFrom({
    markdown: input.markdown || (input.html ? htmlToMD(input.html) : ''),
    legacy: {
      url: input.linkUrl,
      title: input.linkTitle,
      description: input.linkDescription,
      siteName: input.linkSiteName,
      image: input.linkImage,
      favicon: input.linkFavicon,
      needsMetadataFetch: input.linkNeedsMetadataFetch,
    },
  });
  if (!preview) return null;
  return {
    ...preview,
    host: new URL(preview.url).hostname.replace(/^www\./i, ''),
    reservedHeightPx: LINK_PREVIEW_HEIGHT_PX,
  };
};

const forwardedReservedHeightPx = (markdown: string, showPostedIn: boolean): number => {
  const charsPerLine = Math.max(16, Math.round(TEXT_CONTAINER_WIDTH_PX / AVG_CHAR_WIDTH_PX));
  const wrapped = (markdown ? markdown.split(/\r?\n/) : ['']).reduce(
    (total, line) => total + Math.max(1, Math.ceil(line.length / charsPerLine)),
    0,
  );
  const lines = Math.min(6, Math.max(1, wrapped));
  return 8 + 22 + lines * TEXT_LINE_HEIGHT + (showPostedIn ? 28 : 0) + 8;
};

export const buildForwarded = (input: ConversationInput): ForwardedPreview | null => {
  if (!input.forwardedFromName) return null;
  const source = input.forwardedSource;
  const originalHtml = source?.originalHtml ?? '';
  const originalMarkdown = htmlToMD(source?.originalHtml ?? '');
  const showPostedIn = Boolean(source?.originalChannelId && source?.originalConversationId);
  return {
    fromName: input.forwardedFromName,
    originalSenderId: source?.originalSenderId ?? null,
    colorIndex: getUserColorIndex(source?.originalSenderId ?? ''),
    originalCreatedAt: source?.originalCreatedAt ?? null,
    originalChannelId: source?.originalChannelId ?? null,
    originalConversationId: source?.originalConversationId ?? null,
    originalMessageId: source?.originalMessageId ?? null,
    originalHtml,
    originalMarkdown,
    reservedHeightPx: Math.max(
      FORWARDED_QUOTE_MIN_HEIGHT_PX,
      forwardedReservedHeightPx(originalMarkdown, showPostedIn),
    ),
  };
};
