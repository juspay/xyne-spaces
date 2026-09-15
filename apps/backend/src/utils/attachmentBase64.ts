/**
 * Attachment Base64 Utility
 *
 * Provides functions to convert MessageAttachment files from GCS to base64.
 * Supports images, videos, audio, and documents.
 */

import { getStorageService } from '@/services/storage';
import { logger } from '@/utils/logger';
import { config } from '@/config/env';
import { MessageAttachment } from '@prisma/client';
import { AttachmentEntityType } from '@xyne/shared';

// ============================================================================
// Types
// ============================================================================

/**
 * Categorized media type based on mimetype
 */
export type MediaCategory = 'image' | 'video' | 'audio' | 'document' | 'other';

/**
 * Base64 encoded attachment result
 */
export interface Base64AttachmentResult {
    /** Original attachment ID */
    id: string;
    /** Original filename */
    originalFilename: string;
    /** MIME type (e.g., 'image/png', 'video/mp4') */
    mimetype: string;
    /** Categorized media type */
    mediaCategory: MediaCategory;
    /** Entity type (TICKET, CHAT, CANVAS, EMAIL) */
    entityType: AttachmentEntityType;
    /** Entity ID the attachment belongs to */
    entityId: string;
    /** Conversation ID */
    conversationId: string | null;
    /** Base64 encoded content (null if file too large) */
    base64Content: string | null;
    /** Data URI format: data:{mimetype};base64,{content} (null if file too large) */
    dataUri: string | null;
    /** File size in bytes */
    size: number;
    /** Image/video width if available */
    width: number | null;
    /** Image/video height if available */
    height: number | null;
    /** Whether thumbnail was used instead of original */
    usedThumbnail: boolean;
    /** Whether file was too large for base64 conversion (> 200MB) */
    exceedsMaxSize?: boolean;
}

/**
 * Options for base64 conversion
 */
export interface Base64ConversionOptions {
    /** Use thumbnail instead of original for images/videos if available (default: false) */
    preferThumbnail?: boolean;
    /** Only convert these media categories (default: all) */
    allowedCategories?: MediaCategory[];
    /** Exclude these media categories from conversion (default: none) */
    excludedCategories?: MediaCategory[];
}

// ============================================================================
// Constants
// ============================================================================

/**
 * Maximum file size for base64 conversion (20MB)
 * Files larger than this will return metadata only without base64 content
 */
const MAX_FILE_SIZE_FOR_BASE64 = 20 * 1024 * 1024; // 20MB in bytes

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Determine media category from mimetype
 */
export function getMediaCategory(mimetype: string): MediaCategory {
    const type = mimetype.toLowerCase();

    if (type.startsWith('image/')) return 'image';
    if (type.startsWith('video/')) return 'video';
    if (type.startsWith('audio/')) return 'audio';
    if (
        type.startsWith('application/pdf') ||
        type.startsWith('application/msword') ||
        type.startsWith('application/vnd.') ||
        type.startsWith('text/')
    ) {
        return 'document';
    }

    return 'other';
}

/**
 * Check if mimetype is image or video (for thumbnail support)
 */
export function hasMediaDimensions(mimetype: string): boolean {
    const category = getMediaCategory(mimetype);
    return category === 'image' || category === 'video';
}

/**
 * Parse GCS URL - handles both regular paths and gs:// format
 *
 * @param url - GCS path (e.g., "attachments/..." or "gs://bucket/path")
 * @returns { bucketName, filePath }
 */
function parseGcsUrl(url: string, attachment?: MessageAttachment): { bucketName: string; filePath: string } {
    // Handle gs://bucket/path format
    if (url.startsWith('gs://')) {
        const match = url.match(/^gs:\/\/([^\/]+)\/(.+)$/);
        if (match) {
            return { bucketName: match[1], filePath: match[2] };
        }
    }
    // Transcript attachments stored as relative paths live in the transcription bucket
    if (attachment) {
        const meta = attachment.metadata as { type?: string } | null;
        if (meta?.type === 'transcript' || meta?.type === 'identified_transcript') {
            return { bucketName: config.gcs.transcriptionBucketName, filePath: url };
        }
    }
    // Regular path - use default bucket from config
    return { bucketName: config.gcs.bucketName, filePath: url };
}

// Note: Storage service caching is now handled by getStorageService
// See: /backend/src/services/storage

// ============================================================================
// Main Functions
// ============================================================================

/**
 * Convert a single MessageAttachment to base64
 *
 * @param attachment - MessageAttachment from database
 * @param options - Conversion options
 * @returns Base64AttachmentResult or null if conversion fails/skipped
 *
 * @example
 * const attachment = await db.messageAttachment.findUnique({ where: { id } });
 * const base64 = await convertToBase64(attachment);
 * if (base64) {
 *   useBase64Data(base64.dataUri);
 * }
 */
