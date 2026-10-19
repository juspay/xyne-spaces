import type { ComposerAttachment } from '../input-composer.types';

export const ATTACHMENT_PICKER_FILE_TYPES = ['*/*'] as const;

export type AttachmentUploadResult = {
  success: boolean;
  attachmentId: string;
  error?: string;
};

export const applyUploadResultsToAttachments = (
  attachments: ComposerAttachment[],
  uploadResults: AttachmentUploadResult[],
): ComposerAttachment[] => {
  const resultByAttachmentId = new Map(uploadResults.map(result => [result.attachmentId, result]));

  return attachments.map(attachment => {
    const result = resultByAttachmentId.get(attachment.attachmentId);
    if (!result) return attachment;

    return {
      ...attachment,
      status: result.success ? 'uploaded' : 'failed',
      ...(result.error !== undefined ? { error: result.error } : {}),
    };
  });
};

export const getFirstUploadFailure = (
  uploadResults: AttachmentUploadResult[],
): string | undefined => {
  return uploadResults.find(result => !result.success)?.error;
};
