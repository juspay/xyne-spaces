import { useCallback, useMemo } from 'react';
import { useSelector } from '@xstate/react';
import { stateMachineActor } from '../machines/stateMachine';
import { useZero } from './useZero';
import { mutators } from '../zero/mutators';
import { apiInstance } from '../services/clients/apiClient';
import { queryClient } from '../services/clients/queryClient';
import { v4 as uuidv4 } from 'uuid';
import { generateWebThumbnail, isVideoFile } from '../services/thumbnailService';
import {
  generateDocumentThumbnail,
  isPreviewableDocument,
} from '../services/documentThumbnailService';
import type { UploadedFile } from '../components/ui/files/Files.types';
import { logger, Event } from '../utils/logger';

/** Extract file extension (e.g. ".pdf") from a filename. Returns empty string if none. */
const getFileExtension = (name: string): string => {
  const dotIndex = name.lastIndexOf('.');
  return dotIndex > 0 ? name.slice(dotIndex).toLowerCase() : '';
};

// Format: Record<attachmentId, File> - local cache of File objects for newly uploaded files
const filesMapRef: Record<string, File> = {};

// Helper function to get image dimensions by loading the image
async function getImageDimensions(file: File): Promise<{ width: number; height: number } | null> {
  return new Promise(resolve => {
    const img = new Image();
    const url = URL.createObjectURL(file);

    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve({ width: img.width, height: img.height });
    };

    img.onerror = () => {
      URL.revokeObjectURL(url);
      resolve(null);
    };

    // Set timeout to prevent hanging
    setTimeout(() => {
      URL.revokeObjectURL(url);
      resolve(null);
    }, 5000);

    img.src = url;
  });
}

export function saveDraft(lookupId: string, html: string, text: string): void {
  stateMachineActor.send({ type: 'SAVE_DRAFT', lookupId, html, text });
}

export function removeDraft(lookupId: string): void {
  stateMachineActor.send({ type: 'REMOVE_DRAFT', lookupId });
}

export function useDraftFromDB(channelId: string, conversationId: string | null) {
  return useSelector(stateMachineActor, state =>
    state.context.draftMessages.find(
      draft => draft.channelId === channelId && draft.conversationId === conversationId,
    ),
  );
}

export function useDraft(channelId: string, conversationId: string | null) {
  const draftFromLocal = useSelector(
    stateMachineActor,
    state => state.context.drafts[conversationId ?? channelId],
  );
  const draftFromDB = useSelector(stateMachineActor, state =>
    state.context.draftMessages.find(
      draft => draft.channelId === channelId && draft.conversationId === conversationId,
    ),
  );

  return useMemo(() => {
    if (draftFromDB && draftFromLocal) {
      return draftFromDB.updatedAt > draftFromLocal.updatedAt
        ? draftFromDB.content
        : draftFromLocal.html;
    }
    return draftFromDB?.content ?? draftFromLocal?.html;
  }, [draftFromLocal, draftFromDB]);
}

export function getDraft(channelId: string, conversationId: string | null) {
  const state = stateMachineActor.getSnapshot();

  const draftFromLocal = state.context.drafts[conversationId ?? channelId];

  const draftFromDB = state.context.draftMessages.find(
    draft => draft.channelId === channelId && draft.conversationId === conversationId,
  );

  return draftFromDB && draftFromLocal && draftFromDB.updatedAt > draftFromLocal.updatedAt
    ? draftFromDB.content
    : draftFromLocal?.html;
}

