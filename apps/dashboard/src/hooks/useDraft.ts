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
import {
  convertHeicFileWithDimensions,
  isHeicAttachment,
  sniffHeicFile,
} from '../services/heicAttachmentService';
import type { UploadedFile } from '../components/ui/files/Files.types';
import { logger, Event } from '../utils/logger';
import { useAttachmentUpload } from '../store/useAttachmentUploadStore';
import { getBaseRoute } from './useRouteContext';
import { AttachmentUploadStatus } from '@xyne/shared';

/** Extract file extension (e.g. ".pdf") from a filename. Returns empty string if none. */
const getFileExtension = (name: string): string => {
  const dotIndex = name.lastIndexOf('.');
  return dotIndex > 0 ? name.slice(dotIndex).toLowerCase() : '';
};

// Format: Record<attachmentId, File> - local cache of File objects for newly uploaded files
const filesMapRef: Record<string, File> = {};

/**
 * Is the original File for this attachment still held in memory?
 *
 * Callers that retry without the user asking must check this first: `retryAttachment` falls
 * back to a file picker when the bytes are gone, and a picker opening by itself — on a
 * reconnect, say — would be a dialog nobody asked for.
 */
export function hasFileInMemory(attachmentId: string): boolean {
  return filesMapRef[attachmentId] instanceof File;
}

/**
 * Opens a file picker and resolves with what was chosen (empty if cancelled).
 *
 * Needed for retrying an upload after a reload: the original File only ever existed in
 * memory, so there is nothing to resend and the user has to point at it again.
 */
