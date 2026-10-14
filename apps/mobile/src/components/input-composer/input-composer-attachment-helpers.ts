import type { ComposerAttachment } from './input-composer.types';

export const isUploadedAttachment = (attachment: ComposerAttachment): boolean =>
  attachment.status === 'uploaded';

export const isPendingAttachment = (attachment: ComposerAttachment): boolean =>
  attachment.status === 'uploading' || attachment.status === 'local';

export const computeCanSend = (
  text: string,
  attachments: readonly ComposerAttachment[],
  isSending: boolean,
  isMutatingAttachments: boolean,
): boolean => {
  const hasUploaded = attachments.some(isUploadedAttachment);
  const hasPending = attachments.some(isPendingAttachment);
  return (
    (text.trim().length > 0 || hasUploaded) && !isSending && !isMutatingAttachments && !hasPending
  );
};

/** True when the send button / also-send row should be visible. */
export const computeHasComposerContent = (
  text: string,
  attachments: readonly ComposerAttachment[],
): boolean => text.trim().length > 0 || attachments.length > 0;