export function useDraftAttachments() {
  const zero = useZero();
  const draftMessages = useSelector(stateMachineActor, state => state.context.draftMessages);

  const addDroppedFiles = useCallback(
    async (files: File | File[], channelId: string, conversationId?: string) => {
      // Normalize to array
      const filesArray = Array.isArray(files) ? files : [files];
      const draftMessageId = uuidv4();
      const timestamp = Date.now();

      // Generate attachment IDs for all files
      const attachmentIds = filesArray.map(() => uuidv4());

      // Process all files in parallel: generate thumbnails and get dimensions
      const fileProcessingPromises = filesArray.map(async (file, index) => {
        let width: number | undefined;
        let height: number | undefined;
        let duration: number | undefined;
        let thumbnailBlob: Blob | undefined;

        // Generate thumbnail and get dimensions for video files
        if (isVideoFile(file)) {
          try {
            const thumbnailResult = await generateWebThumbnail(file);
            width = thumbnailResult.width;
            height = thumbnailResult.height;
            duration = thumbnailResult.duration;
            thumbnailBlob = thumbnailResult.blob;
          } catch (error) {
            logger.warn(Event.FRONTEND_ERROR, {
              type: 'migrated_console_warn',
              message: String('Failed to generate thumbnail for video:'),
              context: [file.name, error],
            });
            logger.warn(Event.ATTACHMENT_THUMBNAIL_FAILED, {
              fileType: file.type,
              extension: getFileExtension(file.name),
              category: 'video',
              error: error instanceof Error ? error.message : String(error),
            });
          }
        }
        // Generate thumbnail for previewable document files (PDF, DOCX, XLSX, CSV)
        else if (isPreviewableDocument(file.type)) {
          try {
            const blob = await generateDocumentThumbnail(file);
            if (blob) thumbnailBlob = blob;
          } catch (error) {
            logger.warn(Event.FRONTEND_ERROR, {
              type: 'migrated_console_warn',
              message: String('Failed to generate thumbnail for document:'),
              context: [file.name, error],
            });
            logger.warn(Event.ATTACHMENT_THUMBNAIL_FAILED, {
              fileType: file.type,
              extension: getFileExtension(file.name),
              category: 'document',
              error: error instanceof Error ? error.message : String(error),
            });
          }
        }
        // Get dimensions for image files
        else if (file.type.startsWith('image/')) {
          try {
            const dims = await getImageDimensions(file);
            if (dims) {
              width = dims.width;
              height = dims.height;
            }
          } catch (error) {
            logger.warn(Event.FRONTEND_ERROR, {
              type: 'migrated_console_warn',
              message: String('Failed to get image dimensions:'),
              context: [file.name, error],
            });
            logger.warn(Event.ATTACHMENT_THUMBNAIL_FAILED, {
              fileType: file.type,
              extension: getFileExtension(file.name),
              category: 'image_dimensions',
              error: error instanceof Error ? error.message : String(error),
            });
          }
        }

        return {
          index,
          file,
          attachmentId: attachmentIds[index]!,
          width,
          height,
          duration,
          thumbnailBlob,
        };
      });

      const processedFiles = await Promise.all(fileProcessingPromises);

      // Pre-seed the React Query preview cache with thumbnail blobs generated during the draft
      // phase. This allows InlineVideoPlayer to show the thumbnail immediately after send,
      // before the server syncs thumbnailUrl back via Zero replication (which can take seconds).
      processedFiles.forEach(({ attachmentId, thumbnailBlob, file }) => {
        if (thumbnailBlob) {
          queryClient.setQueryData(
            ['preview-blob', `/attachments/${attachmentId}/thumbnail`],
            thumbnailBlob,
          );
        }
        // For images, cache the full file blob so it displays instantly after send
        // Images don't have a separate thumbnail - they use the full file directly
        if (file.type.startsWith('image/')) {
          queryClient.setQueryData(['preview-blob', attachmentId], file);
        }
      });

      // Prepare attachments array for mutator
      const attachmentsData = processedFiles.map(
        ({ attachmentId, file, width, height, duration }) => ({
          attachmentId: attachmentId,
          originalFilename: file.name,
          mimetype: file.type,
          size: file.size,
          width,
          height,
          duration,
        }),
      );

      // Get draft content to pass to mutator
      const currentContent = getDraft(channelId, conversationId ?? null) || '';

      // Create draft and attachment entries via mutator (batch operation)
      zero.mutate(
        mutators.draft.createAttachments({
          draftMessageId,
          attachments: attachmentsData,
          channelId,
          conversationId,
          content: currentContent,
          timestamp,
        }),
      );

      // Store files in local map
      processedFiles.forEach(({ attachmentId, file }) => {
        filesMapRef[attachmentId] = file;
      });

      // Upload all files to API in a single batch request
      try {
        const uploadStartTime = Date.now();
        const totalSizeBytes = filesArray.reduce((sum, f) => sum + f.size, 0);

        logger.info(Event.ATTACHMENT_UPLOAD_STARTED, {
          fileCount: filesArray.length,
          totalSizeBytes,
          extensions: filesArray.map(f => getFileExtension(f.name)),
          fileTypes: filesArray.map(f => f.type || 'unknown'),
          channelId,
          conversationId,
          draftMessageId,
        });

        const formData = new FormData();

        // Text fields go in BEFORE the file bodies. Multipart parts are parsed in wire
        // order, so on a mid-upload disconnect the server has already read the ids and
        // can mark those rows FAILED; appended last, they would never arrive.
        const fileMetadataArray = processedFiles.map(
          ({ index, thumbnailBlob, width, height, duration }) => ({
            fileIndex: index,
            hasThumbnail: !!thumbnailBlob,
            thumbnailIndex: processedFiles.findIndex(f => f.index === index && f.thumbnailBlob),
            width,
            height,
            duration,
          }),
        );
        formData.append('fileMetadata', JSON.stringify(fileMetadataArray));

        formData.append('attachmentIds', JSON.stringify(attachmentIds));
        formData.append('draftMessageId', draftMessageId);
        formData.append('channelId', channelId);

        if (conversationId) {
          formData.append('conversationId', conversationId);
        }

        // Add all files
        filesArray.forEach(file => {
          formData.append('files', file);
        });

        // Add all thumbnails (if available)
        processedFiles.forEach(({ thumbnailBlob, file }) => {
          if (thumbnailBlob) {
            formData.append('thumbnails', thumbnailBlob, `${file.name}_thumb.jpg`);
          } else {
            // Add placeholder for consistent indexing
            formData.append('thumbnails', new Blob([]), '');
          }
        });

        await apiInstance.post('/drafts/attachments/upload', formData);

        logger.info(Event.ATTACHMENT_UPLOAD_SUCCESS, {
          fileCount: filesArray.length,
          latency: Date.now() - uploadStartTime,
          channelId,
          draftMessageId,
        });

        // Return results in same order as input
        return processedFiles.map(({ attachmentId, file }) => ({
          attachmentId: attachmentId,
          file,
        }));
      } catch (error) {
        logger.error(Event.FRONTEND_ERROR, {
          type: 'migrated_console_error',
          message: String('Failed to upload files:'),
          error: error,
        });
        logger.error(Event.ATTACHMENT_UPLOAD_FAILED, {
          fileCount: filesArray.length,
          error: error instanceof Error ? error.message : String(error),
          channelId,
          conversationId,
          draftMessageId,
        });
        removeDroppedFiles(attachmentIds);
        throw error;
      }
    },
    [zero],
  );

  const removeDroppedFile = useCallback(
    // eslint-disable-next-line @typescript-eslint/require-await
    async (attachmentId: string) => {
      // Call mutator to delete the attachment
      zero.mutate(mutators.messageAttachment.delete({ attachmentId }));

      // Remove from local state
      delete filesMapRef[attachmentId];
    },
    [zero],
  );

  const removeDroppedFiles = useCallback(
    (attachmentIds: string[]) => {
      if (attachmentIds.length === 0) return;

      zero.mutate(mutators.messageAttachment.deleteMany({ attachmentIds }));

      attachmentIds.forEach(id => {
        delete filesMapRef[id];
      });
    },
    [zero],
  );

  const clearDroppedFiles = useCallback(
    // eslint-disable-next-line @typescript-eslint/require-await
    async (channelId: string, conversationId: string | null) => {
      // Find the draft message matching the channelId and conversationId
      const draftMessage = draftMessages.find(
        d => d.channelId === channelId && d.conversationId === conversationId,
      );

      if (!draftMessage || !draftMessage.attachments) return;

      // Call mutator to delete all attachments
      draftMessage.attachments.forEach(attachment =>
        zero.mutate(mutators.messageAttachment.delete({ attachmentId: attachment.id })),
      );

      // Clear from local state
      draftMessage.attachments.forEach(attachment => {
        delete filesMapRef[attachment.id];
      });
    },
    [zero, draftMessages],
  );

  const getDroppedFilesForEntity = useCallback(
    (channelId: string, conversationId: string | null): Map<string, File | UploadedFile> => {
      // Return empty map if no channelId provided
      if (!channelId) {
        return new Map();
      }

      // Find the draft message matching the channelId and conversationId
      const draftMessage = draftMessages.find(
        d => d.channelId === channelId && d.conversationId === conversationId,
      );

      if (!draftMessage || !draftMessage.attachments) {
        return new Map();
      }

      // Build a map of attachmentId -> File | UploadedFile
      const result = new Map<string, File | UploadedFile>();
      const orderedAttachments = [...draftMessage.attachments].sort(
        (a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id),
      );

      // Process all attachments in parallel
      orderedAttachments.forEach(attachment => {
        // Check if we have the full File object (newly uploaded files)
        const cachedFile = filesMapRef[attachment.id];

        if (cachedFile) {
          // Use full File object for newly uploaded files
          result.set(attachment.id, cachedFile);
        } else {
          // Return metadata only for old files (like MessageAttachment pattern)
          // No need to fetch the full file - AttachmentPreview will lazy load thumbnails
          const uploadedFile: UploadedFile = {
            id: attachment.id,
            originalName: attachment.originalFilename,
            fileName: attachment.originalFilename,
            fileSize: attachment.size,
            mimeType: attachment.mimetype,
            fileUrl: '', // Not used for preview - thumbnails loaded separately
            metadata: {
              width: attachment.width ?? undefined,
              height: attachment.height ?? undefined,
            },
          };

          if (attachment.thumbnailUrl) {
            uploadedFile.thumbnailUrl = attachment.thumbnailUrl;
          }

          result.set(attachment.id, uploadedFile);
        }
      });

      return result;
    },
    [draftMessages],
  );

  return useMemo(
    () => ({
      addDroppedFiles,
      removeDroppedFile,
      removeDroppedFiles,
      clearDroppedFiles,
      getDroppedFilesForEntity,
    }),
    [
      addDroppedFiles,
      removeDroppedFile,
      removeDroppedFiles,
      clearDroppedFiles,
      getDroppedFilesForEntity,
    ],
  );
}
