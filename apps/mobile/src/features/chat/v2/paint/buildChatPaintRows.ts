import { format } from 'date-fns';
import {
  ChannelScopeType,
  MessageType,
  type ParentMessageSummary,
  parseForwardedMessageXml,
  parseInitialMessageMd,
  parseLinkPreviewMd,
  parseParentMessageMd,
  parseRepliesMd,
  parseTicketMd,
  TicketStatusV2,
  type User,
} from '@xyne/shared';

import type { ConversationItem } from '@/src/features/chat/v2/components/conversation-composer/conversation-composer.types';
import { getConversationReactionsMd } from '@/src/features/chat/v2/components/conversation-composer/utils/getConversationReactionsMd';
import {
  DELETED_MESSAGE_PLACEHOLDER,
  getConversationKind,
} from '@/src/features/chat/v2/components/conversation-composer/utils/getConversationKind';
import {
  htmlToMD,
  getParentMessagePreviewMarkdown,
  stripMarkdownForPreview,
} from '@/src/features/chat/v2/components/conversation-composer/utils/htmlToMD';
import {
  MENTION_BROADCAST_SCHEME,
  MENTION_USER_SCHEME,
} from '@/src/features/chat/v2/components/conversation-composer/utils/mentionSchemes';
import { parseCustomEmojiMarkdownSegments } from '@/src/features/chat/v2/components/conversation-composer/utils/parseCustomEmojiMarkdownSegments';
import { canRenderInlineRich } from '@/src/features/chat/v2/components/conversation-composer/utils/parseInlineRich';
import {
  getLongMessageCollapseModel,
  LONG_MESSAGE_MAX_COLLAPSED_LINES,
  markdownToCollapsedPreviewText,
  shouldCollapseMessageBody,
} from '@/src/features/chat/v2/components/conversation-composer/utils/longMessageCollapse';
import { ensureSpacingBetweenAdjacentMentions } from './chatPaintPreviewSegments';
import {
  groupReactionsForPill,
  totalReactionCount,
} from '@/src/components/chat/message/reactions/reaction-pill.utils';
import {
  getParentMessagePreviewText,
  reactionsMdToRawReactions,
} from '@/src/utils/conversationMessageHelpers';
import type { DmIdentitySnapshot } from '@/src/types/dm-list-item';
import { stateMachineActor } from '@/src/machines/stateMachine';
import { normalizeMarkdownListIndentation } from '@/src/utils/markdownListNormalization';
import { getAttachmentMediaKind } from '@/src/components/attachments-viewer/utils/file-viewer';
import { activeAttachmentsOf, hasSoftDeletedAttachmentsOnly } from '@/src/utils/activeAttachments';

import type {
  ChatPaintRow,
  ChatPaintRowKind,
  ChatPaintRowType,
  ChatPaintCollapseModel,
  ChatPaintEmojiSlot,
  ChatPaintMediaGeometry,
  ChatPaintParentPreview,
  ChatPaintBody,
  ReactionPreview,
  ReplyPreview,
  MediaPreview,
  LinkPreview,
  TicketPreview,
  RecordingPreview,
  MediaPlaceholder,
  PaintPreviewSegment,
  SenderPaintModel,
} from './chatPaint.types';
import {
  CHAT_PAINT_COLLAPSE_VIEWPORT_HEIGHT_PX,
  CHAT_PAINT_DEFAULT_MEDIA_ASPECT_RATIO,
  CHAT_PAINT_FILE_ATTACHMENT_HEIGHT_PX,
  CHAT_PAINT_INLINE_EMOJI_RESERVED_WIDTH_PX,
  CHAT_PAINT_MEDIA_GRID_HEIGHT_PX,
  CHAT_PAINT_PARENT_PREVIEW_HEIGHT_PX,
  CHAT_PAINT_TEXT_CONTAINER_WIDTH_PX,
  SPECIAL_SYSTEM_ROW_ESTIMATED_HEIGHT,
  estimateChatPaintRowHeight,
} from './chatPaintSizing';
import { decodeBasicEntities, replaceUntilStable } from '@/src/utils/htmlText';

type BuildChatPaintRowsArgs = {
  channelId: string;
  channelType?: ChannelScopeType | undefined;
  conversations: ReadonlyArray<ConversationItem> | undefined | null;
  currentUser?: User | undefined;
};

export type ChatPaintRowBuildSignature = string;

export type IncrementalChatPaintRowsState = {
  rows: ChatPaintRow[];
  rowsByConversationId: Map<string, ChatPaintRow>;
  signaturesByConversationId: Map<string, ChatPaintRowBuildSignature>;
};

type BuildChatPaintRowsIncrementalArgs = BuildChatPaintRowsArgs & {
  previousState?: IncrementalChatPaintRowsState | null | undefined;
  // Signatures the caller already computed for this exact window. Reused here to
  // avoid hashing every conversation a second time per live delta (the caller's
  // change-detection memo and this build otherwise duplicate the same O(n) work).
  precomputedSignatures?: ReadonlyMap<string, ChatPaintRowBuildSignature> | undefined;
};

export const createIncrementalChatPaintRowsState = (
  rows: ReadonlyArray<ChatPaintRow>,
  rowSignatures?: Record<string, string> | null | undefined,
): IncrementalChatPaintRowsState | null => {
  if (rows.length === 0 || !rowSignatures) return null;

  const signaturesByConversationId = new Map<string, ChatPaintRowBuildSignature>();
  const rowsByConversationId = new Map<string, ChatPaintRow>();
  for (const row of rows) {
    rowsByConversationId.set(row.conversationId, row);
    const signature = rowSignatures[row.conversationId];
    if (signature) {
      signaturesByConversationId.set(row.conversationId, signature);
    }
  }

  if (signaturesByConversationId.size === 0) return null;

  return {
    rows: [...rows],
    rowsByConversationId,
    signaturesByConversationId,
  };
};

type PaintIdentity = {
  id: string;
  name: string;
  picture?: string | null | undefined;
};

type InitialMessageSummary = ReturnType<typeof parseInitialMessageMd>;
type TextLikePreviewSegment = Extract<PaintPreviewSegment, { kind: 'text' | 'link' | 'mention' }>;
type KnownMentionSplitter = (segments: PaintPreviewSegment[]) => PaintPreviewSegment[];

