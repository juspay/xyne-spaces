import { storageService } from './storage/index.js';
import { logger } from '../utils/logger';

export interface UploadedFileResult {
  originalName: string;
  fileName: string;
  fileSize: number;
  mimeType: string;
  fileUrl: string;
  thumbnailUrl?: string;
  width?: number; // Width in pixels (for images/videos)
  height?: number; // Height in pixels (for images/videos)
  metadata?: Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
}

interface FileMetadata {
  fileIndex: number;
  hasThumbnail: boolean;
  thumbnailIndex?: number;
  width?: number; // Width in pixels (from frontend)
  height?: number; // Height in pixels (from frontend)
  duration?: number; // Duration in seconds (for videos, from frontend)
}

function getExistingStoragePath(file: Express.Multer.File): string | undefined {
  if (typeof file.path === 'string' && file.path.startsWith('attachments/')) {
    return file.path;
  }
  return undefined;
}

/**
 * Upload files to GCS without creating database records
 * This function only handles file upload and returns file information
 * @param files - Array of files to upload
 * @param thumbnailFiles - Optional array of thumbnail files (matched by metadata mapping)
 * @param fileMetadata - Optional metadata mapping files to their thumbnails
 */
export async function uploadFiles(
  files: Express.Multer.File[],
  thumbnailFiles?: Express.Multer.File[],
  fileMetadata?: FileMetadata[]
): Promise<UploadedFileResult[]> {
  logger.info(`Processing ${files.length} files for upload`);

  // Pre-build metadata map for O(1) lookups instead of O(n) for each file
  const metadataMap = new Map<number, FileMetadata>();
  if (fileMetadata) {
    for (const meta of fileMetadata) {
      metadataMap.set(meta.fileIndex, meta);
    }
  }

  const uploadPromises = files.map(async (file, fileIndex): Promise<UploadedFileResult> => {
    try {
      const existingStoragePath = getExistingStoragePath(file);
      let filePath = existingStoragePath;
      let fileSize = file.size;

      if (!filePath) {
        if (!file.buffer || file.buffer.length === 0) {
          throw new Error(`No file content found for ${file.originalname}`);
        }

        const storageResult = await storageService.uploadFile(file.buffer, {
          filename: file.originalname,
          contentType: file.mimetype || 'application/octet-stream',
          metadata: {
            originalName: file.originalname,
            uploadedAt: new Date().toISOString(),
          },
          scopeType: 'CONVERSATION',
          scopeId: 'temp',
        });

        filePath = storageResult.path;
        fileSize = storageResult.size;
      }

      if (!filePath) {
        throw new Error(`Storage path missing after upload for ${file.originalname}`);
      }

      // Handle thumbnail for video and document files (frontend-generated)
      let thumbnailUrl: string | undefined;
      const fileMimeType = file.mimetype || 'application/octet-stream';
      const isVideo = fileMimeType.startsWith('video/');
      const isDocument = [
        'application/pdf',
        'application/msword',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'application/vnd.ms-excel',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'text/csv',
        'text/comma-separated-values',
      ].includes(fileMimeType);
      if ((isVideo || isDocument) && metadataMap.size > 0 && thumbnailFiles) {
        // Get metadata for this file using O(1) map lookup
        const metadata = metadataMap.get(fileIndex);

        if (metadata?.hasThumbnail && metadata.thumbnailIndex !== undefined) {
          // Get the thumbnail using the explicit index from metadata
          const frontendThumbnail = thumbnailFiles[metadata.thumbnailIndex];

          if (frontendThumbnail) {
            try {
              logger.info(`Using frontend-generated thumbnail (index ${metadata.thumbnailIndex}) for video: ${file.originalname}`);

              const existingThumbnailPath = getExistingStoragePath(frontendThumbnail);
              if (existingThumbnailPath) {
                thumbnailUrl = existingThumbnailPath;
              } else if (frontendThumbnail.buffer && frontendThumbnail.buffer.length > 0) {
                const thumbnailFilename = `${file.originalname}_thumb.jpg`;
                const thumbnailUpload = await storageService.uploadFile(frontendThumbnail.buffer, {
                  filename: thumbnailFilename,
                  contentType: frontendThumbnail.mimetype || 'image/jpeg',
                  metadata: {
                    originalName: file.originalname,
                    uploadedAt: new Date().toISOString(),
                    isThumbnail: 'true',
                    originalFile: filePath,
                  },
                  scopeType: 'CONVERSATION',
                  scopeId: 'temp',
                });
                thumbnailUrl = thumbnailUpload.path;
              } else {
                logger.warn(`Thumbnail file has no stream/buffer for ${file.originalname}`);
              }

              if (thumbnailUrl) {
                logger.info(`Frontend thumbnail uploaded successfully: ${thumbnailUrl}`);
              }
            } catch (error) {
              logger.error(`Failed to upload frontend thumbnail for ${file.originalname}:`, error);
              // Continue without thumbnail
            }
          } else {
            logger.warn(`Thumbnail index ${metadata.thumbnailIndex} not found in thumbnailFiles array for ${file.originalname}`);
          }
        } else if (metadata && !metadata.hasThumbnail) {
          logger.info(`No thumbnail expected for video: ${file.originalname} (per metadata)`);
        } else {
          logger.warn(`No metadata found for file at index ${fileIndex}: ${file.originalname}`);
        }
      }

      // Get dimensions from metadata (sent by frontend for images/videos)
      const metadata = metadataMap.get(fileIndex);
      const width = metadata?.width;
      const height = metadata?.height;
      
      const uploadedFile: UploadedFileResult = {
        originalName: file.originalname,
        fileName: file.originalname,
        fileSize: fileSize || file.size,
        mimeType: fileMimeType,
        fileUrl: filePath,
        thumbnailUrl,
        width,
        height,
        metadata: {
          uploadedAt: new Date().toISOString(),
          originalSize: file.size,
          gcsPath: filePath,
          proxied: !!existingStoragePath,
          ...(thumbnailUrl && { thumbnailGenerated: true }),
          ...(metadata?.duration && { duration: metadata.duration }),
        }
      };

      logger.info(`File uploaded successfully: ${file.originalname} -> ${uploadedFile.fileUrl}`);
      return uploadedFile;
      
    } catch (error) {
      logger.error(`Error uploading file ${file.originalname}:`, error);
      throw error;
    }
  });

  try {
    const results = await Promise.all(uploadPromises);
    logger.info(`Successfully uploaded ${results.length} files to GCS`);
    return results;
  } catch (error) {
    logger.error('Error in uploadFiles batch processing:', error);
    throw error;
  }
}
