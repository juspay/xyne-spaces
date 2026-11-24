import { useCallback, useState } from 'react';
import { Alert } from 'react-native';
import * as VideoThumbnails from 'expo-video-thumbnails';

import { useDraftAttachments } from '@/src/hooks/useDraftAttachments';

import {
  useChatInputActions,
  useChatInputComposerState,
  useChatInputConversation,
  useChatInputHandlers,
} from '../input-composer-context';
import type { ComposerAttachment } from '../input-composer.types';
import { ATTACHMENT_PICKER_FILE_TYPES } from '../utils/attachments';
import {
  getAttachmentCountLimitError,
  getRemainingAttachmentSlots,
} from '../utils/attachmentPolicy';
import type { AttachmentPicker } from '../utils/composer-attachments-picker';
import { ingestComposerAttachments } from '../utils/pasteComposerAttachments';

const VIDEO_THUMBNAIL_TIME_MS = 1000; // 1 second

const isVideoMime = (mime: string): boolean => mime.startsWith('video/');
const isValidImageThumbnailUri = (uri: string): boolean => !isVideoUri(uri);

/**
 * Generate a thumbnail from a video file using expo-video-thumbnails
 */
async function generateVideoThumbnail(
  uri: string,
): Promise<{ uri: string; width: number; height: number } | null> {
  try {
    const result = await VideoThumbnails.getThumbnailAsync(uri, {
      time: VIDEO_THUMBNAIL_TIME_MS,
    });
    return {
      uri: result.uri,
      width: result.width,
      height: result.height,
    };
  } catch {
    return null;
  }
}

/**
 * Check if a URI is a video file (not an image thumbnail)
 */
const isVideoUri = (uri: string): boolean => {
  const lowerUri = uri.toLowerCase();
  return (
    lowerUri.endsWith('.mp4') ||
    lowerUri.endsWith('.mov') ||
    lowerUri.endsWith('.avi') ||
    lowerUri.endsWith('.mkv')
  );
};

/**
 * Process attachments to generate thumbnails for videos before adding to state
 */
async function processAttachmentsWithThumbnails(
  attachments: ComposerAttachment[],
): Promise<ComposerAttachment[]> {
  const needsThumbnailGeneration = attachments.some(
    attachment =>
      isVideoMime(attachment.mimetype) &&
      (!attachment.thumbnailUri || !isValidImageThumbnailUri(attachment.thumbnailUri)),
  );

  if (!needsThumbnailGeneration) {
    return attachments;
  }

  return Promise.all(
    attachments.map(async attachment => {
      const isVideo = isVideoMime(attachment.mimetype);
      const hasValidThumbnail =
        typeof attachment.thumbnailUri === 'string' &&
        isValidImageThumbnailUri(attachment.thumbnailUri);

      if (isVideo && !hasValidThumbnail) {
        const thumbnail = await generateVideoThumbnail(attachment.localUri);
        if (thumbnail) {
          return {
            ...attachment,
            thumbnailUri: thumbnail.uri,
            width: attachment.width ?? thumbnail.width,
            height: attachment.height ?? thumbnail.height,
          };
        }
      }
      return attachment;
    }),
  );
}

export type ComposerAttachmentPicking = {
  isPicking: boolean;
  remainingSlots: number;
  /** Clears the way with `beforePick`, runs the picker, then adds the picks as draft chips and refocuses the field. */
  pick: (picker: AttachmentPicker) => Promise<void>;
};

/**
 * The composer's attachment flow, shared by every surface that offers the
 * gallery / camera / files pickers: same limits, permissions, thumbnails and
 * draft upload. `beforePick` closes whatever surface launched the picker.
 */
export const useComposerAttachmentPicking = (
  beforePick: () => Promise<void>,
): ComposerAttachmentPicking => {
  const { conversationId, threadId } = useChatInputConversation();
  const { attachments } = useChatInputComposerState();
  const { setAttachments } = useChatInputActions();
  const { inputRef } = useChatInputHandlers();
  const { addAttachments: uploadDraftAttachments } = useDraftAttachments();
  const [isPicking, setIsPicking] = useState(false);
  const remainingSlots = getRemainingAttachmentSlots(attachments.length);

  const handleAttachmentsAdded = useCallback(
    async (newAttachments: ComposerAttachment[]): Promise<void> => {
      if (newAttachments.length === 0) return;

      const processedAttachments = await processAttachmentsWithThumbnails(newAttachments);

      const ingestPromise = ingestComposerAttachments({
        newAttachments: processedAttachments,
        existingAttachments: attachments,
        setAttachments,
        uploadDraftAttachments,
        conversationId,
        threadId: threadId ?? null,
      });
      // Let the attachment row commit before reopening the keyboard; otherwise
      // the sticky composer animates against its old height.
      const focusPromise = new Promise<void>(resolve => {
        requestAnimationFrame(() => {
          inputRef.current?.focus();
          resolve();
        });
      });
      await Promise.all([ingestPromise, focusPromise]);
    },
    [attachments, conversationId, inputRef, setAttachments, threadId, uploadDraftAttachments],
  );

  const pick = async (picker: AttachmentPicker): Promise<void> => {
    if (isPicking) return;
    if (remainingSlots === 0) {
      Alert.alert('Attachment limit reached', getAttachmentCountLimitError());
      return;
    }

    setIsPicking(true);
    await beforePick();
    try {
      const picked = await picker([...ATTACHMENT_PICKER_FILE_TYPES], remainingSlots);
      await handleAttachmentsAdded(picked);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to add attachment';
      Alert.alert('Attachment unavailable', message);
    } finally {
      setIsPicking(false);
    }
  };

  return { isPicking, remainingSlots, pick };
};