const SYSTEM_SENDER: SenderPaintModel = {
  senderId: 'system',
  displayName: 'System',
  avatarUri: null,
  isCurrentUser: false,
};

const hashString = (value: string | null | undefined): string => {
  if (!value) return '0:0';
  let hash = 5381;
  for (let i = 0; i < value.length; i++) {
    hash = ((hash << 5) + hash + value.charCodeAt(i)) | 0;
  }
  return `${value.length}:${hash >>> 0}`;
};

const getAttachmentSignature = (conversation: ConversationItem): string => {
  const attachments = conversation.initialMessageAttachments ?? [];
  if (attachments.length === 0) return '0';

  // Paint rows are reused when this string is unchanged. Soft-delete only flips
  // `isDeleted` (id/mimetype/filename stay the same), so we must stamp it here
  // or the bubble keeps showing the old attachment. Encoded as '1'/'0' because
  // the signature is a joined string (same pattern as other paint stamps).
  return attachments
    .map(attachment => {
      const metadata = (attachment.metadata ?? null) as {
        width?: number;
        height?: number;
        duration?: number;
        thumbUri?: string;
      } | null;
      return [
        attachment.id ?? '',
        attachment.isDeleted ? '1' : '0',
        attachment.mimetype ?? '',
        attachment.originalFilename ?? '',
        attachment.size ?? '',
        metadata?.width ?? '',
        metadata?.height ?? '',
        metadata?.duration ?? '',
        metadata?.thumbUri ?? '',
      ].join(':');
    })
    .join('|');
};

export const computeConversationPaintSignature = (
  conversation: ConversationItem,
  context: {
    channelId: string;
    currentUserId?: string | undefined;
  },
): ChatPaintRowBuildSignature => {
  // Include link_preview_md hash so that when stored OG metadata arrives
  // (via the backend writing link_preview_md), the paint signature changes
  // and the row is rebuilt with the updated link preview model.
  const summary = parseInitialMessageMd(conversation.initial_message_md);
  const linkPreviewMdHash = hashString(summary?.link_preview_md ?? null);

  return [
    context.channelId,
    context.currentUserId ?? 'anonymous',
    conversation.conversationId,
    conversation.createdAt,
    conversation.createdBy ?? '',
    conversation.replyCount ?? 0,
    conversation.ticketId ?? '',
    hashString(conversation.initial_message_md),
    hashString(getConversationReactionsMd(conversation)),
    hashString(conversation.ticket_md),
    hashString(conversation.replies_md),
    hashString(conversation.parent_message_md),
    linkPreviewMdHash,
    getAttachmentSignature(conversation),
  ].join('~');
};

const collapseHorizontalWhitespace = (value: string): string => value.replace(/[^\S\n]+/g, ' ');

const stripToPlainText = (value: string): string =>
  collapseHorizontalWhitespace(
    decodeBasicEntities(replaceUntilStable(value.replace(/<br\s*\/?>/gi, '\n'), /<[^>]*>/g, ' ')),
  ).trim();

const stripInlineMarkdownFormatting = (value: string): string => stripMarkdownForPreview(value);

const inlinePlainText = (value: string): string =>
  collapseHorizontalWhitespace(
    stripInlineMarkdownFormatting(
      value
        .replace(/<br\s*\/?>/gi, '\n')
        .replace(/<[^>]*>/g, ' ')
        .replace(/&nbsp;/gi, ' '),
    ),
  );

const MARKDOWN_LINK_PATTERN = /\[([^\]]+)\]\(([^)]+)\)/g;
const BARE_URL_PATTERN = /https?:\/\/[^\s<>()]+/g;
const URL_TRAILING_PUNCTUATION_PATTERN = /[.,!?;:]+$/;
const ARCHIVE_URL_WITH_SUFFIX_PATTERN =
  /^(https?:\/\/[^/\s<>()]+\/archives\/[A-Z0-9]+\/p\d{16})([A-Z][^\s<>()]*)$/;

