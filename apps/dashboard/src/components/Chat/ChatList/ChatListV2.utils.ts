import { QueryResultType } from '@rocicorp/zero';
import { queries } from '../../../zero/queries';
import { useMemo } from 'react';
import { useShowThreadTags } from '../../../hooks/useShowThreadTags';
import { CombinedMessageItem, shouldShowAvatar } from './ChatListUtils';
import { MessageMetadata } from '../../ui/MessageBubble/MessageBubble.utils';
import { MessageType, parseReactionsMd } from '@xyne/shared';
import { getInitialMessageFromConversation } from '../../../utils/conversationMessageHelpers';

type CombinedMesseges = {
  combinedMessages: CombinedMessageItem[];
  dateGroups: string[];
  groupCounts: number[];
  itemHeights: number[];
};

type InputProps = QueryResultType<typeof queries.channelConversationsPaginatedV3>;

// ─── Constants ───────────────────────────────────────────────────────────────

/** Approx characters that fit on one line of message text. */
const CHARS_PER_LINE_DESKTOP = 80;
const CHARS_PER_LINE_MOBILE = 40;

/** Height of one line of text in px. */
const LINE_HEIGHT = 24;

/** Height bonus for the sender name + timestamp header row. */
const AVATAR_HEADER_HEIGHT = 22;

/** Vertical padding when avatar is shown.
 * ChatListItem: pt-4 (16) + pb-1 (4) = 20px; MessageBubble: py-1 = 8px total → 28px */
const WITH_AVATAR_PADDING = 28;
/** Vertical padding when no avatar.
 * ChatListItem: pt-1 (4) + pb-1 (4) = 8px; MessageBubble: py-1 = 8px total → 16px */
const WITHOUT_AVATAR_PADDING = 16;

// Images/videos render in a py-2 wrapper (8+8=16px). FILE_CARD_HEIGHT (h-64) covers non-image file cards.
const ATTACHMENT_CHROME = 16; // py-2 wrapper (8px top + 8px bottom)
const MEDIA_CAP = 256; // Preview fixedHeight (desktop)
const FILE_CARD_HEIGHT = 256; // h-64 container for non-image file attachments (estimator)
const ATTACHMENT_HEADER = 16; // single text-xs flex row, line-height ~16px

// Video constraints (must match InlineVideoPlayer)
const VIDEO_MAX_WIDTH_DESKTOP = 500;
const VIDEO_MAX_HEIGHT_DESKTOP = 400;
const VIDEO_MAX_WIDTH_MOBILE = 320;
const VIDEO_MAX_HEIGHT_MOBILE = 260;
const VIDEO_MIN_WIDTH = 200;

// Feature-area heights
const TICKET_BUBBLE_HEIGHT = 50; // BotBubble card
// LinkPreview: `py-1.5` (6px) + `gap-0.5` (2px per gap) + rows.
// Text-only (no OG): hostname(~16px) + title(~20px) = ~44px without description.
// Image (OG): base ~44px + mt-1(4px) + image. Desktop ~190px (380/2), mobile ~110px.
// Values below target the no-description minimum to avoid systematic overestimation
// that inflates total scroll height and causes scrollbar jumps / whole-screen flicker.
const LINK_PREVIEW_TEXT_HEIGHT = 55; // text-only, no OG image (~44px base)
const LINK_PREVIEW_IMAGE_HEIGHT_DESKTOP = 240; // OG image at ~380px width (~238px base)
const LINK_PREVIEW_IMAGE_HEIGHT_MOBILE = 170; // OG image at ~260px mobile width (~158px base)
const MESSAGE_PREVIEW_HEIGHT = 120; // internal linked-message card
const THREAD_INDICATOR_HEIGHT = 36; // "N replies" bar: mt-2(8) + pt-2(8) + AvatarGroup sm(20)
const REACTIONS_HEIGHT = 28; // height of one row of h-6 pills (24px) + ~4px gap
/** Approx width of one reaction pill: emoji(22) + optional count(12) + px-2×2(16) + gap(4) */
const REACTION_PILL_WIDTH = 54;
// Reaction row width varies by platform:
//  • Mobile: ~320px (narrow viewport, same sender)
//  • Desktop: ~480px (chat pane ~700px minus avatar ~40px and bubble padding ~32px)
const REACTION_ROW_WIDTH_MOBILE = 320;
const REACTION_ROW_WIDTH_DESKTOP = 480;

