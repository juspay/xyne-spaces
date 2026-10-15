/**
 * useDraftAttachments Hook for Lotus
 *
 * Mirrors dashboard's useDraftAttachments hook pattern.
 * Handles:
 * 1. Creating draft and attachment records via mutator
 * 2. Uploading files to backend
 * 3. Managing attachment state
 *
 * Flow (same as dashboard):
 * 1. User selects files -> addAttachments() called
 * 2. Mutator creates draft_message + message_attachments (entityType: DRAFT)
 * 3. Files uploaded to /drafts/attachments/upload
 * 4. When message sent, mutator transfers attachments from DRAFT to CHAT
 */

import { useCallback } from 'react';
import { v4 as uuidv4 } from 'uuid';
import { File, Paths } from 'expo-file-system';
import { useZero } from './useZero';
import { mutators } from '@/src/zero/mutators';
import { API_BASE_URL } from '@/src/config';
import { mtlsMultipartUpload } from '@/src/utils/mtlsFileUpload';
import { mtlsFetch } from '@/src/utils/mtlsHttpClient';
import type { ComposerAttachment } from '@/src/components/input-composer/input-composer.types';
import * as VideoThumbnails from 'expo-video-thumbnails';
import { buildAuthenticatedHeaders } from '@/src/services/authToken';
import {
  hasValidImageDimensions,
  resolveAttachmentImageDimensions,
} from '@/src/utils/getImageDimensions';
import { Event, logger } from '@/src/utils/logger';
import {
  getAttachmentCountLimitError,
  getAttachmentRejectionReason,
  MAX_COMPOSER_ATTACHMENT_COUNT,
} from '@/src/components/input-composer/utils/attachmentPolicy';

export type DraftAttachmentUploadResult = {
  attachmentId: string;
  success: boolean;
  error?: string;
};

interface UploadResultItem extends DraftAttachmentUploadResult {
  fileUrl: string;
}

interface DraftUploadResponse {
  success: boolean;
  attachmentIds: string[];
  uploadedAttachments?: UploadResultItem[];
  totalCount?: number;
  successCount?: number;
  failureCount?: number;
  error?: string;
}

interface ProcessedAttachment extends ComposerAttachment {
  hasThumbnail: boolean;
  thumbnailUri?: string;
  thumbnailIndex: number;
}

const VIDEO_THUMBNAIL_TIME_MS = 1000; // 1 second like dashboard

export const getFailedDraftAttachmentIds = (
  results: readonly DraftAttachmentUploadResult[],
): string[] => results.filter(result => !result.success).map(result => result.attachmentId);

const toFailedDraftAttachmentUploadResults = (
  attachments: readonly ComposerAttachment[],
  error: string,
): DraftAttachmentUploadResult[] =>
  attachments.map(attachment => ({
    success: false,
    attachmentId: attachment.attachmentId,
    error,
  }));

/**
 * Generate a thumbnail from a video file using expo-video-thumbnails
 */
async function generateVideoThumbnail(
  uri: string,
): Promise<{ uri: string; width: number; height: number } | null> {
  try {
    console.log('[generateVideoThumbnail] Generating thumbnail for:', uri);
    const result = await VideoThumbnails.getThumbnailAsync(uri, {
      time: VIDEO_THUMBNAIL_TIME_MS,
    });

    console.log('[generateVideoThumbnail] Generated:', result);
    return {
      uri: result.uri,
      width: result.width,
      height: result.height,
    };
  } catch (error) {
    console.error('[generateVideoThumbnail] Failed to generate thumbnail:', error);
    return null;
  }
}

/**
 * Pre-seed the thumbnail cache with a locally generated thumbnail.
 * This prevents the 404 race condition when fetching thumbnails immediately after upload.
 */
async function preseedThumbnailCache(attachmentId: string, thumbnailUri: string): Promise<void> {
  try {
    const dest = new File(Paths.cache, 'thumbnails', `${attachmentId}.jpg`);
    dest.parentDirectory.create({ intermediates: true, idempotent: true });
    await new File(thumbnailUri).copy(dest, { overwrite: true });

    console.log('[preseedThumbnailCache] Pre-seeded thumbnail cache:', {
      attachmentId,
      cachePath: dest.uri,
    });
  } catch (error) {
    console.error('[preseedThumbnailCache] Failed to pre-seed cache:', error);
    // Non-fatal: thumbnail will be fetched from server later
  }
}

/**
 * Pre-seed the image cache with the local image file.
 * This allows instant display without fetching from server.
 */