const splitBareUrlCandidate = (raw: string): { url: string; suffix: string; trailing: string } => {
  const trailing = URL_TRAILING_PUNCTUATION_PATTERN.exec(raw)?.[0] ?? '';
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

const escapeRegExp = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const decodeMentionId = (value: string): string => {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
};

const appendTextSegment = (
  segments: PaintPreviewSegment[],
  text: string,
  kind: Extract<PaintPreviewSegment['kind'], 'text' | 'link' | 'mention'> = 'text',
  options?: { mentionsYou?: boolean | undefined; url?: string | undefined },
): void => {
  const normalized = text.replace(/[^\S\n]+/g, ' ');
  if (!normalized || !normalized.trim()) {
    if (segments.length > 0 && normalized) {
      const previous = segments[segments.length - 1];
      if (previous?.kind === 'text') {
        previous.text += normalized;
      } else {
        segments.push({ text: normalized, kind: 'text' });
      }
    }
    return;
  }
  const previous = segments[segments.length - 1];
  if (previous?.kind === kind) {
    if (kind !== 'mention') {
      previous.text += normalized;
      return;
    }
  }
  if (kind === 'mention') {
    if (previous?.kind === 'mention') {
      segments.push({ text: ' ', kind: 'text' });
    }
    segments.push({
      text: normalized,
      kind,
      ...(options?.mentionsYou ? { mentionsYou: true } : {}),
    });
    return;
  }
  if (kind === 'link') {
    segments.push({
      text: normalized,
      kind,
      ...(options?.url ? { url: options.url } : {}),
    });
    return;
  }
  segments.push({ text: normalized, kind });
};

const getMarkdownUrlSegment = (
  text: string,
  url: string,
  currentUserId?: string,
): TextLikePreviewSegment => {
  if (url.startsWith('xyne://')) {
    const mentionTargetId = url.startsWith(MENTION_USER_SCHEME)
      ? decodeMentionId(url.slice(MENTION_USER_SCHEME.length))
      : null;
    const isBroadcastMention = url.startsWith(MENTION_BROADCAST_SCHEME);
    return {
      text,
      kind: 'mention',
      ...(isBroadcastMention || (mentionTargetId && mentionTargetId === currentUserId)
        ? { mentionsYou: true }
        : {}),
    };
  }
  return { text, kind: 'link', url };
};

const getPreviewMarkdown = (summary: InitialMessageSummary, currentUserId?: string): string => {
  if (!summary) return '';
  if (summary.visibleTo && currentUserId && summary.visibleTo !== currentUserId) return '';

  const forwarded =
    summary.msgType === MessageType.FORWARDED ? parseForwardedMessageXml(summary.content) : null;
  const rawHtml = forwarded?.optionalText || forwarded?.content || summary.content || '';

  // Keep the paint model canonical even when the stored message is already
  // Markdown or came through a legacy conversion path. Every renderer consumes
  // this same value, so list hierarchy cannot diverge between platforms.
  return normalizeMarkdownListIndentation(htmlToMD(rawHtml));
};

const getInlinePreviewMarkdown = (markdown: string): string | undefined => {
  const bodyTextOutsideLinks = markdown.replace(MARKDOWN_LINK_PATTERN, ' ');
  if (/[A-Za-z0-9]_[A-Za-z0-9]/.test(bodyTextOutsideLinks)) return undefined;
  return markdown.trim() && canRenderInlineRich(markdown) ? markdown : undefined;
};

const getPreviewSegmentsFromMarkdown = (
  markdown: string,
  currentUserId?: string,
): PaintPreviewSegment[] => {
  if (!markdown.trim()) return [];
  const segments: PaintPreviewSegment[] = [];
  let cursor = 0;

  for (const match of markdown.matchAll(MARKDOWN_LINK_PATTERN)) {
    const matchIndex = match.index ?? 0;
    if (matchIndex > cursor) {
      appendTextSegment(segments, inlinePlainText(markdown.slice(cursor, matchIndex)));
    }
    const text = inlinePlainText(match[1] ?? '').trim();
    const segment = getMarkdownUrlSegment(text, match[2] ?? '', currentUserId);
    if (segment.kind === 'link') {
      appendTextSegment(segments, segment.text, segment.kind, { url: segment.url });
    } else {
      appendTextSegment(
        segments,
        segment.text,
        segment.kind,
        segment.kind === 'mention' ? { mentionsYou: segment.mentionsYou } : undefined,
      );
    }
    cursor = matchIndex + match[0].length;
  }

  if (cursor < markdown.length) {
    appendTextSegment(segments, inlinePlainText(markdown.slice(cursor)));
  }

  return segments.length > 0 ? segments : [{ text: stripToPlainText(markdown), kind: 'text' }];
};

const getPreviewSegments = (markdown: string, currentUserId?: string): PaintPreviewSegment[] => {
  if (!markdown.trim()) return [];
  const emojiAwareSegments = parseCustomEmojiMarkdownSegments(markdown).flatMap(segment => {
    if (segment.type === 'customEmoji') {
      return [
        {
          text: segment.name ? `:${segment.name}:` : '',
          kind: 'emoji' as const,
          emojiId: segment.emojiId,
          name: segment.name,
          ...(segment.uri ? { uri: segment.uri } : {}),
        },
      ];
    }
    return getPreviewSegmentsFromMarkdown(segment.markdown, currentUserId);
  });
  const segments =
    emojiAwareSegments.length > 0
      ? emojiAwareSegments
      : getPreviewSegmentsFromMarkdown(markdown, currentUserId);

  return segments.flatMap(segment => {
    if (segment.kind !== 'text') return segment;
    const next: PaintPreviewSegment[] = [];
    let cursor = 0;
    for (const match of segment.text.matchAll(BARE_URL_PATTERN)) {
      const matchIndex = match.index ?? 0;
      if (matchIndex > cursor) appendTextSegment(next, segment.text.slice(cursor, matchIndex));
      const { url, suffix, trailing } = splitBareUrlCandidate(match[0]);
      appendTextSegment(next, url, 'link', { url });
      if (suffix) appendTextSegment(next, ` ${suffix}${trailing}`);
      else if (trailing) appendTextSegment(next, trailing);
      cursor = matchIndex + match[0].length;
    }
    if (cursor < segment.text.length) appendTextSegment(next, segment.text.slice(cursor));
    return next.length > 0 ? next : segment;
  });
};

const normalizePreviewUrl = (url: string | null | undefined): string | null => {
  const trimmed = splitBareUrlCandidate(url?.trim() ?? '').url;
  if (!/^https?:\/\//i.test(trimmed)) return null;
  return trimmed;
};

const buildLinkPreviewFromUrl = ({
  url,
  label,
  metadata,
  needsMetadataFetch,
}: {
  url: string;
  label?: string | null | undefined;
  metadata?: ReturnType<typeof parseLinkPreviewMd> | null | undefined;
  needsMetadataFetch?: boolean | undefined;
}): LinkPreview | null => {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.replace(/^www\./i, '');
    const title = metadata?.title?.trim() || (label && label !== url ? label : host);
    const hasMetadata = !!(metadata?.title || metadata?.image || metadata?.description);
    return {
      url,
      host,
      title,
      description: metadata?.description?.trim() || url,
      ...(metadata?.siteName ? { siteName: metadata.siteName } : {}),
      ...(metadata?.image ? { image: metadata.image } : {}),
      ...(metadata?.favicon ? { favicon: metadata.favicon } : {}),
      ...(needsMetadataFetch ? { needsMetadataFetch: true } : {}),
      source: hasMetadata ? 'metadata' : needsMetadataFetch ? 'extracted' : 'stored',
      status: needsMetadataFetch ? 'needsMetadata' : 'ready',
    };
  } catch {
    return null;
  }
};

const getLinkPreview = (
  summary: InitialMessageSummary,
  currentUserId?: string,
): LinkPreview | null => {
  if (!summary) return null;
  if (summary.visibleTo && currentUserId && summary.visibleTo !== currentUserId) return null;

  const storedMetadata = parseLinkPreviewMd(summary.link_preview_md);
  if (storedMetadata?.url) {
    const preview = buildLinkPreviewFromUrl({
      url: storedMetadata.url,
      metadata: storedMetadata,
    });
    if (preview) return preview;
  }

  const markdown = getPreviewMarkdown(summary, currentUserId);
  let label: string | null = null;
  let url = null as string | null;

  for (const match of markdown.matchAll(MARKDOWN_LINK_PATTERN)) {
    const candidateUrl = normalizePreviewUrl(match[2]);
    if (candidateUrl) {
      url = candidateUrl;
      label = inlinePlainText(match[1] ?? '').trim() || null;
      break;
    }
  }

  if (!url) {
    const match = markdown.match(BARE_URL_PATTERN);
    url = normalizePreviewUrl(match?.[0]);
  }

  if (!url) return null;

  return buildLinkPreviewFromUrl({ url, label, needsMetadataFetch: true });
};

const createKnownMentionSplitter = (
  identities: Record<string, PaintIdentity>,
  currentUserId?: string,
): KnownMentionSplitter => {
  const mentionNames = Array.from(
    new Set(
      Object.values(identities)
        .map(identity => identity.name?.trim())
        .filter((name): name is string => !!name),
    ),
  ).sort((a, b) => b.length - a.length);
  if (mentionNames.length === 0) return segments => segments;

  const mentionPattern = new RegExp(`@(${mentionNames.map(escapeRegExp).join('|')})`, 'g');
  const identityByName = new Map<string, PaintIdentity>();
  for (const identity of Object.values(identities)) {
    const name = identity.name?.trim();
    if (name) identityByName.set(name, identity);
  }

  return segments =>
    segments.flatMap(segment => {
      if (segment.kind !== 'text') return segment;
      const next: PaintPreviewSegment[] = [];
      let cursor = 0;
      for (const match of segment.text.matchAll(mentionPattern)) {
        const matchIndex = match.index ?? 0;
        if (matchIndex > cursor) {
          appendTextSegment(next, segment.text.slice(cursor, matchIndex));
        }
        const matchedName = match[1] ?? '';
        const identity = identityByName.get(matchedName);
        appendTextSegment(next, match[0], 'mention', {
          mentionsYou: !!identity?.id && identity.id === currentUserId,
        });
        cursor = matchIndex + match[0].length;
      }
      if (cursor < segment.text.length) appendTextSegment(next, segment.text.slice(cursor));
      return next.length > 0 ? next : segment;
    });
};

const getParentPreviewText = (parent: ParentMessageSummary | null): string | null => {
  return parent ? getParentMessagePreviewText(parent) : null;
};

const getParentConversationId = (parent: ParentMessageSummary | null): string | null => {
  const parentConversationId = parent?.conversationId?.trim();
  return parentConversationId ? parentConversationId : null;
};

const getReplyPreviewUserIds = (repliesMd: string | null | undefined): string[] => {
  const parsed = parseRepliesMd(repliesMd ?? null);
  return parsed.repliers
    .slice(-3)
    .filter((id): id is string => typeof id === 'string' && id.length > 0);
};

const labelForStatusV2 = (statusV2: TicketStatusV2 | undefined): string => {
  switch (statusV2) {
    case TicketStatusV2.TODO:
      return 'To do';
    case TicketStatusV2.STARTED:
      return 'In progress';
    case TicketStatusV2.PAUSED:
      return 'Paused';
    case TicketStatusV2.CANCELLED:
      return 'Cancelled';
    case TicketStatusV2.COMPLETED:
      return 'Completed';
    default:
      return 'Open';
  }
};

const getIdentitySnapshot = (currentUser?: User): DmIdentitySnapshot => {
  const identities: DmIdentitySnapshot = {};
  for (const user of stateMachineActor.getSnapshot().context.users) {
    identities[user.id] = {
      id: user.id,
      name: user.name,
      picture: user.picture,
    };
  }

  if (currentUser?.id) {
    identities[currentUser.id] = {
      id: currentUser.id,
      name: currentUser.name ?? 'You',
      picture: currentUser.picture,
    };
  }

  return identities;
};

const getSenderPaintModel = (
  senderId: string,
  currentUser: User | undefined,
  identities: Record<string, PaintIdentity>,
): SenderPaintModel => {
  if (!senderId) return SYSTEM_SENDER;
  const identity = identities[senderId];
  const isCurrentUser = !!currentUser?.id && senderId === currentUser.id;
  return {
    senderId,
    displayName: identity?.name ?? (isCurrentUser ? (currentUser?.name ?? 'You') : 'Unknown User'),
    avatarUri: identity?.picture ?? null,
    isCurrentUser,
  };
};

const reconcileSenderPaintModel = (
  senderPaintModel: SenderPaintModel,
  currentUser: User | undefined,
  identities: Record<string, PaintIdentity>,
): SenderPaintModel => {
  const nextSenderPaintModel = getSenderPaintModel(
    senderPaintModel.senderId,
    currentUser,
    identities,
  );

  if (
    nextSenderPaintModel.displayName === senderPaintModel.displayName &&
    nextSenderPaintModel.avatarUri === senderPaintModel.avatarUri &&
    nextSenderPaintModel.isCurrentUser === senderPaintModel.isCurrentUser
  ) {
    return senderPaintModel;
  }

  return nextSenderPaintModel;
};

const getTicketPreview = (
  ticketMd: string | null | undefined,
  currentUser: User | undefined,
  identities: Record<string, PaintIdentity>,
): TicketPreview | null => {
  const ticket = parseTicketMd(ticketMd ?? null);
  if (!ticket) return null;
  const xyneId = ticket.xyneId?.trim() ?? '';
  const ticketId = xyneId || 'TICKET';

  return {
    ticketId,
    title: ticket.title?.trim() || stripToPlainText(ticket.description ?? '') || 'Untitled ticket',
    description: stripToPlainText(ticket.description ?? '') || null,
    statusLabel: ticket.stageName?.trim() || labelForStatusV2(ticket.statusV2 ?? undefined),
    priority: typeof ticket.priority === 'string' ? ticket.priority.toUpperCase() : null,
    assignee: ticket.assignedTo
      ? getSenderPaintModel(ticket.assignedTo, currentUser, identities)
      : null,
  };
};

const getMediaPlaceholder = (conversation: ConversationItem): MediaPlaceholder | null => {
  const attachments = activeAttachmentsOf(conversation.initialMessageAttachments);
  if (attachments.length === 0) return null;

  const kinds = new Set(
    attachments.map(
      attachment =>
        getAttachmentMediaKind(attachment.mimetype, attachment.originalFilename) ?? 'file',
    ),
  );
  const firstMediaAttachment = attachments.find(
    attachment => getAttachmentMediaKind(attachment.mimetype, attachment.originalFilename) !== null,
  );
  const firstAttachment = firstMediaAttachment ?? attachments[0];
  const previewAttachmentKind = firstMediaAttachment
    ? getAttachmentMediaKind(firstMediaAttachment.mimetype, firstMediaAttachment.originalFilename)
    : null;

  const metadata = (firstAttachment?.metadata ?? null) as {
    width?: number;
    height?: number;
    duration?: number;
    thumbUri?: string;
  } | null;

  return {
    attachmentCount: attachments.length,
    attachments: attachments.map(attachment => ({
      id: attachment.id,
      mimetype: attachment.mimetype,
      ...(attachment.originalFilename ? { originalFilename: attachment.originalFilename } : {}),
      ...(typeof attachment.size === 'number' ? { size: attachment.size } : {}),
    })),
    mediaKind:
      kinds.size > 1
        ? 'mixed'
        : ((Array.from(kinds)[0] ?? 'file') as MediaPlaceholder['mediaKind']),
    previewAttachmentId: firstMediaAttachment?.id ?? firstAttachment?.id ?? null,
    previewAttachmentKind,
    aspectRatio:
      typeof metadata?.width === 'number' &&
      typeof metadata?.height === 'number' &&
      metadata.height > 0
        ? metadata.width / metadata.height
        : null,
    cachedThumbUri: typeof metadata?.thumbUri === 'string' ? metadata.thumbUri : null,
    durationSeconds:
      typeof metadata?.duration === 'number' && Number.isFinite(metadata.duration)
        ? metadata.duration
        : null,
    firstAttachmentName: firstAttachment?.originalFilename ?? null,
  };
};

const getEmojiSlots = (segments: readonly PaintPreviewSegment[]): readonly ChatPaintEmojiSlot[] =>
  segments.flatMap((segment, index) =>
    segment.kind === 'emoji'
      ? [{ index, reservedWidthPx: CHAT_PAINT_INLINE_EMOJI_RESERVED_WIDTH_PX }]
      : [],
  );

const getMediaGeometry = (
  mediaPlaceholder: MediaPlaceholder | null,
): ChatPaintMediaGeometry | undefined => {
  if (!mediaPlaceholder || mediaPlaceholder.mediaKind === 'none') return undefined;
  const isFileOnly = mediaPlaceholder.mediaKind === 'file';
  return {
    aspectRatio: mediaPlaceholder.aspectRatio ?? CHAT_PAINT_DEFAULT_MEDIA_ASPECT_RATIO,
    reservedHeightPx: isFileOnly
      ? CHAT_PAINT_FILE_ATTACHMENT_HEIGHT_PX
      : CHAT_PAINT_MEDIA_GRID_HEIGHT_PX,
    ...(mediaPlaceholder.cachedThumbUri ? { thumbUri: mediaPlaceholder.cachedThumbUri } : {}),
  };
};

const getParentPreview = (
  parentMessage: ParentMessageSummary | null,
  parentPreviewText: string | null,
  segments: PaintPreviewSegment[],
): ChatPaintParentPreview | undefined =>
  parentMessage && parentPreviewText
    ? {
        messageId: parentMessage.messageId,
        reservedHeightPx: CHAT_PAINT_PARENT_PREVIEW_HEIGHT_PX,
        text: parentPreviewText,
        segments,
        customEmojiIds: getCustomEmojiIds(segments),
      }
    : undefined;

const getCollapseModel = (
  markdown: string,
  plainPreviewText: string,
  kind: ChatPaintRowKind,
): ChatPaintCollapseModel => {
  if (!plainPreviewText.trim()) {
    return {
      isCollapsible: false,
      collapsedLines: LONG_MESSAGE_MAX_COLLAPSED_LINES,
    };
  }

  const model = getLongMessageCollapseModel({
    markdown,
    maxWidth: CHAT_PAINT_TEXT_CONTAINER_WIDTH_PX,
    viewportHeight: CHAT_PAINT_COLLAPSE_VIEWPORT_HEIGHT_PX,
  });
  return {
    isCollapsible: shouldCollapseMessageBody(model, kind),
    collapsedLines: model.collapsedNumberOfLines,
  };
};

const getRowType = (
  kind: ChatPaintRowKind,
  ticketPreview: TicketPreview | null,
  mediaPlaceholder: MediaPlaceholder | null,
): ChatPaintRowType => {
  if (kind === 'SYSTEM') return 'system';
  if (ticketPreview) return 'ticket';
  if (mediaPlaceholder) return 'media';
  return 'message';
};

const hasSpecialSystemMessageUi = (metadataJson: string | null | undefined): boolean => {
  if (!metadataJson) return false;
  try {
    const metadata = JSON.parse(metadataJson) as Record<string, unknown>;
    return (
      metadata['isCallMessage'] === true || metadata['messageSubtype'] === 'user_not_in_channel'
    );
  } catch {
    return false;
  }
};

const isTicketActivityMessage = (metadataJson: string | null | undefined): boolean => {
  if (!metadataJson) return false;
  try {
    const metadata = JSON.parse(metadataJson) as Record<string, unknown>;
    return metadata['isTicketActivity'] === true;
  } catch {
    return false;
  }
};

const getRecordingMeta = (
  metadataJson: string | null | undefined,
): Omit<RecordingPreview, 'title'> | null => {
  if (!metadataJson) return null;
  try {
    const metadata = JSON.parse(metadataJson) as Record<string, unknown>;
    if (metadata['isRecordingMessage'] !== true || typeof metadata['callId'] !== 'string') {
      return null;
    }
    return {
      callId: metadata['callId'],
      durationMs: typeof metadata['durationMs'] === 'number' ? metadata['durationMs'] : 0,
    };
  } catch {
    return null;
  }
};

const shouldShowIdentity = (
  row: Pick<ChatPaintRow, 'createdAt' | 'rowKind' | 'senderPaintModel'>,
  channelType: ChannelScopeType | undefined,
  previousMessageRow: ChatPaintRow | null,
): boolean => {
  if (
    channelType === ChannelScopeType.DM ||
    row.rowKind === 'CURRENT_USER' ||
    row.rowKind === 'SYSTEM'
  ) {
    return false;
  }

  if (row.rowKind === 'BOT') {
    return true;
  }

  const sameSenderAsPrevious =
    previousMessageRow &&
    previousMessageRow.senderPaintModel.senderId === row.senderPaintModel.senderId &&
    previousMessageRow.rowKind === row.rowKind &&
    format(previousMessageRow.createdAt, 'yyyy-MM-dd') === format(row.createdAt, 'yyyy-MM-dd');

  return !sameSenderAsPrevious;
};

const normalizeChatPaintRowLayout = (
  row: ChatPaintRow,
  channelType: ChannelScopeType | undefined,
  previousMessageRow: ChatPaintRow | null,
): ChatPaintRow => {
  // `showSenderName` is anchored to the FIRST message of a consecutive group
  // (look-backward). `showAvatar` is intentionally NOT recomputed here — it is
  // owned exclusively by `applyTrailingGroupAvatars`, which runs after the full
  // row list is built and anchors the avatar to the LAST message of a group
  // (the bubble layout is `items-end`, so the avatar belongs next to the newest
  // message). Recomputing it here would clobber that trailing placement and
  // break reference-equality on no-op incremental rebuilds.
  const showIdentity = shouldShowIdentity(row, channelType, previousMessageRow);
  const showSenderName = row.rowKind === 'TICKET' || !!row.ticketPreview ? false : showIdentity;
  if (row.showSenderName === showSenderName) {
    return row;
  }

  return {
    ...row,
    showSenderName,
  };
};

/**
 * Anchors the avatar to the LAST message of a consecutive same-sender group
 * (look-ahead), since chat bubbles are laid out with `items-end`. This is the
 * single source of truth for `showAvatar`; it runs once over the fully built
 * row list (build, incremental, and cache-restore paths) so the placement is
 * correct regardless of how the rows were produced.
 *
 * Mutates `rows` in place, replacing a row object ONLY when its `showAvatar`
 * value actually changes — this preserves reference-equality for unchanged rows
 * so the incremental early-return and list recycling keep working. `showAvatar`
 * does not affect row height (the avatar and its placeholder spacer are both
 * 24px), so no height/measurement invalidation is required.
 */
export const applyTrailingGroupAvatars = (
  rows: ChatPaintRow[],
  channelType: ChannelScopeType | undefined,
): ChatPaintRow[] => {
  if (channelType === ChannelScopeType.DM) {
    for (let index = 0; index < rows.length; index += 1) {
      const row = rows[index];
      if (row?.showAvatar) rows[index] = { ...row, showAvatar: false };
    }
    return rows;
  }

  // The nearest NEWER message row (skipping SYSTEM rows, which never break a
  // group — mirroring the look-backward cursor in the build loops).
  let nextMessageRow: ChatPaintRow | null = null;

  for (let index = rows.length - 1; index >= 0; index -= 1) {
    const row = rows[index];
    if (!row) continue;

    // SYSTEM rows carry no identity and never break a group.
    if (row.rowKind === 'SYSTEM') {
      if (row.showAvatar) rows[index] = { ...row, showAvatar: false };
      continue;
    }

    if (row.rowKind === 'CURRENT_USER') {
      if (row.showAvatar) rows[index] = { ...row, showAvatar: false };
      // CURRENT_USER messages still break a group for older rows.
      nextMessageRow = row;
      continue;
    }

    if (row.rowKind === 'BOT') {
      if (!row.showAvatar) rows[index] = { ...row, showAvatar: true };
      nextMessageRow = row;
      continue;
    }

    const sameSenderAsNext =
      !!nextMessageRow &&
      nextMessageRow.senderPaintModel.senderId === row.senderPaintModel.senderId &&
      nextMessageRow.rowKind === row.rowKind &&
      format(nextMessageRow.createdAt, 'yyyy-MM-dd') === format(row.createdAt, 'yyyy-MM-dd');

    const showAvatar = !sameSenderAsNext;
    if (row.showAvatar !== showAvatar) {
      rows[index] = { ...row, showAvatar };
    }
    nextMessageRow = row;
  }

  return rows;
};

const getReactionPreview = (
  conversation: ConversationItem,
  summary: InitialMessageSummary | null,
): ReactionPreview | null => {
  if (!summary?.messageId) return null;
  const reactionsMd = summary.reactions_md ?? getConversationReactionsMd(conversation);
  if (!reactionsMd) return null;
  const raw = reactionsMdToRawReactions(reactionsMd, summary.messageId);
  const total = totalReactionCount(raw);
  if (total === 0) return null;
  const groups = groupReactionsForPill(raw);
  if (groups.length === 0) return null;
  return {
    messageId: summary.messageId,
    totalCount: total,
    groups,
    reactions: raw,
  };
};

const getReplyPreview = (
  conversation: ConversationItem,
  parentMessage: ParentMessageSummary | null,
  channelId: string,
): ReplyPreview | null => {
  const isThreadChildRow = !!getParentConversationId(parentMessage);
  const count = isThreadChildRow ? 0 : (conversation.replyCount ?? 0);
  if (count <= 0) return null;
  const latestReplierIds = getReplyPreviewUserIds(conversation.replies_md ?? null);
  const canOpenThread = !!channelId && !!conversation.conversationId;
  return { count, latestReplierIds, canOpenThread };
};

const getMediaPreview = (mediaPlaceholder: MediaPlaceholder | null): MediaPreview | null => {
  if (!mediaPlaceholder || mediaPlaceholder.mediaKind === 'none') return null;
  const isFileOnly = mediaPlaceholder.mediaKind === 'file';
  return {
    attachmentId: mediaPlaceholder.previewAttachmentId,
    kind: mediaPlaceholder.mediaKind as MediaPreview['kind'],
    mime: null,
    filename: mediaPlaceholder.firstAttachmentName,
    reservedHeightPx: isFileOnly
      ? CHAT_PAINT_FILE_ATTACHMENT_HEIGHT_PX
      : CHAT_PAINT_MEDIA_GRID_HEIGHT_PX,
    aspectRatio: mediaPlaceholder.aspectRatio ?? CHAT_PAINT_DEFAULT_MEDIA_ASPECT_RATIO,
    cachedThumbUri: mediaPlaceholder.cachedThumbUri,
    durationSeconds: mediaPlaceholder.durationSeconds,
    attachmentCount: mediaPlaceholder.attachmentCount,
    previewAttachmentKind: mediaPlaceholder.previewAttachmentKind,
  };
};

const getCustomEmojiIds = (segments: readonly PaintPreviewSegment[]): string[] =>
  Array.from(
    new Set(
      segments
        .filter(
          (segment): segment is Extract<PaintPreviewSegment, { kind: 'emoji' }> =>
            segment.kind === 'emoji' && !!segment.emojiId,
        )
        .map(segment => segment.emojiId),
    ),
  );

const buildChatPaintRow = ({
  channelId,
  channelType,
  conversation,
  currentUser,
  identities,
  contentSignature,
  splitKnownMentions,
  previousMessageRow,
}: {
  channelId: string;
  channelType?: ChannelScopeType | undefined;
  conversation: ConversationItem;
  currentUser?: User | undefined;
  identities: Record<string, PaintIdentity>;
  contentSignature: string;
  splitKnownMentions: KnownMentionSplitter;
  previousMessageRow: ChatPaintRow | null;
}): ChatPaintRow => {
  const summary = parseInitialMessageMd(conversation.initial_message_md);
  const isDeleted = !!summary?.isDeleted;
  const kind = getConversationKind(summary, currentUser?.id) as ChatPaintRowKind;
  const senderId = summary?.senderId ?? '';
  const senderPaintModel = getSenderPaintModel(senderId, currentUser, identities);
  const ticketPreview = isDeleted
    ? null
    : getTicketPreview(conversation.ticket_md ?? null, currentUser, identities);
  const recordingMeta = isDeleted ? null : getRecordingMeta(summary?.metadata);
  const allAttachmentsDeleted =
    !isDeleted && hasSoftDeletedAttachmentsOnly(conversation.initialMessageAttachments);
  const mediaPlaceholder = isDeleted ? null : getMediaPlaceholder(conversation);
  const rowType = getRowType(kind, ticketPreview, mediaPlaceholder);
  const parentMessage = parseParentMessageMd(conversation.parent_message_md ?? null);
  const parentPreviewText = isDeleted ? null : getParentPreviewText(parentMessage);
  const parentPreviewSegments = isDeleted
    ? []
    : ensureSpacingBetweenAdjacentMentions(
        splitKnownMentions(getPreviewSegments(getParentMessagePreviewMarkdown(parentMessage))),
      );
  const parentConversationId = getParentConversationId(parentMessage);
  const shouldSuppressBody = isDeleted || kind === 'TICKET' || !!ticketPreview || !!recordingMeta;
  // Compute markdown once — htmlToMD is expensive and was previously called 3× per row.
  const fullMarkdown = isDeleted
    ? DELETED_MESSAGE_PLACEHOLDER
    : shouldSuppressBody
      ? ''
      : (getPreviewMarkdown(summary, currentUser?.id) ?? '');
  const rawPreviewText = isDeleted
    ? DELETED_MESSAGE_PLACEHOLDER
    : shouldSuppressBody
      ? ''
      : stripMarkdownForPreview(fullMarkdown);
  const rawPreviewSegments = isDeleted
    ? [{ text: DELETED_MESSAGE_PLACEHOLDER, kind: 'text' as const }]
    : shouldSuppressBody
      ? []
      : ensureSpacingBetweenAdjacentMentions(
          splitKnownMentions(getPreviewSegments(fullMarkdown, currentUser?.id)),
        );
  const linkPreview = shouldSuppressBody ? null : getLinkPreview(summary, currentUser?.id);

  const recordingPreview: RecordingPreview | null = recordingMeta
    ? {
        ...recordingMeta,
        title: stripMarkdownForPreview(getPreviewMarkdown(summary, currentUser?.id) ?? '').trim(),
      }
    : null;
  const plainPreviewText = rawPreviewText;
  const previewSegments = rawPreviewSegments;
  const inlineMarkdown = shouldSuppressBody ? undefined : getInlinePreviewMarkdown(fullMarkdown);
  const emojiSlots = isDeleted ? [] : getEmojiSlots(previewSegments);
  const media = isDeleted ? undefined : getMediaGeometry(mediaPlaceholder);
  const parentPreview = isDeleted
    ? undefined
    : getParentPreview(parentMessage, parentPreviewText, parentPreviewSegments);
  const collapse = isDeleted
    ? { isCollapsible: false, collapsedLines: 1 }
    : getCollapseModel(fullMarkdown, plainPreviewText, kind);
  const collapsedPreviewText = collapse.isCollapsible
    ? markdownToCollapsedPreviewText(plainPreviewText)
    : plainPreviewText;
  const showIdentity = shouldShowIdentity(
    {
      createdAt: conversation.createdAt,
      rowKind: kind,
      senderPaintModel,
    },
    channelType,
    previousMessageRow,
  );
  const isThreadChildRow = !!parentConversationId;
  const replyCount = isThreadChildRow ? 0 : (conversation.replyCount ?? 0);
  const replyPreviewUserIds = isThreadChildRow
    ? []
    : getReplyPreviewUserIds(conversation.replies_md ?? null);
  const replyAvatarSlots = Math.min(3, replyPreviewUserIds.length);
  const reactionPreview = isDeleted ? null : getReactionPreview(conversation, summary);
  const isTicketActivity = isTicketActivityMessage(summary?.metadata);
  const replyPreview = getReplyPreview(conversation, parentMessage, channelId);
  const mediaPreview = getMediaPreview(mediaPlaceholder);
  const customEmojiIds = getCustomEmojiIds(previewSegments);
  const isVisibleToCurrentUser = !summary?.visibleTo || summary.visibleTo === currentUser?.id;
  const reactionSummaryCount = reactionPreview?.totalCount ?? 0;
  const baseEstimatedHeight = estimateChatPaintRowHeight({
    previewText: plainPreviewText,
    previewSegments,
    rowType,
    showSenderName: ticketPreview ? false : showIdentity,
    replyCount,
    hasTicketPreview: !!ticketPreview,
    hasLinkPreview: !!linkPreview,
    hasRecordingPreview: !!recordingPreview,
    hasMediaPlaceholder: !!mediaPlaceholder,
    hasParentPreview: !!parentPreviewText,
    emojiSlots,
    media,
    replyAvatarSlots,
    parentPreview,
    collapse,
    reactionSummaryCount,
  });
  const estimatedHeight =
    rowType === 'system' && hasSpecialSystemMessageUi(summary?.metadata)
      ? Math.max(baseEstimatedHeight, SPECIAL_SYSTEM_ROW_ESTIMATED_HEIGHT)
      : baseEstimatedHeight;

  const body: ChatPaintBody = {
    markdown: fullMarkdown,
    plainText: plainPreviewText,
    segments: previewSegments,
    customEmojiIds,
    collapse,
    collapsedPreviewText,
    isVisibleToCurrentUser,
    ...(inlineMarkdown ? { inlineMarkdown } : {}),
  };

  return {
    rowId: conversation.conversationId,
    conversationId: conversation.conversationId,
    messageId: summary?.messageId ?? null,
    channelId,
    rowType,
    rowKind: kind,
    createdAt: conversation.createdAt,
    timeLabel: format(conversation.createdAt, 'h:mm a'),
    estimatedHeight,
    senderPaintModel,
    body,
    reactionPreview,
    replyPreview,
    mediaPreview,
    // v13 backward-compat aliases
    plainPreviewText,
    collapsedPreviewText,
    ...(inlineMarkdown ? { inlineMarkdown } : {}),
    ...(currentUser?.id ? { currentUserId: currentUser.id } : {}),
    previewSegments,
    showAvatar: showIdentity,
    showSenderName: ticketPreview ? false : showIdentity,
    isTicketActivity,
    isDeleted,
    replyCount,
    replyPreviewUserIds,
    reactionSummaryCount,
    ticketPreview,
    linkPreview,
    recordingPreview,
    mediaPlaceholder,
    allAttachmentsDeleted,
    parentPreviewText,
    parentConversationId,
    emojiSlots,
    media,
    replyAvatarSlots,
    parentPreview,
    collapse,
    contentSignature,
  };
};

export const buildChatPaintRows = ({
  channelId,
  channelType,
  conversations,
  currentUser,
}: BuildChatPaintRowsArgs): ChatPaintRow[] => {
  if (!Array.isArray(conversations) || conversations.length === 0) {
    return [];
  }
  const identities = getIdentitySnapshot(currentUser);
  const splitKnownMentions = createKnownMentionSplitter(identities, currentUser?.id);
  const rows: ChatPaintRow[] = [];
  let previousMessageRow: ChatPaintRow | null = null;

  for (const conversation of conversations) {
    const contentSignature = computeConversationPaintSignature(conversation, {
      channelId,
      currentUserId: currentUser?.id,
    });
    const row = buildChatPaintRow({
      channelId,
      channelType,
      conversation,
      currentUser,
      identities,
      contentSignature,
      splitKnownMentions,
      previousMessageRow,
    });

    rows.push(row);
    previousMessageRow = row.rowKind === 'SYSTEM' ? previousMessageRow : row;
  }

  return applyTrailingGroupAvatars(rows, channelType);
};

export const normalizeChatPaintRowsForCurrentIdentity = (
  rows: ReadonlyArray<ChatPaintRow>,
  currentUser: User | undefined,
  channelType: ChannelScopeType | undefined,
): ChatPaintRow[] => {
  if (rows.length === 0) return [];
  const identities = getIdentitySnapshot(currentUser);
  let didChange = false;

  const normalizedRows = rows.map(row => {
    const senderPaintModel = reconcileSenderPaintModel(
      row.senderPaintModel,
      currentUser,
      identities,
    );
    const ticketAssignee = row.ticketPreview?.assignee
      ? reconcileSenderPaintModel(row.ticketPreview.assignee, currentUser, identities)
      : null;
    const ticketPreview =
      row.ticketPreview && ticketAssignee !== row.ticketPreview.assignee
        ? {
            ...row.ticketPreview,
            assignee: ticketAssignee,
          }
        : row.ticketPreview;

    if (senderPaintModel === row.senderPaintModel && ticketPreview === row.ticketPreview) {
      return row;
    }

    didChange = true;
    return {
      ...row,
      senderPaintModel,
      ticketPreview,
    };
  });

  // Cached rows may have been built before trailing-avatar placement existed
  // (older cache versions), so re-anchor avatars on restore. This works on a
  // copy when nothing else changed, to avoid mutating the caller's array.
  const restoredRows = didChange ? normalizedRows : rows.slice();
  return applyTrailingGroupAvatars(restoredRows, channelType);
};

export const buildChatPaintRowsIncremental = ({
  channelId,
  channelType,
  conversations,
  currentUser,
  previousState,
  precomputedSignatures,
}: BuildChatPaintRowsIncrementalArgs): IncrementalChatPaintRowsState => {
  if (!Array.isArray(conversations) || conversations.length === 0) {
    return {
      rows: [],
      rowsByConversationId: new Map(),
      signaturesByConversationId: new Map(),
    };
  }

  const identities = getIdentitySnapshot(currentUser);
  const splitKnownMentions = createKnownMentionSplitter(identities, currentUser?.id);
  const previousRowsById = previousState?.rowsByConversationId ?? new Map<string, ChatPaintRow>();

  const rows: ChatPaintRow[] = [];
  const signaturesByConversationId = new Map<string, ChatPaintRowBuildSignature>();
  let previousMessageRow: ChatPaintRow | null = null;
  let built = 0;

  for (const conversation of conversations) {
    const signature =
      precomputedSignatures?.get(conversation.conversationId) ??
      computeConversationPaintSignature(conversation, {
        channelId,
        currentUserId: currentUser?.id,
      });
    const previousSignature = previousState?.signaturesByConversationId.get(
      conversation.conversationId,
    );
    const previousRow = previousRowsById.get(conversation.conversationId);
    const signatureMatches = previousRow && previousSignature === signature;
    const row: ChatPaintRow = signatureMatches
      ? normalizeChatPaintRowLayout(previousRow, channelType, previousMessageRow)
      : buildChatPaintRow({
          channelId,
          channelType,
          conversation,
          currentUser,
          identities,
          contentSignature: signature,
          splitKnownMentions,
          previousMessageRow,
        });

    if (!signatureMatches) {
      built += 1;
    }

    rows.push(row);
    signaturesByConversationId.set(conversation.conversationId, signature);
    previousMessageRow = row.rowKind === 'SYSTEM' ? previousMessageRow : row;
  }

  // Anchor avatars to the last message of each group before the no-op
  // short-circuit below so reference-equality reflects the final placement.
  applyTrailingGroupAvatars(rows, channelType);

  // Snapshot the finalized row objects. Avatar normalization can replace rows,
  // so taking this map before that pass leaves the incremental lookup one wave
  // behind the array used by LegendList.
  const rowsByConversationId = new Map<string, ChatPaintRow>();
  for (const row of rows) {
    rowsByConversationId.set(row.conversationId, row);
  }

  if (
    previousState &&
    built === 0 &&
    rows.length === previousState.rows.length &&
    rows.every((row, index) => row === previousState.rows[index])
  ) {
    return previousState;
  }

  return {
    rows,
    rowsByConversationId,
    signaturesByConversationId,
  };
};
