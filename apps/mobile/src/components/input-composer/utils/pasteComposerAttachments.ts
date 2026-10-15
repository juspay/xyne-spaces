import { Alert } from 'react-native';
import * as FileSystem from 'expo-file-system/legacy';
import { v4 as uuidv4 } from 'uuid';

import type { ComposerAttachment } from '../input-composer.types';
import type { DraftAttachmentUploadResult } from '@/src/hooks/useDraftAttachments';
import { getAttachmentRejectionReason } from './attachmentPolicy';
import { applyUploadResultsToAttachments, getFirstUploadFailure } from './attachments';
import { assertAttachmentCountWithinLimit } from './attachmentPolicy';

type PastedImageLike = {
  uri: string;
  type: string;
  width: number;
  height: number;
};

const mimeToExtension = (mimetype: string): string => {
  if (mimetype === 'image/png') return 'png';
  if (mimetype === 'image/gif') return 'gif';
  if (mimetype === 'image/webp') return 'webp';
  return 'jpg';
};

const mergeAttachmentsById = (
  current: ComposerAttachment[],
  incoming: ComposerAttachment[],
): ComposerAttachment[] => {
  if (incoming.length === 0) return current;

  const byId = new Map(current.map(item => [item.attachmentId, item]));
  for (const attachment of incoming) {
    byId.set(attachment.attachmentId, attachment);
  }

  const merged = Array.from(byId.values());
  assertAttachmentCountWithinLimit(0, merged.length);
  return merged;
};

const pastedImageToComposerAttachment = async (
  image: PastedImageLike,
): Promise<ComposerAttachment | null> => {
  const mimetype = image.type?.startsWith('image/') ? image.type : 'image/jpeg';
  const fileInfo = await FileSystem.getInfoAsync(image.uri);
  if (!fileInfo.exists || !('size' in fileInfo) || !fileInfo.size) return null;

  const attachment: ComposerAttachment = {
    attachmentId: uuidv4(),
    originalFilename: `pasted-image-${Date.now()}.${mimeToExtension(mimetype)}`,
    mimetype,
    size: fileInfo.size,
    width: image.width,
    height: image.height,
    localUri: image.uri,
    thumbnailUri: image.uri,
    source: 'gallery',
    status: 'local',
  };

  const rejectionReason = getAttachmentRejectionReason(attachment);
  if (rejectionReason) {
    throw new Error(rejectionReason);
  }

  return attachment;
};

const pastedImagesToComposerAttachments = async (
  images: readonly PastedImageLike[],
): Promise<ComposerAttachment[]> => {
  const attachments = await Promise.all(images.map(pastedImageToComposerAttachment));
  return attachments.filter((attachment): attachment is ComposerAttachment => attachment !== null);
};

type IngestComposerAttachmentsArgs = {
  newAttachments: ComposerAttachment[];
  existingAttachments: readonly ComposerAttachment[];
  setAttachments: (updater: (prev: ComposerAttachment[]) => ComposerAttachment[]) => void;
  uploadDraftAttachments: (
    attachments: ComposerAttachment[],
    channelId: string,
    conversationId?: string | null,
  ) => Promise<DraftAttachmentUploadResult[]>;
  conversationId: string;
  threadId?: string | null;
};

const ingestComposerAttachments = async ({
  newAttachments,
  existingAttachments,
  setAttachments,
  uploadDraftAttachments,
  conversationId,
  threadId,
}: IngestComposerAttachmentsArgs): Promise<void> => {
  if (newAttachments.length === 0) return;

  assertAttachmentCountWithinLimit(existingAttachments.length, newAttachments.length);

  setAttachments(prev => mergeAttachmentsById(prev, newAttachments));

  const uploadResults = await uploadDraftAttachments(
    newAttachments,
    conversationId,
    threadId && threadId.length > 0 ? threadId : null,
  );

  setAttachments(prev =>
    applyUploadResultsToAttachments(mergeAttachmentsById(prev, newAttachments), uploadResults),
  );

  const firstFailure = getFirstUploadFailure(uploadResults);
  if (firstFailure !== undefined) {
    Alert.alert('Attachment upload failed', firstFailure);
  }
};

export { ingestComposerAttachments, mergeAttachmentsById, pastedImagesToComposerAttachments };
export type { PastedImageLike };
