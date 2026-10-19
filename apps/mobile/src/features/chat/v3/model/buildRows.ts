import type { ChatRow, ChatRowType, MessageRowModel, ReactionPreview } from './chatRow.types';
import { buildBody, INLINE_EMOJI_RESERVED_WIDTH_PX } from './buildBody';
import { applyGrouping } from './buildGrouping';
import { buildMedia } from './buildMedia';
import { buildForwarded, buildLinkPreview, buildParentPreview } from './buildPreviews';
import { callPreviewFromMetadata } from './callPreview';
import { contentSignature } from './contentSignature';
import { dayKey } from './dayKey';
import { nonParticipantPreviewFromMetadata } from './nonParticipant';
import { rowsAreEqual } from './rowEquals';
import { parseReactionsMd } from './reactions';
import { rowKindFor, type BuildRowsContext, type ConversationInput } from './conversationInput';
import { insertUnreadDivider } from './unreadDivider';
import { getUserColorIndex } from './text/getUserColor';

const pad2 = (n: number): string => `${n}`.padStart(2, '0');

const timeLabel = (createdAt: number): string => {
  const d = new Date(createdAt);
  const hours = d.getHours();
  const ampm = hours >= 12 ? 'PM' : 'AM';
  const hour12 = hours % 12 || 12;
  return `${hour12}:${pad2(d.getMinutes())} ${ampm}`;
};

const rowTypeFor = (
  model: Pick<MessageRowModel, 'rowKind' | 'ticketPreview' | 'mediaPreview'>,
): ChatRowType => {
  if (model.rowKind === 'SYSTEM') return 'system';
  if (model.ticketPreview) return 'ticket';
  if (model.mediaPreview) return 'media';
  return 'message';
};

const senderDisplayNameFor = (input: ConversationInput, currentUserId: string): string => {
  const displayName = input.senderDisplayName.trim();
  if (displayName) return displayName;
  if (!input.senderId) return 'System';
  return input.senderId === currentUserId ? 'You' : 'Unknown User';
};

const reactions = (input: ConversationInput): ReactionPreview | null => {
  if (!input.reactionsMd || !input.messageId) return null;
  const parsed = parseReactionsMd(input.reactionsMd);
  const parsedEntries = Object.entries(parsed);
  if (parsedEntries.length > 0) {
    const items: ReactionPreview['reactions'] = [];
    const groups: ReactionPreview['groups'] = [];
    for (const [emojiName, userIds] of parsedEntries) {
      groups.push({
        emojiName,
        count: userIds.length,
        earliestTimestamp: input.createdAt,
      });
      for (const userId of userIds) {
        items.push({
          createdAt: input.createdAt,
          emojiName,
          messageId: input.messageId,
          reactionId: `${input.messageId}:${emojiName}:${userId}`,
          userId,
        });
      }
    }
    return {
      messageId: input.messageId,
      totalCount: items.length,
      groups,
      reactions: items,
      md: input.reactionsMd,
    };
  }
  const names = input.reactionsMd
    .split(/[,\n]/)
    .map(name => name.trim())
    .filter(Boolean);
  if (names.length === 0) return null;
  return {
    messageId: input.messageId,
    totalCount: names.length,
    groups: names.map(emojiName => ({ emojiName, count: 1, earliestTimestamp: input.createdAt })),
    reactions: [],
    md: input.reactionsMd,
  };
};