const NEW_MSG_DIVIDER_HEIGHT = 36; // "New Messages" red divider
// DatePill renders inside the virtual item div.
// Outer wrapper: `py-2` = 8px top + 8px bottom = 16px.
// Badge content: `text-xs` (16px line-height) + `py-0.5` (4px padding) = 20px.
// Total: 36px. Using 40px to match observed ~38-42px deltas (browser rounding + border).
const DATE_PILL_HEIGHT = 40;

// Fixed message-type heights
const DELETED_MSG_HEIGHT = 28;
const SYSTEM_MSG_HEIGHT = 28;
const TICKET_ACTIVITY_HEIGHT = 32;
const CALL_MSG_HEIGHT = 60; // CallBubble base height (active or inactive, no recording)
const PRIVATE_NOTICE_HEADER = 32; // MessageHeader: tallest SVG h-[28px] + mb-1 (4px)
// WORKFLOW_BUBBLE_HEIGHT removed — replaced with step-count-aware inline calculation
const FORWARDED_HEADER_HEIGHT = 24; // flex row with w-5 h-5 avatar (20px) + text-xs name + mb-1 (4px)
const FORWARDED_BLOCK_PADDING = 0; // quoted block has pl-3 (horizontal only), no vertical padding

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

/**
 * Mirrors Preview.actualDisplayHeight for a single non-grid, non-multigroup image.
 * When the image is wider than tall, the 300px max-width cap reduces the rendered height
 * below the 256px fixedHeight. Without stored dimensions, falls back to MEDIA_CAP.
 */
