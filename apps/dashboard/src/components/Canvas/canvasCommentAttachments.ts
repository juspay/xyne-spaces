import { apiInstance } from '../../services/clients/apiClient';
import type { PanelAttachmentRow } from '../Chat/MessageCard/MessageCardAttachmentThumbnails';

export type CanvasCommentAttachment = {
  id: string;
  originalFilename: string;
  mimetype: string;
  size: number;
  thumbnailUrl?: string | null;
  isDeleted?: boolean | null;
};

export type CanvasCommentSubmitPayload = {
  body: string;
  mentionedUserIds: string[];
  files: File[];
};

export const toPanelAttachments = (
  attachments?: readonly CanvasCommentAttachment[] | null,
): PanelAttachmentRow[] =>
  (attachments ?? [])
    .filter(attachment => !attachment.isDeleted)
    .map(attachment => ({
      id: attachment.id,
      originalFilename: attachment.originalFilename,
      mimetype: attachment.mimetype,
      size: attachment.size,
      thumbnailUrl: attachment.thumbnailUrl ?? null,
    }));

export const uploadCanvasCommentAttachments = async ({
  canvasId,
  commentId,
  files,
}: {
  canvasId: string;
  commentId: string;
  files: File[];
}): Promise<void> => {
  if (files.length === 0) return;

  const formData = new FormData();
  formData.append('entityId', commentId);
  formData.append('entityType', 'CANVAS_COMMENT');
  files.forEach(file => formData.append('files', file));
  formData.append(
    'fileMetadata',
    JSON.stringify(
      files.map((_, fileIndex) => ({
        fileIndex,
        hasThumbnail: false,
        canvasId,
        commentId,
        type: 'canvas_comment_attachment',
      })),
    ),
  );

  await apiInstance.post('/attachments/upload', formData);
};
