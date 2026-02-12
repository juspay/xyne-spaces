/**
 * Xyne AI Attachment Upload Service
 *
 * Handles uploading attachments to GCS for Xyne AI sessions
 * - Converts base64 to Buffer
 * - Validates files
 * - Uploads to GCS bucket (xyne-spaces-chat-documents) under /attachments/ASKAI/ path
 * - Caches base64 in Redis for fast retrieval (6h TTL)
 * - Returns metadata for database storage
 */

import { GCSService } from './gcsService.js';
import { fileValidationService } from './fileValidationService.js';
import { redisService } from './redisService.js';
import { logger } from '../utils/logger.js';
import { config } from '../config/env.js';
import { v4 as uuidv4 } from 'uuid';
import type { AttachmentData } from '../agents/xyne-ai/types.js';

// Create GCS service instance for Xyne AI attachments (uses main chat documents bucket)
const askaiGcsService = new GCSService(config.gcs.bucketName);

// Redis cache configuration
const REDIS_CACHE_PREFIX = 'xyne-ai:askai-attachment:';
const CACHE_TTL_SECONDS = 12 * 60 * 60; // 12 hours

/**
 * Metadata structure stored in WorkflowStep.attachment column
 */
export interface XyneAIAttachmentMetadata {
  attachment_id: string;  // Unique ID for this attachment
  url: string;            // GCS path (e.g., "attachments/ASKAI/session_abc/2026/02/...")
  mime_type: string;      // MIME type (e.g., "image/png")
  file_name: string;      // Sanitized filename
  size: number;           // File size in bytes
}

/**
 * Validate base64 string
 */
function isValidBase64(str: string): boolean {
  if (!str || str.length === 0) return false;
  // Base64 regex: only allows valid base64 characters (A-Z, a-z, 0-9, +, /, =)
  const base64Regex = /^[A-Za-z0-9+/]*={0,2}$/;
  if (!base64Regex.test(str)) return false;
  // Check if length is valid (must be multiple of 4)
  if (str.length % 4 !== 0) return false;
  return true;
}

/**
 * Upload a single Xyne AI attachment to GCS
 *
 * @param attachmentData - Attachment data from request (base64)
 * @param sessionId - Session ID for scoping
 * @returns Metadata for database storage
 */
export async function uploadXyneAIAttachment(
  attachmentData: AttachmentData,
  sessionId: string
): Promise<XyneAIAttachmentMetadata> {
  try {
    const { data, mime_type, filename } = attachmentData;

    // 1. Validate base64 string
    if (!isValidBase64(data)) {
      throw new Error(`Invalid base64 data for file: ${filename || 'unknown'}`);
    }

    // 2. Convert base64 to Buffer
    const buffer = Buffer.from(data, 'base64');

    // 3. Validate file
    const validationResult = await fileValidationService.validateFile({
      buffer,
      originalName: filename || 'attachment',
      mimeType: mime_type,
      size: buffer.length,
    });

    if (!validationResult.isValid) {
      throw new Error(`File validation failed: ${validationResult.errors.join(', ')}`);
    }

    // Log validation warnings if any
    if (validationResult.warnings.length > 0) {
      logger.warn(`[XyneAI] [${sessionId}] File validation warnings:`, validationResult.warnings);
    }

    const sanitizedFilename = validationResult.sanitizedFilename || filename || 'attachment';

    // 4. Upload to GCS (xyne-spaces-chat-documents/attachments/ASKAI/)
    const gcsResult = await askaiGcsService.uploadFile(buffer, {
      filename: sanitizedFilename,
      contentType: mime_type,
      metadata: {
        originalName: filename || 'attachment',
        uploadedAt: new Date().toISOString(),
        sessionId,
        source: 'xyne-ai',
      },
      scopeType: 'ASKAI',
      scopeId: sessionId,
    });

    // 5. Generate attachment ID and metadata
    const metadata: XyneAIAttachmentMetadata = {
      attachment_id: uuidv4(),
      url: gcsResult.gcsPath,
      mime_type,
      file_name: sanitizedFilename,
      size: gcsResult.size,
    };

    logger.info(`[XyneAI] [${sessionId}] Successfully uploaded attachment to GCS: ${gcsResult.gcsPath}`);

    // 6. Cache attachment in Redis for fast retrieval (non-blocking)
    try {
      const cacheKey = `${REDIS_CACHE_PREFIX}${metadata.attachment_id}`;
      await redisService.set(cacheKey, data, CACHE_TTL_SECONDS);
      logger.info(`[XyneAI] [${sessionId}] Cached attachment in Redis: ${metadata.attachment_id} (TTL: ${CACHE_TTL_SECONDS}s)`);
    } catch (error) {
      // Non-fatal: Log warning but don't fail the upload
      logger.warn(`[XyneAI] [${sessionId}] Failed to cache attachment in Redis (attachment still uploaded):`, error);
    }

    return metadata;

  } catch (error) {
    logger.error(`[XyneAI] [${sessionId}] Failed to upload attachment to GCS:`, error);
    throw new Error(`Failed to upload attachment: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

/**
 * Upload multiple Xyne AI attachments to GCS
 *
 * @param attachments - Array of attachment data from request
 * @param sessionId - Session ID for scoping
 * @returns Array of metadata for database storage
 */
export async function uploadXyneAIAttachments(
  attachments: AttachmentData[],
  sessionId: string
): Promise<XyneAIAttachmentMetadata[]> {
  if (!attachments || attachments.length === 0) {
    return [];
  }

  // Upload all attachments in parallel
  const uploadPromises = attachments.map((attachment, index) =>
    uploadXyneAIAttachment(attachment, sessionId).catch(error => {
      logger.error(`[XyneAI] [${sessionId}] Failed to upload attachment ${index + 1}/${attachments.length}:`, error);
      throw error;
    })
  );

  try {
    const results = await Promise.all(uploadPromises);
    return results;
  } catch (error) {
    logger.error(`[XyneAI] [${sessionId}] Failed to upload attachments:`, error);
    throw error;
  }
}
