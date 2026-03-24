import { QueryResultType } from '@rocicorp/zero';
import { queries } from '../../../zero/queries';
import { useMemo } from 'react';
import { CombinedMessageItem, shouldShowAvatar } from './ChatListUtils';
import { MessageMetadata } from '../../ui/MessageBubble/MessageBubble.utils';
import { MessageType, parseReactionsMd } from '@xyne/shared';

type CombinedMesseges = {
  combinedMessages: CombinedMessageItem[];
  dateGroups: string[];
  groupCounts: number[];
  itemHeights: number[];
};

type InputProps = QueryResultType<typeof queries.channelConversationsPaginatedV2>;

// ─── Constants ───────────────────────────────────────────────────────────────

/** Approx characters that fit on one line of message text. */
const CHARS_PER_LINE_DESKTOP = 80;
const CHARS_PER_LINE_MOBILE = 40;

/** Height of one line of text in px. */
const LINE_HEIGHT = 24;

/** Height bonus for the sender name + timestamp header row. */
const AVATAR_HEADER_HEIGHT = 22;

/** Vertical padding when avatar is shown (pt-4 + pb-1 ≈ px). */
const WITH_AVATAR_PADDING = 20;
/** Vertical padding when no avatar (pt-1 + pb-1). */
const WITHOUT_AVATAR_PADDING = 8;

// Attachment heights (media cap + 8px padding top + 8px padding bottom + 16px filename)
const ATTACHMENT_CHROME = 32; // padding-top(8) + padding-bottom(8) + filename(16)
const MEDIA_CAP = 256; // Preview fixedHeight (desktop)
const FILE_PILL_HEIGHT = 52; // file attachment row (icon + name + size)
const ATTACHMENT_HEADER = 24; // "N files ▼" header bar

// Video constraints (must match InlineVideoPlayer)
const VIDEO_MAX_WIDTH_DESKTOP = 500;
const VIDEO_MAX_HEIGHT_DESKTOP = 400;
const VIDEO_MAX_WIDTH_MOBILE = 320;
const VIDEO_MAX_HEIGHT_MOBILE = 260;
const VIDEO_MIN_WIDTH = 200;

// Feature-area heights
const TICKET_BUBBLE_HEIGHT = 153; // BotBubble card
const LINK_PREVIEW_HEIGHT = 80; // LinkPreview card
const THREAD_INDICATOR_HEIGHT = 28; // "N replies" bar
const REACTIONS_HEIGHT = 28; // emoji pill row

const NEW_MSG_DIVIDER_HEIGHT = 36; // "New Messages" red divider

// Fixed message-type heights
const DELETED_MSG_HEIGHT = 28;
const SYSTEM_MSG_HEIGHT = 28;
const TICKET_ACTIVITY_HEIGHT = 32;
const CALL_MSG_HEIGHT = 80; // CallBubble (active or inactive)
const PRIVATE_NOTICE_HEADER = 40; // "Only visible to you" bar
const WORKFLOW_BUBBLE_HEIGHT = 72; // WorkflowBubble card
const FORWARDED_HEADER_HEIGHT = 40; // sender name + timestamp row in forwarded block
const FORWARDED_BLOCK_PADDING = 12; // padding inside the quoted block

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Compute the rendered height of a video using the same algorithm as
 * InlineVideoPlayer's `dimensions` useMemo.
 */
function estimateVideoRenderedHeight(
  vidWidth: number | null | undefined,
  vidHeight: number | null | undefined,
  isMobile: boolean,
): number {
  const maxW = isMobile ? VIDEO_MAX_WIDTH_MOBILE : VIDEO_MAX_WIDTH_DESKTOP;
  const maxH = isMobile ? VIDEO_MAX_HEIGHT_MOBILE : VIDEO_MAX_HEIGHT_DESKTOP;

  if (!vidWidth || !vidHeight) {
    return maxH;
  }

  const scale = Math.min(maxW / vidWidth, maxH / vidHeight);
  let finalW = Math.round(vidWidth * scale);
  let finalH = Math.round(vidHeight * scale);

  if (finalW < VIDEO_MIN_WIDTH) {
    finalW = VIDEO_MIN_WIDTH;
    finalH = Math.round(vidHeight * (VIDEO_MIN_WIDTH / vidWidth));
  }

  return finalH;
}

