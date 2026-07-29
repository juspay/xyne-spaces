/**
 * Xyne AI Attachment Retrieval Service
 *
 * Fetches attachments from GCS (xyne-spaces-chat-documents/attachments/ASKAI/) and converts to base64 for JAF processing
 * Uses Redis cache for fast retrieval - checks cache first, falls back to GCS on miss
 * Used when building conversation history for follow-up queries
 */

import { getStorageService } from './storage/index.js';
import { redisService } from './redisService.js';
import { logger } from '../utils/logger.js';
import type { AttachmentMetadata } from '../agents/xyne-ai/storage/types.js';
import type { AttachmentData } from '../agents/xyne-ai/types.js';

// Create storage service instance for Xyne AI attachments
const askaiStorageService = getStorageService();

// Redis cache configuration
const REDIS_CACHE_PREFIX = 'xyne-ai:askai-attachment:';
const CACHE_TTL_SECONDS = 6 * 60 * 60; // 6 hours

/**
 * Fetch a single attachment with Redis cache
 * Checks cache first, falls back to GCS on miss
 *
 * @param metadata - GCS metadata from WorkflowStep.attachment column
 * @param sessionId - Session ID for logging
 * @returns AttachmentData with base64 for JAF
 */
async function fetchAttachmentFromGCS(
  metadata: AttachmentMetadata,
  sessionId?: string
): Promise<AttachmentData> {
  const logPrefix = sessionId ? `[${sessionId}]` : '';
  const cacheKey = `${REDIS_CACHE_PREFIX}${metadata.attachment_id}`;

  try {
    // 1. Check Redis cache first
    try {
      const cachedBase64 = await redisService.get(cacheKey);

      if (cachedBase64) {
        logger.info(`[XyneAI] ${logPrefix} ✅ Cache HIT for attachment: ${metadata.attachment_id}`);
        return {
          data: cachedBase64,
          mime_type: metadata.mime_type,
          filename: metadata.file_name,
        };
      }
    } catch (cacheError) {
      // Redis error - log warning and continue to GCS fetch
      logger.warn(`[XyneAI] ${logPrefix} Redis cache error (falling back to GCS):`, cacheError);
    }

    // 2. Cache miss or Redis error - fetch from GCS
    const buffer = await askaiStorageService.getFileBuffer(metadata.url);
    const base64 = buffer.toString('base64');

    // 3. Cache for future requests (fire-and-forget)
    redisService.set(cacheKey, base64, CACHE_TTL_SECONDS).catch(error => {
      logger.warn(`[XyneAI] ${logPrefix} Failed to cache attachment after GCS fetch:`, error);
    });

    logger.info(`[XyneAI] ${logPrefix} ✅ Fetched from GCS and cached: ${metadata.file_name}`);

    return {
      data: base64,
      mime_type: metadata.mime_type,
      filename: metadata.file_name,
    };

  } catch (error) {
    logger.error(`[XyneAI] ${logPrefix} Failed to fetch attachment from GCS: ${metadata.url}`, error);
    throw new Error(
      `Failed to fetch attachment "${metadata.file_name}": ${error instanceof Error ? error.message : 'Unknown error'}`
    );
  }
}

/**
 * Fetch multiple attachments from GCS in parallel
 *
 * @param attachmentMetadata - Array of GCS metadata
 * @param sessionId - Session ID for logging
 * @returns Array of AttachmentData with base64 for JAF
 */
export async function fetchAttachmentsFromGCS(
  attachmentMetadata: AttachmentMetadata[],
  sessionId?: string
): Promise<AttachmentData[]> {
  if (!attachmentMetadata || attachmentMetadata.length === 0) {
    return [];
  }

  const logPrefix = sessionId ? `[${sessionId}]` : '';

  // Fetch all attachments in parallel for better performance
  const fetchPromises = attachmentMetadata.map((metadata, index) =>
    fetchAttachmentFromGCS(metadata, sessionId).catch(error => {
      logger.error(
        `[XyneAI] ${logPrefix} Failed to retrieve attachment ${index + 1}/${attachmentMetadata.length}:`,
        error
      );
      // Re-throw to fail fast - we need all attachments for proper context
      throw error;
    })
  );

  try {
    const attachments = await Promise.all(fetchPromises);
    return attachments;
  } catch (error) {
    logger.error(`[XyneAI] ${logPrefix} Failed to retrieve attachments:`, error);
    throw error;
  }
}

/**
 * Fetch a single attachment by metadata (convenience method)
 *
 * @param metadata - Single GCS metadata object
 * @param sessionId - Session ID for logging
 * @returns Single AttachmentData with base64
 */
export async function fetchSingleAttachmentFromGCS(
  metadata: AttachmentMetadata,
  sessionId?: string
): Promise<AttachmentData> {
  return fetchAttachmentFromGCS(metadata, sessionId);
}