export async function convertToBase64(
    attachment: MessageAttachment,
    options: Base64ConversionOptions = {}
): Promise<Base64AttachmentResult | null> {
    const { preferThumbnail = false, allowedCategories, excludedCategories } = options;

    const mediaCategory = getMediaCategory(attachment.mimetype);

    // Check if category is excluded
    if (excludedCategories && excludedCategories.includes(mediaCategory)) {
        logger.debug(`[AttachmentBase64] Skipping ${attachment.id}: category '${mediaCategory}' is excluded`);
        return null;
    }

    // Check if category is allowed
    if (allowedCategories && !allowedCategories.includes(mediaCategory)) {
        logger.debug(`[AttachmentBase64] Skipping ${attachment.id}: category '${mediaCategory}' not allowed`);
        return null;
    }

    // Determine which URL to fetch (original or thumbnail)
    let urlToFetch = attachment.url;
    let usedThumbnail = false;

    if (preferThumbnail && attachment.thumbnailUrl && hasMediaDimensions(attachment.mimetype)) {
        urlToFetch = attachment.thumbnailUrl;
        usedThumbnail = true;
        logger.debug(`[AttachmentBase64] Using thumbnail for ${attachment.id}`);
    }

    try {
        // Parse GCS URL
        const { bucketName, filePath } = parseGcsUrl(urlToFetch, attachment);

        // Get appropriate GCS service (cached globally to prevent resource leaks)
        const gcs = getStorageService(bucketName);

        // Check file size before fetching to prevent memory exhaustion
        // Note: attachment.size is the original file size from DB
        const fileSize = attachment.size || 0;

        if (fileSize > MAX_FILE_SIZE_FOR_BASE64) {
            logger.warn(
                `[AttachmentBase64] File ${attachment.id} (${(fileSize / 1024 / 1024).toFixed(2)}MB) exceeds ` +
                `max size (${MAX_FILE_SIZE_FOR_BASE64 / 1024 / 1024}MB). Returning metadata only.`
            );

            // Return metadata without base64 content
            return {
                id: attachment.id,
                originalFilename: attachment.originalFilename,
                mimetype: attachment.mimetype,
                mediaCategory,
                entityType: attachment.entityType as AttachmentEntityType,
                entityId: attachment.entityId,
                conversationId: attachment.conversationId,
                base64Content: null,
                dataUri: null,
                size: fileSize,
                width: attachment.width,
                height: attachment.height,
                usedThumbnail: false,
                exceedsMaxSize: true,
            };
        }

        logger.info(`[AttachmentBase64] Fetching ${attachment.id} from GCS: ${filePath} (${(fileSize / 1024 / 1024).toFixed(2)}MB)`);

        // Fetch file from GCS
        const buffer = await gcs.getFileBuffer(filePath);

        // Convert to base64
        const base64Content = buffer.toString('base64');
        const dataUri = `data:${attachment.mimetype};base64,${base64Content}`;

        logger.info(`[AttachmentBase64] Converted ${attachment.id}: ${buffer.length} bytes -> ${base64Content.length} chars`);

        return {
            id: attachment.id,
            originalFilename: attachment.originalFilename,
            mimetype: attachment.mimetype,
            mediaCategory,
            entityType: attachment.entityType as AttachmentEntityType,
            entityId: attachment.entityId,
            conversationId: attachment.conversationId,
            base64Content,
            dataUri,
            size: buffer.length,
            width: attachment.width,
            height: attachment.height,
            usedThumbnail,
            exceedsMaxSize: false,
        };
    } catch (error) {
        logger.error(`[AttachmentBase64] Failed to convert ${attachment.id}:`, error);
        return null;
    }
}

/**
 * Convert multiple MessageAttachments to base64
 *
 * @param attachments - Array of MessageAttachment records
 * @param options - Conversion options
 * @returns Array of successful conversions (failed ones are filtered out)
 */
export async function convertManyToBase64(
    attachments: MessageAttachment[],
    options: Base64ConversionOptions = {}
): Promise<Base64AttachmentResult[]> {
    logger.info(`[AttachmentBase64] Converting ${attachments.length} attachments`);

    const results: Base64AttachmentResult[] = [];

    for (const attachment of attachments) {
        const result = await convertToBase64(attachment, options);
        if (result) {
            results.push(result);
        }
    }

    logger.info(`[AttachmentBase64] Successfully converted ${results.length}/${attachments.length}`);
    return results;
}

/**
 * Convert only image/video attachments to base64
 * Convenience function for AI/LLM image analysis use cases
 *
 * @param attachments - Array of MessageAttachment records
 * @param preferThumbnail - Use thumbnail if available (default: false)
 * @returns Array of image/video attachments as base64
 */
export async function convertMediaToBase64(
    attachments: MessageAttachment[],
    preferThumbnail = false
): Promise<Base64AttachmentResult[]> {
    return convertManyToBase64(attachments, {
        allowedCategories: ['image', 'video'],
        preferThumbnail,
    });
}