// ─── Pure estimator ───────────────────────────────────────────────────────────

/**
 * Estimates the rendered height (in px) of a single chat list item.
 *
 * This is deliberately a *pure* function so it stays cheap to call in a
 * `useMemo` and doesn't pull in any React hooks.
 *
 * @param item          - The combined message item to estimate
 * @param prevItem      - The item immediately before this one (or null)
 * @param isMobile      - Whether the viewport is in mobile mode
 * @param isNewMsgBoundary - Whether the red "New Messages" divider is shown above this item
 */
export function estimateMessageHeight(
  item: CombinedMessageItem,
  prevItem: CombinedMessageItem | null,
  isMobile: boolean,
  isNewMsgBoundary = false,
): number {
  // Only 'conversation' type items exist in this list (no date-separator via
  // useCombinedMesseges – those come from GroupedVirtuoso group headers).
  if (item.type !== 'conversation') return 60;

  const message = item.data.initialMessage;
  if (!message) return 40;

  const metadata = message.metadata as MessageMetadata | null;
  const msgType = message.msgType;

  // ── Determine avatar visibility ──
  const showAvatar = prevItem === null || shouldShowAvatar(item, prevItem);
  let height = showAvatar ? WITH_AVATAR_PADDING : WITHOUT_AVATAR_PADDING;

  // ── New-message boundary divider ──
  if (isNewMsgBoundary) height += NEW_MSG_DIVIDER_HEIGHT;

  // ── Private system notice header ("Only visible to you") ──
  const isMentionUserAddition = metadata?.messageSubtype === 'user_not_in_channel';
  const isTicketNudge = metadata?.messageSubtype === 'ticket_nudge';
  const isPrivateSystemNotice = isMentionUserAddition || isTicketNudge;
  if (isPrivateSystemNotice) height += PRIVATE_NOTICE_HEADER;

  // ── Avatar header row (sender name + timestamp) ──
  if (showAvatar) height += AVATAR_HEADER_HEIGHT;

  // ── Ticket activity message – completely different layout ──
  const isTicketActivity =
    msgType === MessageType.SYSTEM && metadata?.['isTicketActivity'] === true;
  if (isTicketActivity) {
    return height + TICKET_ACTIVITY_HEIGHT;
  }

  // ── Deleted message ──
  if (message.isDeleted) {
    return height + DELETED_MSG_HEIGHT;
  }

  // ── Call message ──
  const isCallMessage = metadata?.isCallMessage === true;
  if (isCallMessage) {
    return height + CALL_MSG_HEIGHT;
  }

  // ── Plain system message (channel join, etc.) ──
  const isWorkflowMessage =
    (msgType === MessageType.SYSTEM &&
      metadata?.workflowId &&
      metadata?.ticketId &&
      !metadata?.messageSubtype) ||
    (msgType === MessageType.BOT && metadata?.xyneId && metadata?.ticketId);
  const isTicketCreationMessage =
    msgType === MessageType.SYSTEM && metadata?.ticketId !== undefined && !isTicketActivity;
  const isSystemMessage =
    msgType === MessageType.SYSTEM && !isTicketActivity && !isTicketCreationMessage;

  if (isSystemMessage) {
    return height + SYSTEM_MSG_HEIGHT;
  }

  // ── Forwarded message ──
  const isForwardedMessage = msgType === MessageType.FORWARDED;

  // ── Markdown / long-form content (call summaries) ──
  const isMarkdownContent = metadata?.['contentFormat'] === 'markdown';

  // ── Text content height ──
  const content = message.content ?? '';
  const charsPerLine = isMobile ? CHARS_PER_LINE_MOBILE : CHARS_PER_LINE_DESKTOP;
  const liCharsPerLine = charsPerLine - 8; // <li> has 24px left padding ≈ 8 fewer chars

  // Helper to estimate text height from HTML content
  const estimateHtmlHeight = (html: string): number => {
    let totalLines = 0;

    // Extract all <p> tags and count lines within each
    const pMatches = html.match(/<p[^>]*>([\s\S]*?)<\/p>/gi) || [];
    for (const pTag of pMatches) {
      const textContent = pTag.replace(/<[^>]*>/g, '').trim();
      if (textContent.length > 0) {
        const lines = Math.ceil(textContent.length / charsPerLine);
        totalLines += Math.max(1, lines);
      }
    }

    // Extract all <li> tags and count lines within each (reduced chars per line due to padding)
    const liMatches = html.match(/<li[^>]*>([\s\S]*?)<\/li>/gi) || [];
    for (const liTag of liMatches) {
      const textContent = liTag.replace(/<[^>]*>/g, '').trim();
      if (textContent.length > 0) {
        const lines = Math.ceil(textContent.length / liCharsPerLine);
        totalLines += Math.max(1, lines);
      }
    }

    // Count <br> tags
    const brCount = (html.match(/<br\s*\/?>/gi) || []).length;
    totalLines += brCount;

    // Count block-level closing tags (excluding p and li which are handled above)
    const blockBreaks = (html.match(/<\/(div|blockquote|pre|h[1-6])>/gi) || []).length;
    totalLines += blockBreaks;

    // If no structured content found, fall back to plain text estimation
    if (pMatches.length === 0 && liMatches.length === 0) {
      const plainTextLen = html.replace(/<[^>]*>/g, '').trim().length;
      if (plainTextLen > 0) {
        totalLines = Math.max(1, Math.ceil(plainTextLen / charsPerLine));
      }
    }

    return Math.max(1, totalLines) * LINE_HEIGHT;
  };

  // Handle forwarded messages with XML parsing
  if (isForwardedMessage) {
    // Parse the forwarded message XML to extract optionalText and content
    const forwardedMatch = content.match(/<ForwardedMessage[\s\S]*>([\s\S]*)<\/ForwardedMessage>/);
    if (forwardedMatch) {
      // Extract OptionalText
      const optionalTextMatch = content.match(/<OptionalText>([\s\S]*?)<\/OptionalText>/i);
      // Extract Content (the forwarded message body)
      const forwardedContentMatch = content.match(/<Content>([\s\S]*?)<\/Content>/i);

      // Height for optionalText (if present)
      if (optionalTextMatch && optionalTextMatch[1]?.trim()) {
        height += estimateHtmlHeight(optionalTextMatch[1]);
      }

      // Height for forwarded block header (sender name + timestamp)
      height += FORWARDED_HEADER_HEIGHT;

      // Height for the forwarded content
      if (forwardedContentMatch && forwardedContentMatch[1]?.trim()) {
        height += estimateHtmlHeight(forwardedContentMatch[1]);
      }

      // Padding for the forwarded block container
      height += FORWARDED_BLOCK_PADDING;
    } else {
      // Fallback if XML parsing fails
      height += estimateHtmlHeight(content);
    }
  } else {
    // Regular message - estimate HTML height directly
    height += estimateHtmlHeight(content);
  }

  // Markdown content has more vertical space (headings, lists, code blocks)
  if (isMarkdownContent && !isForwardedMessage) {
    height = Math.ceil(height * 1.4);
  }

  // ── Workflow bubble ──
  if (isWorkflowMessage) height += WORKFLOW_BUBBLE_HEIGHT;

  // ── Attachments ──
  const attachments = message.attachments ?? [];
  if (attachments.length > 0) {
    height += ATTACHMENT_HEADER;

    type AttachmentWithDims = {
      mimetype: string;
      height?: number | null;
      width?: number | null;
      thumbnailUrl?: string | null;
    };
    const videos = attachments.filter((att: AttachmentWithDims) =>
      att.mimetype?.startsWith('video/'),
    );
    const nonVideos = attachments.filter(
      (att: AttachmentWithDims) => !att.mimetype?.startsWith('video/'),
    );

    // FIX 1: Videos – use the same scaling formula as InlineVideoPlayer
    for (const vid of videos) {
      const v = vid as AttachmentWithDims;
      const videoH = estimateVideoRenderedHeight(v.width, v.height, isMobile);
      height += videoH + ATTACHMENT_CHROME;
    }

    // Non-video attachments
    if (nonVideos.length > 0) {
      // Separate images from files
      const images = nonVideos.filter((att: AttachmentWithDims) => {
        return att.mimetype?.startsWith('image/') || att.mimetype === 'text/plain';
      });
      const files = nonVideos.filter((att: AttachmentWithDims) => {
        return !att.mimetype?.startsWith('image/') && att.mimetype !== 'text/plain';
      });

      // FIX 2: Images – the Preview component always renders at fixedHeight = 256
      //         (MEDIA_CAP) regardless of the stored image height, so always use
      //         MEDIA_CAP here instead of Math.min(storedHeight, MEDIA_CAP).
      if (images.length > 0) {
        const perRow = isMobile ? 1 : 2;
        const rowCount = Math.ceil(images.length / perRow);
        height += rowCount * (MEDIA_CAP + ATTACHMENT_CHROME);
      }

      // Files: each on its own row
      height += files.length * FILE_PILL_HEIGHT;
    }
  }

  // ── Ticket / BotBubble ──
  const hasTicket = item.data.ticketId !== null && item.data.ticketId !== undefined;
  if (hasTicket && !isWorkflowMessage) {
    height += TICKET_BUBBLE_HEIGHT;
    if (isTicketCreationMessage) height += 20;
  }

  // ── Link preview ──
  const hasLinkPreview =
    metadata?.['linkPreview'] !== undefined && metadata?.['linkPreview'] !== null;
  if (hasLinkPreview) height += LINK_PREVIEW_HEIGHT;

  // ── Thread reply indicator ──
  const replyCount = item.data.replyCount ?? 0;
  if (replyCount > 0) height += THREAD_INDICATOR_HEIGHT;

  // ── Reactions ──
  const reactionsData = parseReactionsMd(message.reactions_md);
  if (Object.keys(reactionsData).length > 0) height += REACTIONS_HEIGHT;

  return Math.max(height, 40); // never return less than 40px
}