function promptForFiles(multiple: boolean): Promise<File[]> {
  return new Promise(resolve => {
    const input = document.createElement('input');
    input.type = 'file';
    input.multiple = multiple;
    // Chrome fires neither change nor cancel in some dismissal paths; resolving empty on
    // cancel keeps the caller from hanging on a promise that never settles.
    input.addEventListener('cancel', () => resolve([]), { once: true });
    input.addEventListener('change', () => resolve(input.files ? Array.from(input.files) : []), {
      once: true,
    });
    input.click();
  });
}

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
    async (
      files: File | File[],
      channelId: string,
      conversationId?: string,
      /**
       * Retry of a batch that already has rows. Reusing the ids is what lets a retried file
       * land back in the message it was sent with: the row is already entityType=CHAT
       * pointing at that message, and the upload controller upserts by id without touching
       * entityType, so filling in the url is all that is left to do.
       */
      retryAttachmentIds?: string[],
    ) => {
      // Normalize to array
      const filesArray = Array.isArray(files) ? files : [files];
      const draftMessageId = uuidv4();
      const timestamp = Date.now();
      const isRetry = !!retryAttachmentIds?.length;

      // Generate attachment IDs for all files
      const attachmentIds = retryAttachmentIds ?? filesArray.map(() => uuidv4());

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
        else if (file.type.startsWith('image/') || isHeicAttachment(file.type, file.name)) {
          try {
            let dims = await getImageDimensions(file);
            if (!dims) {
              const sniffed = await sniffHeicFile(file);
              if (sniffed ?? isHeicAttachment(file.type, file.name)) {
                const converted = await convertHeicFileWithDimensions(file);
                dims = { width: converted.width, height: converted.height };
              }
            }
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
        // Images don't have a separate thumbnail - they use the full file directly.
        // HEIC is excluded: the original blob can't render in most browsers, and
        // the chip fetches the server-side WebP thumbnail instead (see
        // heicAttachmentService). Local Files are decided by their ftyp brand —
        // the browser's type/extension is a guess that mislabels renamed HEICs
        // as .jpg, which would cache an unrenderable blob.
        if (file.type.startsWith('image/')) {
          void sniffHeicFile(file).then(sniffed => {
            if (!(sniffed ?? isHeicAttachment(file.type, file.name))) {
              queryClient.setQueryData(['preview-blob', attachmentId], file);
            }
          });
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

      if (isRetry) {
        // The rows already exist — and may already be on a sent message. Only their status
        // moves back to PENDING, so the tile returns to a spinner instead of staying failed.
        attachmentIds.forEach(id => {
          zero.mutate(
            mutators.messageAttachment.setUploadStatus({
              attachmentId: id,
              uploadStatus: AttachmentUploadStatus.PENDING,
            }),
          );
        });
      } else {
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
      }

      // Store files in local map
      processedFiles.forEach(({ attachmentId, file }) => {
        filesMapRef[attachmentId] = file;
      });

      // Upload all files to API in a single batch request
      const batchId = uuidv4();
      try {
        const uploadStartTime = Date.now();
        const totalSizeBytes = filesArray.reduce((sum, f) => sum + f.size, 0);

        // Byte progress lives only here — the DB tracks PENDING/FAILED, never a percentage.
        // Registered before the request so the pill appears the moment the upload starts,
        // and carries the channel so it can route back once the user navigates away.
        useAttachmentUpload.getState().startBatch({
          batchId,
          attachmentIds,
          fileNames: filesArray.map(f => f.name),
          channelId,
          conversationId: conversationId ?? null,
          baseRoute: getBaseRoute(window.location.pathname),
          totalBytes: totalSizeBytes,
        });

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

        await apiInstance.post('/drafts/attachments/upload', formData, {
          onUploadProgress: event => {
            useAttachmentUpload.getState().setProgress(batchId, event.loaded, event.total);
          },
        });

        logger.info(Event.ATTACHMENT_UPLOAD_SUCCESS, {
          fileCount: filesArray.length,
          latency: Date.now() - uploadStartTime,
          channelId,
          draftMessageId,
        });

        // Only on success. A failed batch stays in the store so the pill can keep showing
        // it in red until the user retries or dismisses it.
        useAttachmentUpload.getState().endBatch(batchId);

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
        // Mark every row in the batch FAILED. The server does this too when it sees the
        // transfer break, but it cannot see a request that never arrived, and a row left
        // PENDING is a tile that spins forever. Writing it from here is what turns a dead
        // upload into something the user can see and retry.
        attachmentIds.forEach(id => {
          zero.mutate(
            mutators.messageAttachment.setUploadStatus({
              attachmentId: id,
              uploadStatus: AttachmentUploadStatus.FAILED,
            }),
          );
        });
        useAttachmentUpload.getState().failBatch(batchId);

        // Rows are deliberately NOT deleted here. Since send does not wait for the upload,
        // these ids may already have ridden onto a posted message, and a batch fails as a
        // whole even when only one file died — deleting would strip attachments, including
        // healthy ones, off live messages. Worse, deleting a row the composer still shows
        // leaves a stale chip that keeps send enabled and ships an empty message. The
        // FAILED row above renders as a failed tile instead: honest, and retryable.
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

  /**
   * Re-runs a failed upload against the rows it already created.
   *
   * The File objects live in a module-level map, so a retry within the same session needs
   * nothing from the user. After a reload that map is empty — the bytes were never
   * persisted anywhere — so the only honest option is to ask for the file again. The picker
   * is filtered to the original names where the browser allows it, but whatever is chosen
   * is uploaded against the original attachment ids, which is what puts it back into the
   * message it was sent with.
   */
  const retryUpload = useCallback(
    async (batchId: string) => {
      const batch = useAttachmentUpload.getState().batches[batchId];
      if (!batch) return;

      const held = batch.attachmentIds.map(id => filesMapRef[id]);
      let files = held.filter((f): f is File => f instanceof File);

      if (files.length !== batch.attachmentIds.length) {
        files = await promptForFiles(batch.fileNames.length > 1);
        // Cancelled picker, or the wrong number of files back: leave the batch failed
        // rather than uploading a mismatched set against these ids.
        if (files.length !== batch.attachmentIds.length) return;
      }

      useAttachmentUpload.getState().restartBatch(batchId);
      try {
        await addDroppedFiles(
          files,
          batch.channelId,
          batch.conversationId ?? undefined,
          batch.attachmentIds,
        );
      } catch {
        // addDroppedFiles has already marked the rows FAILED and the batch failed.
      }
    },
    [addDroppedFiles],
  );

  const dismissUpload = useCallback((batchId: string) => {
    useAttachmentUpload.getState().endBatch(batchId);
  }, []);

  /**
   * Retry one attachment from its tile, where there may be no upload batch to speak of —
   * after a reload the store is empty but the FAILED row is still sitting in the message.
   * Takes the channel from the row rather than the component, since a tile can render in
   * surfaces that never pass one.
   */
  const retryAttachment = useCallback(
    async (attachmentId: string, channelId: string, conversationId: string | null) => {
      let file = filesMapRef[attachmentId];
      if (!file) {
        const picked = await promptForFiles(false);
        if (picked.length !== 1 || !picked[0]) return;
        file = picked[0];
      }
      try {
        await addDroppedFiles([file], channelId, conversationId ?? undefined, [attachmentId]);
      } catch {
        // addDroppedFiles has already marked the row FAILED again.
      }
    },
    [addDroppedFiles],
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
      retryUpload,
      dismissUpload,
      retryAttachment,
    }),
    [
      addDroppedFiles,
      removeDroppedFile,
      removeDroppedFiles,
      clearDroppedFiles,
      getDroppedFilesForEntity,
      retryUpload,
      dismissUpload,
      retryAttachment,
    ],
  );
}