async function preseedImageCache(attachmentId: string, localUri: string): Promise<void> {
  try {
    const dest = new File(Paths.cache, 'images', `${attachmentId}.jpg`);
    dest.parentDirectory.create({ intermediates: true, idempotent: true });
    await new File(localUri).copy(dest, { overwrite: true });

    console.log('[preseedImageCache] Pre-seeded image cache:', {
      attachmentId,
      cachePath: dest.uri,
    });
  } catch (error) {
    console.error('[preseedImageCache] Failed to pre-seed cache:', error);
    // Non-fatal: image will be fetched from server
  }
}

const isVideoMime = (mime: string): boolean => mime.startsWith('video/');
const isImageMime = (mime: string): boolean => mime.startsWith('image/');

export function useDraftAttachments() {
  const zero = useZero();

  /**
   * Upload attachments to draft endpoint
   * Follows dashboard's addDroppedFiles pattern exactly
   */
  const addAttachments = useCallback(
    async (
      attachments: ComposerAttachment[],
      channelId: string,
      conversationId?: string | null,
      onProgress?: (attachmentId: string, progress: number) => void,
    ): Promise<DraftAttachmentUploadResult[]> => {
      // Filter only local attachments that need uploading
      const localAttachments = attachments.filter(a => a.status === 'local');
      console.log('[useDraftAttachments] Starting upload:', {
        totalAttachments: attachments.length,
        localAttachments: localAttachments.length,
        attachmentIds: localAttachments.map(a => a.attachmentId),
        channelId,
        conversationId,
      });

      if (localAttachments.length === 0) {
        console.log('[useDraftAttachments] No local attachments to upload');
        return attachments.map(a => {
          const success = a.status === 'uploaded';
          const result: { success: boolean; attachmentId: string; error?: string } = {
            success,
            attachmentId: a.attachmentId,
          };
          if (!success) {
            result.error = 'Attachment not uploaded';
          }
          return result;
        });
      }

      if (attachments.length > MAX_COMPOSER_ATTACHMENT_COUNT) {
        return toFailedDraftAttachmentUploadResults(
          localAttachments,
          getAttachmentCountLimitError(),
        );
      }

      const invalidAttachment = localAttachments.find(attachment =>
        getAttachmentRejectionReason(attachment),
      );
      if (invalidAttachment) {
        return toFailedDraftAttachmentUploadResults(
          localAttachments,
          getAttachmentRejectionReason(invalidAttachment) ?? 'Attachment is not allowed',
        );
      }

      const draftMessageId = uuidv4();
      const timestamp = Date.now();

      // Generate attachment IDs (already generated in picker, use those)
      const attachmentIds = localAttachments.map(a => a.attachmentId);
      const cleanupLocalDraftAttachmentRows = async (ids: string[]): Promise<void> => {
        if (ids.length === 0) return;
        try {
          await Promise.resolve(
            zero.mutate(mutators.messageAttachment.deleteMany({ attachmentIds: ids })),
          );
        } catch (cleanupError) {
          logger.error(Event.ZERO_MUTATION_ERROR, {
            context: 'draft_attachment_cleanup_failed',
            attachmentIds: ids,
            error: cleanupError,
          });
        }
      };
      const notifyUploadProgress = (attachmentId: string, progress: number): void => {
        try {
          onProgress?.(attachmentId, progress);
        } catch (progressError) {
          logger.error(Event.ATTACHMENT_UPLOAD_FAILED, {
            context: 'draft_attachment_progress_callback_failed',
            attachmentId,
            progress,
            error: progressError,
          });
        }
      };

      // Generate thumbnails for videos (parallel processing like dashboard)
      console.log('[useDraftAttachments] Processing attachments for thumbnails...');
      const processedAttachments: ProcessedAttachment[] = await Promise.all(
        localAttachments.map(async (attachment, index): Promise<ProcessedAttachment> => {
          const base: ProcessedAttachment = {
            ...attachment,
            hasThumbnail: false,
            thumbnailIndex: -1,
          };

          // Generate thumbnail for video files
          if (isVideoMime(attachment.mimetype)) {
            console.log(
              `[useDraftAttachments] Generating thumbnail for video ${index}:`,
              attachment.originalFilename,
            );
            const thumbnail = await generateVideoThumbnail(attachment.localUri);
            if (thumbnail) {
              base.hasThumbnail = true;
              base.thumbnailUri = thumbnail.uri;
              base.thumbnailIndex = index;
              // Update dimensions if picker metadata is missing or invalid
              if (!hasValidImageDimensions(base.width, base.height)) {
                base.width = thumbnail.width;
                base.height = thumbnail.height;
              }
              console.log(
                `[useDraftAttachments] Thumbnail generated for video ${index}:`,
                thumbnail.uri,
              );

              // Pre-seed the cache to avoid 404 race condition when fetching
              await preseedThumbnailCache(attachment.attachmentId, thumbnail.uri);
            }
          }

          if (isImageMime(attachment.mimetype)) {
            const dims = await resolveAttachmentImageDimensions(
              attachment.localUri,
              base.width,
              base.height,
            );
            if (dims.width !== undefined) base.width = dims.width;
            if (dims.height !== undefined) base.height = dims.height;

            console.log(
              `[useDraftAttachments] Pre-seeding image cache for ${index}:`,
              attachment.originalFilename,
            );
            await preseedImageCache(attachment.attachmentId, attachment.localUri);
          }

          return base;
        }),
      );

      // Prepare attachments array for mutator (matching dashboard's attachmentsData)
      const attachmentsData = processedAttachments.map(attachment => ({
        attachmentId: attachment.attachmentId,
        originalFilename: attachment.originalFilename,
        mimetype: attachment.mimetype,
        size: attachment.size,
        ...(attachment.width !== undefined && { width: attachment.width }),
        ...(attachment.height !== undefined && { height: attachment.height }),
      }));

      // Create draft and attachment entries via mutator
      // This mirrors dashboard's: zero.mutate(mutators.draft.createAttachments({...}))
      zero.mutate(
        mutators.draft.createAttachments({
          draftMessageId,
          attachments: attachmentsData,
          channelId,
          ...(conversationId && { conversationId }),
          timestamp,
        }),
      );

      // Upload files to API (matching dashboard's FormData pattern)
      try {
        // Prepare thumbnails array for upload (matching dashboard's pattern)
        const thumbnailsData = processedAttachments
          .map(a =>
            a.thumbnailUri
              ? { uri: a.thumbnailUri, name: `${a.originalFilename}_thumb.jpg`, type: 'image/jpeg' }
              : null,
          )
          .filter((t): t is { uri: string; name: string; type: string } => t !== null);

        console.log('[useDraftAttachments] Files to upload:', processedAttachments.length);
        console.log('[useDraftAttachments] Thumbnails to upload:', thumbnailsData.length);
        console.log(
          '[useDraftAttachments] Thumbnail details:',
          thumbnailsData.map(t => ({ uri: t.uri.substring(0, 50), name: t.name })),
        );
        console.log(
          '[useDraftAttachments] Processed attachments:',
          processedAttachments.map(a => ({
            attachmentId: a.attachmentId,
            originalFilename: a.originalFilename,
            mimetype: a.mimetype,
            hasThumbnail: a.hasThumbnail,
            thumbnailIndex: a.thumbnailIndex,
          })),
        );

        // Add fileMetadata JSON with thumbnail info
        // thumbnailIndex should be sequential index in thumbnails array (0, 1, 2...)
        let thumbnailCounter = 0;
        const fileMetadataArray = processedAttachments.map((attachment, index) => {
          const hasThumb = !!(attachment.hasThumbnail && attachment.thumbnailUri);
          const metadata: {
            fileIndex: number;
            hasThumbnail: boolean;
            thumbnailIndex: number;
            width?: number;
            height?: number;
          } = {
            fileIndex: index,
            hasThumbnail: hasThumb,
            thumbnailIndex: hasThumb ? thumbnailCounter++ : -1,
          };
          if (attachment.width !== undefined) metadata.width = attachment.width;
          if (attachment.height !== undefined) metadata.height = attachment.height;
          return metadata;
        });

        console.log('[useDraftAttachments] File metadata:', fileMetadataArray);

        const headers = await buildAuthenticatedHeaders();

        // Perform upload using mTLS multipart upload
        const uploadUrl = `${API_BASE_URL}/drafts/attachments/upload`;
        console.log('[useDraftAttachments] Sending upload request to:', uploadUrl, {
          hasToken: !!headers['Authorization'],
          hasCookie: !!headers['Cookie'],
          attachmentIds,
          draftMessageId,
          channelId,
          conversationId,
          fileCount: processedAttachments.length,
          thumbnailCount: thumbnailsData.length,
        });

        // Use mTLS-aware multipart upload with thumbnails
        const fetchResponse = await mtlsMultipartUpload({
          url: uploadUrl,
          fields: {
            fileMetadata: JSON.stringify(fileMetadataArray),
            attachmentIds: JSON.stringify(attachmentIds),
            draftMessageId,
            channelId,
            ...(conversationId && { conversationId }),
          },
          files: processedAttachments.map(a => ({
            uri: a.localUri,
            name: a.originalFilename,
            type: a.mimetype,
          })),
          thumbnails: thumbnailsData,
          headers,
        });

        console.log('[useDraftAttachments] Upload response status:', fetchResponse.statusCode);

        if (fetchResponse.statusCode < 200 || fetchResponse.statusCode >= 300) {
          console.error(
            '[useDraftAttachments] Upload HTTP error:',
            fetchResponse.statusCode,
            fetchResponse.body,
          );
          throw new Error(
            `Upload failed with status ${fetchResponse.statusCode}: ${fetchResponse.body}`,
          );
        }

        const response: DraftUploadResponse = JSON.parse(fetchResponse.body);

        // Check individual attachment results
        if (response.uploadedAttachments) {
          const failedAttachments = response.uploadedAttachments.filter(a => !a.success);
          if (failedAttachments.length > 0) {
            console.error(
              '[useDraftAttachments] Some attachments failed to upload:',
              failedAttachments,
            );
          }
        }

        console.log('[useDraftAttachments] Upload response:', {
          totalCount: response.totalCount,
          successCount: response.successCount,
          failureCount: response.failureCount,
          uploadedAttachments: response.uploadedAttachments,
        });

        // Return results based on individual attachment status
        const uploadResults: DraftAttachmentUploadResult[] = localAttachments.map(attachment => {
          const uploadResult = response.uploadedAttachments?.find(
            a => a.attachmentId === attachment.attachmentId,
          );
          const success = uploadResult?.success ?? false;
          notifyUploadProgress(attachment.attachmentId, success ? 100 : 0);
          const result: DraftAttachmentUploadResult = {
            success,
            attachmentId: attachment.attachmentId,
          };
          if (uploadResult?.error) {
            result.error = uploadResult.error;
          } else if (!success) {
            result.error = response.error || 'Upload failed';
          }
          return result;
        });

        await cleanupLocalDraftAttachmentRows(getFailedDraftAttachmentIds(uploadResults));

        return uploadResults;
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Upload failed';
        console.error('[useDraftAttachments] Upload exception:', error);
        const uploadResults = toFailedDraftAttachmentUploadResults(localAttachments, errorMessage);
        await cleanupLocalDraftAttachmentRows(getFailedDraftAttachmentIds(uploadResults));
        return uploadResults;
      }
    },
    [zero],
  );

  /**
   * Remove a draft attachment
   */
  const removeAttachment = useCallback(
    async (attachmentId: string): Promise<boolean> => {
      try {
        console.log('[useDraftAttachments.removeAttachment] Starting delete', { attachmentId });

        // Delete remote draft attachment blob first.
        // The server endpoint may depend on draft attachment metadata still existing.
        const headers = await buildAuthenticatedHeaders();
        const deleteUrl = `${API_BASE_URL}/drafts/attachments/${encodeURIComponent(attachmentId)}`;
        const response = await mtlsFetch(deleteUrl, {
          method: 'DELETE',
          headers,
        });

        console.log('[useDraftAttachments.removeAttachment] Server delete response', {
          attachmentId,
          statusCode: response.statusCode,
        });

        const isSuccess = response.statusCode >= 200 && response.statusCode < 300;
        const isNotFound = response.statusCode === 404;

        if (!isSuccess && !isNotFound) {
          return false;
        }

        if (isNotFound) {
          // Backend currently may not expose draft attachment DELETE route.
          // Treat 404 as non-fatal and still clear local draft state.
          console.warn(
            '[useDraftAttachments.removeAttachment] Server delete returned 404; proceeding with local delete',
            { attachmentId },
          );
        }

        // Delete draft attachment row via mutator after server deletion succeeds.
        await Promise.resolve(zero.mutate(mutators.messageAttachment.delete({ attachmentId })));
        console.log('[useDraftAttachments.removeAttachment] Local draft delete completed', {
          attachmentId,
        });

        return true;
      } catch (error) {
        console.error('[useDraftAttachments.removeAttachment] Failed to remove draft attachment', {
          attachmentId,
          error,
        });
        return false;
      }
    },
    [zero],
  );

  return {
    addAttachments,
    removeAttachment,
  };
}