function estimateImageDisplayHeight(
  w: number | null | undefined,
  h: number | null | undefined,
): number {
  if (w && h) {
    const ar = w / h;
    const displayWidth = Math.min(300, Math.round(ar * MEDIA_CAP));
    return Math.min(MEDIA_CAP, Math.round(displayWidth / ar));
  }
  return MEDIA_CAP;
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
 * @param showThreadTags - Whether the reader has thread tag chips enabled; must match what
 *                         ChatListItem passes to `shouldShowAvatar`, or the estimated height
 *                         disagrees with the rendered one.
 */
export function estimateMessageHeight(
  item: CombinedMessageItem,
  prevItem: CombinedMessageItem | null,
  isMobile: boolean,
  isNewMsgBoundary = false,
  showThreadTags = false,
): number {
  // Only 'conversation' type items exist in this list (no date-separator via
  // useCombinedMesseges – those come from GroupedVirtuoso group headers).
  if (item.type !== 'conversation') return 60;

  const message = getInitialMessageFromConversation(item.data);
  // Items with no initial message render nothing — estimate 0 so virtualizer
  // doesn't allocate phantom space for them.
  if (!message) return 0;

  const metadata = message.metadata as MessageMetadata | null;
  const msgType = message.msgType;

  // ── Determine avatar visibility ──
  const showAvatar = prevItem === null || shouldShowAvatar(item, prevItem, showThreadTags);
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

  // ── Date pill (first item of a new day) ──
  // The DatePill renders inside the virtual item div so its height is always
  // included in the measured size — even when `invisible` (sticky-date duplicate).
  const showDatePill =
    !prevItem || item.createdAt.toDateString() !== prevItem.createdAt.toDateString();
  if (showDatePill) height += DATE_PILL_HEIGHT;

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
  // CallBubble renders either an active-call overlay (~30–40 px) or, for ended
  // calls, a flex-col wrapper that conditionally renders:
  //   • transcript text  (only when metadata.callEndedText is set)
  //   • CanvasPreview    (only when metadata.detailedSummaryCanvasUrl is set)
  //   • attachments      (only when present)
  // For simple calls with none of the above, the bubble is essentially empty
  // (just the wrapper) — return early with just the base height.
  // For rich calls, continue so transcript, canvas, and attachments are all
  // estimated, preventing layout jumps when the item scrolls into view.
  const isCallMessage = metadata?.isCallMessage === true;
  if (isCallMessage) {
    height += CALL_MSG_HEIGHT;

    const hasCallEndedText = !!metadata?.['callEndedText'] && !!message.content;
    const hasCallCanvas = !!metadata?.['detailedSummaryCanvasUrl'];
    const hasCallAttachments = !!message.hasAttachment;

    if (!hasCallEndedText && !hasCallCanvas && !hasCallAttachments) {
      return height;
    }
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
  // isCallMessage is excluded here so calls with recordings fall through to the
  // attachment estimation code rather than early-returning.
  const isSystemMessage =
    msgType === MessageType.SYSTEM &&
    !isCallMessage &&
    !isTicketActivity &&
    !isTicketCreationMessage;

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
    let remainingHtml = html;

    // 1. Code blocks (Markdown or HTML)
    // We strip them out after counting so their contents aren't double-counted in plain text wrapping.
    const markdownCodeMatches = remainingHtml.match(/```[\s\S]*?```/g) || [];
    for (const block of markdownCodeMatches) {
      totalLines += (block.match(/\n/g) || []).length + 1;
    }
    remainingHtml = remainingHtml.replace(/```[\s\S]*?```/g, '');

    const preMatches = remainingHtml.match(/<pre[^>]*>([\s\S]*?)<\/pre>/gi) || [];
    for (const pre of preMatches) {
      totalLines += (pre.match(/\n/g) || []).length + 1;
    }
    remainingHtml = remainingHtml.replace(/<pre[^>]*>([\s\S]*?)<\/pre>/gi, '');

    // 2. Extract all <p> tags and count lines within each
    const pMatches = remainingHtml.match(/<p[^>]*>([\s\S]*?)<\/p>/gi) || [];
    for (const pTag of pMatches) {
      const textContent = pTag.replace(/<[^>]*>/g, '').trim();
      if (textContent.length > 0) {
        const explicitLines = (textContent.match(/\n/g) || []).length + 1;
        const wrappedLines = Math.ceil(textContent.length / charsPerLine);
        totalLines += Math.max(explicitLines, wrappedLines);
      }
    }
    remainingHtml = remainingHtml.replace(/<p[^>]*>([\s\S]*?)<\/p>/gi, '');

    // 3. Extract all <li> tags and count lines within each (reduced chars per line due to padding)
    const liMatches = remainingHtml.match(/<li[^>]*>([\s\S]*?)<\/li>/gi) || [];
    for (const liTag of liMatches) {
      const textContent = liTag.replace(/<[^>]*>/g, '').trim();
      if (textContent.length > 0) {
        const explicitLines = (textContent.match(/\n/g) || []).length + 1;
        const wrappedLines = Math.ceil(textContent.length / liCharsPerLine);
        totalLines += Math.max(explicitLines, wrappedLines);
      }
    }
    remainingHtml = remainingHtml.replace(/<li[^>]*>([\s\S]*?)<\/li>/gi, '');

    // 4. Count <br> tags
    const brCount = (remainingHtml.match(/<br\s*\/?>/gi) || []).length;
    totalLines += brCount;

    // 5. Count block-level closing tags (excluding p and li which are handled above)
    const blockBreaks = (remainingHtml.match(/<\/(div|blockquote|h[1-6])>/gi) || []).length;
    totalLines += blockBreaks;

    // 6. Remaining plain text (if any)
    const plainTextLen = remainingHtml.replace(/<[^>]*>/g, '').trim().length;
    if (plainTextLen > 0) {
      const explicitLines = (remainingHtml.trim().match(/\n/g) || []).length + 1;
      const wrappedLines = Math.ceil(plainTextLen / charsPerLine);
      totalLines += Math.max(explicitLines, wrappedLines);
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
  if (isWorkflowMessage) {
    // Default (collapsed) view shows at most 1 step from completedSteps and 1 from
    // pendingSteps. Outer card p-3 + header + timing rows ≈ 100px; the steps section
    // card adds ~140px base + ~28px per visible step row.
    const completedSteps = (metadata?.completedSteps ?? []) as unknown[];
    const pendingSteps = (metadata?.pendingSteps ?? []) as unknown[];
    const totalSteps = completedSteps.length + pendingSteps.length;
    const defaultVisibleSteps = Math.min(totalSteps, 2);
    const hasReadMore = totalSteps > 3;
    height += totalSteps > 0 ? 100 + 140 + defaultVisibleSteps * 28 + (hasReadMore ? 24 : 0) : 100;
  }

  // ── Attachments ──
  // Use item.data.initialMessageAttachments (the Zero query relationship) rather than
  // message.attachments which comes from InitialMessageSummary and is always empty.
  type AttachmentWithDimsLocal = {
    mimetype: string;
    height?: number | null;
    width?: number | null;
    thumbnailUrl?: string | null;
  };
  const attachments: AttachmentWithDimsLocal[] =
    (item.data.initialMessageAttachments as unknown as AttachmentWithDimsLocal[] | undefined) ??
    (message.attachments as AttachmentWithDimsLocal[] | undefined) ??
    [];
  if (attachments.length > 0) {
    height += ATTACHMENT_HEADER;

    const videos = attachments.filter(att => att.mimetype?.startsWith('video/'));
    const nonVideos = attachments.filter(att => !att.mimetype?.startsWith('video/'));

    // FIX 1: Videos – use the same scaling formula as InlineVideoPlayer
    for (const vid of videos) {
      const videoH = estimateVideoRenderedHeight(vid.width, vid.height, isMobile);
      height += videoH + ATTACHMENT_CHROME;
    }

    // Non-video attachments
    if (nonVideos.length > 0) {
      // Separate images from files.
      // text/plain is NOT an image — it renders as a FilePill (~52px), not a Preview card.
      const images = nonVideos.filter(att => att.mimetype?.startsWith('image/'));
      const files = nonVideos.filter(att => !att.mimetype?.startsWith('image/'));

      if (images.length === 1) {
        // Single image: Preview uses actualDisplayHeight which respects aspect ratio.
        // Wide (landscape) images are height-capped by the 300px max-width constraint.
        const img = images[0] as AttachmentWithDimsLocal;
        height += estimateImageDisplayHeight(img.width, img.height) + ATTACHMENT_CHROME;
      } else if (images.length > 1) {
        // Multiple images: isInMultiImageGroup=true → each always renders at fixedHeight (256px).
        const perRow = isMobile ? 1 : 2;
        const rowCount = Math.ceil(images.length / perRow);
        height += rowCount * (MEDIA_CAP + ATTACHMENT_CHROME);
      }

      // Files (includes text/plain, PDFs, etc.): each on its own row.
      // FilePills are in flex-col gap-2 (8px gap between each pill).
      if (files.length > 0) {
        height += files.length * FILE_CARD_HEIGHT + (files.length - 1) * 8;
      }
    }
  }

  // ── Attachment fallback (when summary only has hasAttachment flag, not actual objects) ──
  // `message.attachments` is only populated when a full Message is passed; the denormalized
  // InitialMessageSummary only carries `hasAttachment: boolean`. When the attachments array is
  // empty but the flag is set (and initialMessageAttachments is also empty), fall back to a
  // conservative single-item estimate so we don't silently skip all attachment height.
  if (attachments.length === 0 && message.hasAttachment) {
    // Conservative: one average-sized attachment (image at MEDIA_CAP with chrome + header)
    height += ATTACHMENT_HEADER + MEDIA_CAP + ATTACHMENT_CHROME;
  }

  // ── Ticket / BotBubble ──
  const hasTicket = item.data.ticketId !== null && item.data.ticketId !== undefined;
  if (hasTicket && !isWorkflowMessage) {
    height += TICKET_BUBBLE_HEIGHT;
    if (isTicketCreationMessage) height += 20;
  }

  // ── Canvas preview ──
  // CanvasPreview card: ~70px header (p-3 + icon + title) + max-h-[220px] body.
  // Use 260px as a mid-point — full canvases reach ~290px; sparse ones ~130px.
  // Two sources:
  //   1. Canvas link in message content (regular messages with /chat/canvas/... URL)
  //   2. Call message detailedSummaryCanvasUrl stored in metadata (CallBubble renders
  //      a CanvasPreview card directly from metadata, not from message content text)
  const hasCanvasLink = /\/chat\/canvas\/[a-zA-Z0-9-]+/.test(content);
  const hasCallSummaryCanvas = !!metadata?.['detailedSummaryCanvasUrl'];
  if (hasCanvasLink || hasCallSummaryCanvas) height += 260;

  // ── Link preview (both internal and external are stored in link_preview_md) ──
  // Three distinct heights:
  //   • Internal message preview (:::message_preview) → MESSAGE_PREVIEW_HEIGHT
  //   • External with OG image (\nimage: present in block) → platform-aware image height
  //   • External text-only → LINK_PREVIEW_TEXT_HEIGHT
  const linkPreviewMd = (message as unknown as { link_preview_md?: string | null }).link_preview_md;
  if (linkPreviewMd) {
    if (linkPreviewMd.includes(':::message_preview')) {
      height += MESSAGE_PREVIEW_HEIGHT;
    } else if (/\nimage:\s*\S/.test(linkPreviewMd)) {
      height += isMobile ? LINK_PREVIEW_IMAGE_HEIGHT_MOBILE : LINK_PREVIEW_IMAGE_HEIGHT_DESKTOP;
    } else {
      height += LINK_PREVIEW_TEXT_HEIGHT;
    }
  }

  // ── Thread reply indicator ──
  const replyCount = item.data.replyCount ?? 0;
  if (replyCount > 0) height += THREAD_INDICATOR_HEIGHT;

  // ── Reactions ──
  const reactionsData = parseReactionsMd(message.reactions_md);
  const uniqueEmojiCount = Object.keys(reactionsData).length;
  if (uniqueEmojiCount > 0) {
    // ReactionView uses flex-wrap; pills wrap to multiple rows when there are many distinct emojis.
    const reactionRowWidth = isMobile ? REACTION_ROW_WIDTH_MOBILE : REACTION_ROW_WIDTH_DESKTOP;
    const pillsPerRow = Math.max(1, Math.floor(reactionRowWidth / REACTION_PILL_WIDTH));
    const rowCount = Math.ceil((uniqueEmojiCount + 1) / pillsPerRow); // +1 for the add-reaction button
    height += rowCount * REACTIONS_HEIGHT;
  }

  return Math.max(height, 40); // never return less than 40px
}

// ─── Hook ────────────────────────────────────────────────────────────────────

export const useCombinedMesseges = (
  conversations: InputProps,
  isMobile: boolean,
  isNewMsgBoundaryIndex = -1,
): CombinedMesseges => {
  const { showThreadTags } = useShowThreadTags();

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
      return estimateMessageHeight(item, prevItem, isMobile, isNewMsgBoundary, showThreadTags);
    });
  }, [combinedMessages, isMobile, isNewMsgBoundaryIndex, showThreadTags]);

  return {
    groupCounts,
    dateGroups,
    combinedMessages,
    itemHeights,
  };
};
