import type { ChannelKind, ConversationInput } from './conversationInput';
import { callPreviewFromMetadata } from './callPreview';
import { nonParticipantPreviewFromMetadata } from './nonParticipant';

const attachmentStamp = (input: ConversationInput): string =>
  input.attachments
    .map(item =>
      [
        item.id,
        item.mimetype,
        item.originalFilename ?? '',
        item.size ?? '',
        item.width ?? '',
        item.height ?? '',
        item.durationSeconds ?? '',
        item.thumbUri ?? '',
      ].join(':'),
    )
    .join(',');

const ticketStamp = (input: ConversationInput): string => {
  const ticket = input.ticketPreview;
  if (!ticket) {
    return '';
  }
  return [
    ticket.ticketId,
    ticket.title,
    ticket.statusLabel,
    ticket.priority ?? '',
    ticket.description ?? '',
    ticket.assigneeId ?? '',
  ].join(':');
};

const callStamp = (input: ConversationInput): string => {
  const call = callPreviewFromMetadata(input.metadata);
  if (!call) {
    return '';
  }
  return `${call.callId ?? ''}:${call.title}:${call.operation ?? ''}:${call.durationMs ?? ''}`;
};

const nonParticipantStamp = (input: ConversationInput): string => {
  const preview = nonParticipantPreviewFromMetadata(input.metadata, input.channelId);
  if (!preview) {
    return '';
  }
  return `${preview.channelId}:${preview.canAddMembers ? '1' : '0'}:${preview.userIds.join(',')}`;
};

const forwardedStamp = (input: ConversationInput): string => {
  const forwarded = input.forwardedSource;
  if (!forwarded) {
    return '';
  }
  return [
    forwarded.originalSenderId ?? '',
    forwarded.originalCreatedAt ?? '',
    forwarded.originalChannelId ?? '',
    forwarded.originalConversationId ?? '',
    forwarded.originalMessageId ?? '',
    forwarded.originalHtml,
  ].join(':');
};

const classificationStamp = (input: ConversationInput): string => {
  const metadata = input.metadata;
  const hasTicketId =
    metadata !== null && Object.prototype.hasOwnProperty.call(metadata, 'ticketId');
  return [
    metadata?.['isTicketActivity'] === true ? '1' : '0',
    hasTicketId ? '1' : '0',
    hasTicketId ? String(metadata?.['ticketId'] ?? '') : '',
  ].join(':');
};

/** Every ConversationInput field that `buildMessage` reads into paint. */
export const contentSignature = (
  input: ConversationInput,
  viewerId = '',
  channelKind: ChannelKind = 'channel',
): string =>
  [
    input.conversationId,
    input.channelId,
    input.createdAt,
    input.messageId ?? '',
    input.markdown,
    input.html,
    input.storedHtml ?? input.html,
    input.reactionsMd ?? '',
    input.isDeleted ? '1' : '0',
    input.isVisibleToCurrentUser ? '1' : '0',
    attachmentStamp(input),
    input.parentConversationId ?? '',
    input.parentMessageId ?? '',
    input.parentMarkdown ?? '',
    String(input.replyCount),
    input.latestReplierIds.join(','),
    input.isPinned ? '1' : '0',
    input.isBookmarked ? '1' : '0',
    input.isEdited ? '1' : '0',
    input.showInChannel ? '1' : '0',
    ticketStamp(input),
    input.linkUrl ?? '',
    input.linkTitle ?? '',
    input.linkDescription ?? '',
    input.linkSiteName ?? '',
    input.linkImage ?? '',
    input.linkFavicon ?? '',
    input.linkNeedsMetadataFetch ? '1' : '0',
    input.senderId,
    input.senderDisplayName,
    input.senderAvatarUri ?? '',
    input.forwardedFromName ?? '',
    forwardedStamp(input),
    input.isFlowJson ? '1' : '0',
    callStamp(input),
    nonParticipantStamp(input),
    classificationStamp(input),
    input.messageType,
    viewerId,
    channelKind,
  ].join('~');