// ─── Hook ────────────────────────────────────────────────────────────────────

export const useCombinedMesseges = (
  conversations: InputProps,
  isMobile: boolean,
  isNewMsgBoundaryIndex = -1,
): CombinedMesseges => {
  const combinedMessages: CombinedMessageItem[] = useMemo(() => {
    return conversations.map(conversation => ({
      type: 'conversation' as const,
      data: conversation,
      createdAt: new Date(conversation.createdAt),
    }));
  }, [conversations]);

  const { groupCounts, dateGroups } = useMemo((): {
    groupCounts: number[];
    dateGroups: string[];
  } => {
    if (combinedMessages.length === 0) {
      return { groupCounts: [], dateGroups: [] };
    }

    const groups = new Map<string, CombinedMessageItem[]>();

    combinedMessages.forEach(msg => {
      const dateKey = msg.createdAt.toDateString();
      if (!groups.has(dateKey)) {
        groups.set(dateKey, []);
      }
      groups.get(dateKey)!.push(msg);
    });

    const dateGroups = Array.from(groups.keys());
    const groupCounts = dateGroups.map(date => groups.get(date)!.length);

    return { groupCounts, dateGroups };
  }, [combinedMessages]);

  /** Parallel array of estimated px heights for each item in combinedMessages. */
  const itemHeights: number[] = useMemo(() => {
    return combinedMessages.map((item, index) => {
      const prevItem = index > 0 ? (combinedMessages[index - 1] ?? null) : null;
      const isNewMsgBoundary = index === isNewMsgBoundaryIndex;
      return estimateMessageHeight(item, prevItem, isMobile, isNewMsgBoundary);
    });
  }, [combinedMessages, isMobile, isNewMsgBoundaryIndex]);

  return {
    groupCounts,
    dateGroups,
    combinedMessages,
    itemHeights,
  };
};
