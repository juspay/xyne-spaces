import { gcsService } from './gcsService.js';
import { fileValidationService } from './fileValidationService.js';
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
      // Validate file using the validation service
      const validationResult = await fileValidationService.validateFile({
        buffer: file.buffer,
        originalName: file.originalname,
        mimeType: file.mimetype,
        size: file.size,
      });

      if (!validationResult.isValid) {
        throw new Error(`File validation failed for ${file.originalname}: ${validationResult.errors.join(', ')}`);
      }

      // Log validation warnings
      if (validationResult.warnings.length > 0) {
        logger.warn(`File validation warnings for ${file.originalname}:`, validationResult.warnings);
      }

      // Upload to GCS
      const gcsResult = await gcsService.uploadFile(file.buffer, {
        filename: validationResult.sanitizedFilename || file.originalname,
        contentType: file.mimetype,
        metadata: {
          originalName: file.originalname,
          uploadedAt: new Date().toISOString(),
        },
        scopeType: 'CONVERSATION',
        scopeId: 'temp', // Will be updated by caller
      });

      // Handle thumbnail for video and document files (frontend-generated)
      let thumbnailUrl: string | undefined;
      const isVideo = file.mimetype.startsWith('video/');
      const isDocument = [
        'application/pdf',
        'application/msword',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'application/vnd.ms-excel',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'text/csv',
        'text/comma-separated-values',
      ].includes(file.mimetype);
      if ((isVideo || isDocument) && metadataMap.size > 0 && thumbnailFiles) {
        // Get metadata for this file using O(1) map lookup
        const metadata = metadataMap.get(fileIndex);

        if (metadata?.hasThumbnail && metadata.thumbnailIndex !== undefined) {
          // Get the thumbnail using the explicit index from metadata
          const frontendThumbnail = thumbnailFiles[metadata.thumbnailIndex];

          if (frontendThumbnail) {
            try {
              logger.info(`Using frontend-generated thumbnail (index ${metadata.thumbnailIndex}) for video: ${file.originalname}`);

              // Generate thumbnail filename: strip original extension and append _thumb.jpg
              const thumbnailFilename = gcsResult.gcsPath.replace(/\.[^/.]+$/, '') + '_thumb.jpg';

              // Upload frontend-generated thumbnail to GCS
              const thumbnailGcsResult = await gcsService.uploadFile(frontendThumbnail.buffer, {
                filename: thumbnailFilename,
                contentType: 'image/jpeg',
                metadata: {
                  originalName: file.originalname,
                  uploadedAt: new Date().toISOString(),
                  isThumbnail: 'true',
                  originalFile: gcsResult.gcsPath,
                },
                scopeType: 'CONVERSATION',
                scopeId: 'temp', // Will be updated by caller
              });

              thumbnailUrl = thumbnailGcsResult.gcsPath;
              logger.info(`Frontend thumbnail uploaded successfully: ${thumbnailUrl}`);
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
        fileName: validationResult.sanitizedFilename || file.originalname,
        fileSize: gcsResult.size,
        mimeType: file.mimetype,
        fileUrl: gcsResult.gcsPath,
        thumbnailUrl,
        width,
        height,
        metadata: {
          uploadedAt: new Date().toISOString(),
          originalSize: file.size,
          gcsPath: gcsResult.gcsPath,
          sanitized: validationResult.sanitizedFilename !== file.originalname,
          validationWarnings: validationResult.warnings,
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