const buildMessage = (input: ConversationInput, ctx: BuildRowsContext): MessageRowModel => {
  const meta = input.metadata;
  const rowKind = rowKindFor(
    input.messageType,
    input.senderId,
    ctx.currentUserId,
    meta,
    input.ticketPreview,
  );
  const body = buildBody(input, rowKind, ctx.currentUserId);
  const mediaPreview = buildMedia(input.attachments);
  const ticketPreview = input.ticketPreview;
  const callPreview = callPreviewFromMetadata(meta);
  const nonParticipantPreview = nonParticipantPreviewFromMetadata(meta, input.channelId);
  const parentPreview = buildParentPreview(input);
  const isThreadChild = !!input.parentConversationId;
  const model: MessageRowModel = {
    conversationId: input.conversationId,
    messageId: input.messageId,
    channelId: input.channelId,
    createdAt: input.createdAt,
    rowType: 'message',
    rowKind,
    messageType: input.messageType,
    sender: {
      senderId: input.senderId,
      displayName: senderDisplayNameFor(input, ctx.currentUserId),
      avatarUri: input.senderAvatarUri,
      colorIndex: getUserColorIndex(input.senderId),
    },
    viewerId: ctx.currentUserId,
    storedHtml: input.storedHtml ?? input.html,
    body,
    reactionPreview: input.isDeleted ? null : reactions(input),
    replyPreview:
      isThreadChild || input.replyCount === 0
        ? null
        : {
            count: input.replyCount,
            latestReplierIds: [...input.latestReplierIds],
            canOpenThread: true,
          },
    mediaPreview,
    ticketPreview,
    callPreview,
    nonParticipantPreview,
    linkPreview: buildLinkPreview(input),
    parentPreview,
    forwarded: buildForwarded(input),
    emojiSlots: body.segments.flatMap((segment, index) =>
      segment.kind === 'emoji' ? [{ index, reservedWidthPx: INLINE_EMOJI_RESERVED_WIDTH_PX }] : [],
    ),
    showAvatar: false,
    showSenderName: false,
    isDm: ctx.channelKind === 'dm',
    isDeleted: input.isDeleted,
    isCall: callPreview !== null,
    isTicketCreation: rowKind === 'TICKET' && meta?.['isTicketActivity'] !== true,
    isShowInChannel: input.showInChannel,
    isTicketActivity: meta?.['isTicketActivity'] === true,
    isPinned: input.isPinned,
    isBookmarked: input.isBookmarked,
    isEdited: input.isEdited,
    isFlowJson: input.isFlowJson || body.flowParts.some(part => part.type === 'flow'),
    timeLabel: timeLabel(input.createdAt),
    contentSignature: contentSignature(input, ctx.currentUserId, ctx.channelKind),
    isExpanded: false,
    isHighlighted: false,
    isEntering: false,
    reminderLabel: null,
    threadReplyCount: 0,
  };
  return { ...model, rowType: rowTypeFor(model) };
};

const insertChrome = (models: readonly MessageRowModel[], ctx: BuildRowsContext): ChatRow[] => {
  const rows: ChatRow[] = [];
  let lastDay: string | null = null;
  for (const model of models) {
    const day = dayKey(model.createdAt);
    if (day !== lastDay) {
      rows.push({ type: 'date', id: `date:${day}`, date: model.createdAt });
      lastDay = day;
    }
    rows.push({ type: 'message', id: model.conversationId, model });
  }
  return insertUnreadDivider(rows, ctx);
};

const reuseUnchanged = (next: ChatRow[], previous: readonly ChatRow[] | undefined): ChatRow[] => {
  if (!previous || previous.length === 0) return next;
  const byId = new Map(
    previous.map(row => [row.type === 'message' ? row.model.conversationId : row.id, row]),
  );
  return next.map(row => {
    const prev = byId.get(row.type === 'message' ? row.model.conversationId : row.id);
    if (!prev || prev.type !== row.type) return row;
    if (row.type !== 'message' || prev.type !== 'message') {
      return rowsAreEqual(prev, row) ? prev : row;
    }
    const same =
      prev.model.contentSignature === row.model.contentSignature &&
      prev.model.showAvatar === row.model.showAvatar &&
      prev.model.showSenderName === row.model.showSenderName;
    if (!same) {
      return row;
    }
    // `buildRows` must stay presentation-free. Expand/highlight/entrance/reminder
    // flags belong to `applyRowPresentation`, owned by the list.
    const leaked =
      prev.model.isExpanded ||
      prev.model.isHighlighted ||
      prev.model.isEntering ||
      prev.model.reminderLabel !== null;
    return leaked ? row : prev;
  });
};

export const buildRows = (
  conversations: readonly ConversationInput[],
  ctx: BuildRowsContext,
): ChatRow[] => {
  const previousById = new Map<string, MessageRowModel>();
  if (ctx.previousRows) {
    for (const row of ctx.previousRows) {
      if (row.type === 'message') {
        previousById.set(row.model.conversationId, row.model);
      }
    }
  }
  const models = applyGrouping(
    conversations.map(item => {
      const previous = previousById.get(item.conversationId);
      if (
        previous &&
        previous.contentSignature === contentSignature(item, ctx.currentUserId, ctx.channelKind)
      ) {
        return {
          ...previous,
          showAvatar: false,
          showSenderName: false,
        };
      }
      return buildMessage(item, ctx);
    }),
    ctx.channelKind,
  );
  return reuseUnchanged(insertChrome(models, ctx), ctx.previousRows);
};
