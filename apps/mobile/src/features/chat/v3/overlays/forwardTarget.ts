import { AttachmentEntityType, MessageType, type MessageAttachment } from '@xyne/shared';

import type { ParsedInitialMessageForUi } from '@/src/components/chat/message/message.types';
import type { ForwardMessageSheetTarget } from '@/src/components/chat/message-sheet/views/forward-message-view-model';
import type { MessageTypeName } from '../model/chatRow.types';
import type { MessageActionsTarget } from './MessageActionsHost';

const toMsgType = (name: MessageTypeName): MessageType => {
  switch (name) {
    case 'BOT':
      return MessageType.BOT;
    case 'SYSTEM':
      return MessageType.SYSTEM;
    case 'FORWARDED':
      return MessageType.FORWARDED;
    default:
      return MessageType.USER;
  }
};

/** Maps a v3 actions target onto the shared forward sheet. */
export const forwardSheetTargetFor = (
  target: MessageActionsTarget,
  currentUserId: string | undefined,
): ForwardMessageSheetTarget | null => {
  const model = target.row.model;
  const messageId = model.messageId;
  if (!messageId) {
    return null;
  }
  const attachments: readonly MessageAttachment[] = target.attachments.map(item => ({
    id: item.id,
    entityType: AttachmentEntityType.CHAT,
    entityId: messageId,
    workspaceId: '',
    storageProvider: '',
    originalFilename: item.originalFilename ?? '',
    mimetype: item.mimetype,
    size: item.size ?? 0,
    width: null,
    height: null,
    uploadedByUserId: model.sender.senderId,
    createdAt: model.createdAt,
    url: '',
    createdBy: model.sender.senderId,
    metadata: typeof item.durationSeconds === 'number' ? { duration: item.durationSeconds } : null,
    conversationId: model.conversationId,
    channelId: model.channelId,
    thumbnailUrl: null,
    uploadStatus: null,
    isDeleted: false,
    position: null,
  }));
  const initialMessage: ParsedInitialMessageForUi = {
    messageId,
    conversationId: model.conversationId,
    childConversationId: null,
    senderId: model.sender.senderId,
    content: target.html,
    msgType: toMsgType(model.messageType),
    hasAttachment: target.attachments.length > 0,
    edited: model.isEdited,
    isDeleted: model.isDeleted,
    showInChannel: model.isShowInChannel,
    visibleTo: null,
    createdAt: model.createdAt,
    metadata: null,
    nudgeCount: null,
    isSent: true,
    ['reactions_md']: target.reactionsMd,
    ['link_preview_md']: null,
    attachments,
  };
  return {
    conversationId: model.conversationId,
    currentUserId: currentUserId ?? '',
    channelId: model.channelId,
    initialMessage,
  } as ForwardMessageSheetTarget;
};
