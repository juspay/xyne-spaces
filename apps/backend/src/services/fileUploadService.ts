import { storageService } from './storage/index.js';
import { logger } from '../utils/logger';
import { createRequire } from 'module';
import { decodeUploadFilename } from '../utils/filename';

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

const require = createRequire(import.meta.url);
const sharp = require('sharp') as (input: Buffer, options?: Record<string, unknown>) => {
  resize(options: Record<string, unknown>): {
    png(): { toBuffer(): Promise<Buffer> };
  };
};

const SVG_THUMBNAIL_MAX_SIZE = 600;

const isSvgMimeType = (mimeType: string): boolean => {
  return mimeType.split(';')[0]?.trim().toLowerCase() === 'image/svg+xml';
};

const hasSvgExtension = (filename: string): boolean => filename.toLowerCase().endsWith('.svg');

const isSvgUpload = (file: Express.Multer.File, decodedName: string): boolean => {
  return isSvgMimeType(file.mimetype || '') || hasSvgExtension(decodedName);
};

const sanitizeSvgForThumbnail = (svg: string): string => {
  const activeContentPattern = /<(?:script|foreignObject|iframe|object|embed)\b/i;
  const externalReferencePattern = /(?:href|xlink:href|src)\s*=\s*["']\s*(?:https?:|file:|\/\/)/i;
  const cssExternalReferencePattern = /url\s*\(\s*["']?\s*(?:https?:|file:|\/\/)/i;

  if (activeContentPattern.test(svg)) {
    throw new Error('SVG contains active content');
  }

  if (externalReferencePattern.test(svg) || cssExternalReferencePattern.test(svg)) {
    throw new Error('SVG contains external resource references');
  }

  return svg
    .replace(/<\?xml[^>]*>/gi, '')
    .replace(/<!DOCTYPE[^>]*(?:\[[\s\S]*?\])?>/gi, '')
    .replace(/\son[a-z]+\s*=\s*("[^"]*"|'[^']*')/gi, '');
};

const generateSvgPngThumbnail = async (file: Express.Multer.File): Promise<Buffer | null> => {
  if (!file.buffer || file.buffer.length === 0) {
    return null;
  }

  const sanitizedSvg = sanitizeSvgForThumbnail(file.buffer.toString('utf8'));

  return sharp(Buffer.from(sanitizedSvg), {
    animated: false,
    failOn: 'error',
    limitInputPixels: 4096 * 4096,
  })
    .resize({
      width: SVG_THUMBNAIL_MAX_SIZE,
      height: SVG_THUMBNAIL_MAX_SIZE,
      fit: 'inside',
      withoutEnlargement: true,
    })
    .png()
    .toBuffer();
};

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
      // Repair multipart latin1 mojibake at upload time so the stored name is correct (chat + search).
      // Deliberately write-path only: new uploads are fixed; existing rows stay untouched (no backfill).
      const decodedName = decodeUploadFilename(file.originalname);
      const existingStoragePath = getExistingStoragePath(file);
      let filePath = existingStoragePath;
      let fileSize = file.size;

      if (!filePath) {
        if (!file.buffer || file.buffer.length === 0) {
          throw new Error(`No file content found for ${file.originalname}`);
        }

        const storageResult = await storageService.uploadFile(file.buffer, {
          filename: decodedName,
          contentType: file.mimetype || 'application/octet-stream',
          metadata: {
            originalName: decodedName,
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
      if (isSvgUpload(file, decodedName)) {
        try {
          const generatedThumbnail = await generateSvgPngThumbnail(file);
          if (generatedThumbnail) {
            const thumbnailUpload = await storageService.uploadFile(generatedThumbnail, {
              filename: `${decodedName}_thumb.png`,
              contentType: 'image/png',
              metadata: {
                originalName: decodedName,
                uploadedAt: new Date().toISOString(),
                isThumbnail: 'true',
                originalFile: filePath,
                generatedFrom: 'svg',
              },
              scopeType: 'CONVERSATION',
              scopeId: 'temp',
            });
            thumbnailUrl = thumbnailUpload.path;
            logger.info(`Generated PNG thumbnail for SVG upload: ${file.originalname} -> ${thumbnailUrl}`);
          }
        } catch (error) {
          logger.warn(`Failed to generate SVG thumbnail for ${file.originalname}; falling back to SVG file card`, error);
        }
      }

      if (!thumbnailUrl && (isVideo || isDocument) && metadataMap.size > 0 && thumbnailFiles) {
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
        originalName: decodedName,
        fileName: decodedName,
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
