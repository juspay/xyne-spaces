import type { AttachmentInput } from '../model/conversationInput';
import type { ChatMessageRow, MediaItem } from '../model/chatRow.types';
import type { MessageActionsTarget } from './MessageActionsHost';

const actionAttachmentFrom = (item: MediaItem): AttachmentInput => ({
  id: item.id,
  mimetype: item.mimetype,
  ...(item.originalFilename ? { originalFilename: item.originalFilename } : {}),
  ...(typeof item.size === 'number' ? { size: item.size } : {}),
  ...(typeof item.durationSeconds === 'number' ? { durationSeconds: item.durationSeconds } : {}),
});

export const actionsTargetFor = (row: ChatMessageRow, threadId?: string): MessageActionsTarget => ({
  row,
  html: row.model.storedHtml,
  attachments: row.model.mediaPreview?.items.map(actionAttachmentFrom) ?? [],
  reactionsMd: row.model.reactionPreview?.md ?? null,
  ...(threadId ? { threadId } : {}),
});
