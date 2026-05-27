/**
 * Attachment Converter Utility
 * Converts attachment data from request format to JAF Attachment format
 */

import type { Attachment } from '@juspay-jaf/jaf';
import {
  makeImageAttachment,
  makeDocumentAttachment,
  makeFileAttachment,
} from '@juspay-jaf/jaf/utils';
import type { AttachmentData } from '../types.js';
import { logger } from '../../../utils/logger.js';

/**
 * Supported document MIME types for JAF's makeDocumentAttachment
 * Note: JAF only supports these specific types. Other files (like PDFs) use makeFileAttachment.
 */
const SUPPORTED_DOCUMENT_TYPES = [
  'application/pdf',                                                            // .pdf
  'text/plain',                                                               // .txt
  'text/csv',                                                                  // .csv
  'application/json',                                                          // .json
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',  // .docx
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',        // .xlsx
];

/**
 * MIME type mapping for common file extensions
 */
const MIME_TYPE_MAP: Record<string, string> = {
  // Document types (supported by makeDocumentAttachment)
  'txt': 'text/plain',
  'csv': 'text/csv',
  'json': 'application/json',
  'docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  // File types (handled by makeFileAttachment)
  'pdf': 'application/pdf',
  'doc': 'application/msword',
  'xls': 'application/vnd.ms-excel',
  // Image types
  'png': 'image/png',
  'jpg': 'image/jpeg',
  'jpeg': 'image/jpeg',
  'gif': 'image/gif',
  'webp': 'image/webp',
  'svg': 'image/svg+xml',
};

/**
 * Convert MIME type based on file extension if needed
 * This handles cases where the client sends generic MIME types
 */
function correctMimeType(mimeType: string, filename?: string): string {
  // If MIME type is generic, try to determine from extension
  if (
    (mimeType === 'application/octet-stream' || mimeType === 'application/binary') &&
    filename
  ) {
    const extension = filename.toLowerCase().split('.').pop();

    if (extension && MIME_TYPE_MAP[extension]) {
      logger.debug(`[XyneAI] Corrected MIME type from ${mimeType} to ${MIME_TYPE_MAP[extension]} based on extension .${extension}`);
      return MIME_TYPE_MAP[extension];
    }
  }

  return mimeType;
}

/**
 * Convert a single attachment from request format to JAF Attachment format
 *
 * @param attachmentData - Attachment data from the request
 * @returns JAF Attachment object
 * @throws Error if attachment conversion fails
 */
export function convertToJAFAttachment(
  attachmentData: AttachmentData
): Attachment {
  const { data, mime_type: rawMimeType, filename } = attachmentData;

  // Correct MIME type if needed
  const mimeType = correctMimeType(rawMimeType, filename);

  // Create params object for JAF utility functions
  const params = {
    data,  // Base64 string
    mimeType,
    name: filename,
  };

  let attachment: Attachment;

  // Determine attachment kind and create appropriate JAF attachment
  if (mimeType.startsWith('image/')) {
    logger.debug(`[XyneAI] Creating image attachment: ${filename || 'unnamed'} (${mimeType})`);
    attachment = makeImageAttachment(params);
  } else if (SUPPORTED_DOCUMENT_TYPES.includes(mimeType)) {
    logger.debug(`[XyneAI] Creating document attachment: ${filename || 'unnamed'} (${mimeType})`);
    attachment = makeDocumentAttachment(params);
  } else {
    logger.debug(`[XyneAI] Creating file attachment: ${filename || 'unnamed'} (${mimeType})`);
    attachment = makeFileAttachment(params);
  }

  // Set useLiteLLMFormat flag for LiteLLM provider compatibility
  return {
    ...attachment,
    useLiteLLMFormat: true,
  };
}

/**
 * Convert multiple attachments from request format to JAF format
 *
 * @param attachments - Array of attachment data from the request
 * @returns Array of JAF Attachment objects
 * @throws Error if any attachment conversion fails
 */
export function convertAttachmentsToJAF(
  attachments?: AttachmentData[]
): Attachment[] {
  if (!attachments || attachments.length === 0) {
    return [];
  }

  logger.info(`[XyneAI] Converting ${attachments.length} attachment(s) to JAF format`);

  return attachments.map((attachment, index) => {
    try {
      return convertToJAFAttachment(attachment);
    } catch (error) {
      logger.error(
        `[XyneAI] Failed to convert attachment ${index + 1}:`,
        error
      );
      throw new Error(
        `Failed to process attachment ${index + 1}: ${
          error instanceof Error ? error.message : 'Unknown error'
        }`
      );
    }
  });
}
