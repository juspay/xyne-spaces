import { gcsService } from './gcsService';
import { fileValidationService } from './fileValidationService';
import { logger } from '../utils/logger';
import { ExternalSourceRepository } from '../database/repositories/externalSourceRepository';
import { decrypt } from './encryptionService';
import fetch from 'node-fetch';
import { v4 as uuidv4 } from 'uuid';
import path from 'path';
import { UploadedFileResult } from '@/services/fileUploadService';

export interface ExternalAttachment {
  fileName: string;
  fileUrl: string;
  mimeType?: string;
  size?: number;
}

export interface DownloadedAttachment {
  originalName: string;
  fileName: string;
  fileSize: number;
  mimeType: string;
  fileUrl: string;
  metadata?: Record<string, any>;
}

export interface DownloadAttachmentsOptions {
  /**
   * Maximum file size to download (in bytes)
   * Defaults to 50MB
   */
  maxFileSize?: number;

  /**
   * Timeout for download request (in ms)
   * Defaults to 30 seconds
   */
  timeout?: number;

  /**
   * Scope information for GCS storage
   */
  scopeType?: string;
  scopeId?: string;
}

/**
 * Platform-specific authentication handlers
 */
interface AuthHandler {
  getHeaders(credentials: any): Record<string, string>;
}

class ZohoAuthHandler implements AuthHandler {
  getHeaders(credentials: any): Record<string, string> {
    // Parse Zoho credentials: {"jwkSet":"...","apiKey":"...","apiUrl":"...","orgId":"..."}
    const { apiKey, orgId } = credentials;

    if (!apiKey) {
      throw new Error('Zoho apiKey not found in credentials');
    }

    const headers: Record<string, string> = {
      'Authorization': `Zoho-oauthtoken ${apiKey}`,
      'User-Agent': 'Xyne-Spaces-Backend/1.0'
    };

    // Add organization ID header if provided
    if (orgId) {
      headers['orgId'] = orgId;
    }

    return headers;
  }
}

class SlackAuthHandler implements AuthHandler {
  getHeaders(credentials: any): Record<string, string> {
    const { botToken, botOauthToken } = credentials;
    const token = botOauthToken || botToken;

    if (!token) {
      throw new Error('Slack botToken or botOauthToken not found in credentials');
    }

    return {
      'Authorization': `Bearer ${token}`,
      'User-Agent': 'Xyne-Spaces-Backend/1.0'
    };
  }
}

class DefaultAuthHandler implements AuthHandler {
  getHeaders(_credentials: any): Record<string, string> {
    // Generic handler - no authentication headers
    return {
      'User-Agent': 'Xyne-Spaces-Backend/1.0'
    };
  }
}

export class ExternalAttachmentService {
  private static readonly DEFAULT_MAX_FILE_SIZE = 500 * 1024 * 1024; // 50MB
  private static readonly DEFAULT_TIMEOUT = 200000; // 200 seconds

  private static readonly authHandlers: Record<string, AuthHandler> = {
    'zoho': new ZohoAuthHandler(),
    'slack': new SlackAuthHandler(),
    'default': new DefaultAuthHandler()
  };

  private externalSourceRepo: ExternalSourceRepository;

  constructor() {
    this.externalSourceRepo = new ExternalSourceRepository();
  }

  /**
   * Download attachments for a specific external source
   * Automatically handles platform-specific authentication
   */
  async downloadAttachmentsForSource(
    sourceName: string,
    attachments: ExternalAttachment[],
    options: DownloadAttachmentsOptions = {}
  ): Promise<DownloadedAttachment[]> {
    if (!attachments || attachments.length === 0) {
      return [];
    }

    logger.info(`Downloading ${attachments.length} attachments for source: ${sourceName}`);

    // Get external source configuration
    const source = await this.externalSourceRepo.findByName(sourceName);
    if (!source) {
      throw new Error(`External source not found: ${sourceName}`);
    }

    if (!source.isActive) {
      throw new Error(`External source is inactive: ${sourceName}`);
    }

    // Decrypt and parse credentials
    let credentials: any;
    try {
      const decryptedCredentials = decrypt(source.credentials);
      credentials = JSON.parse(decryptedCredentials);
    } catch (error) {
      logger.error(`Failed to decrypt/parse credentials for source: ${sourceName}`, error);
      throw new Error(`Invalid credentials for source: ${sourceName}`);
    }

    // Get authentication headers for this platform
    const authHandler = this.getAuthHandler(source.sourceType);
    const authHeaders = authHandler.getHeaders(credentials);

    // Download attachments with platform-specific authentication
    return this.downloadAttachments(
      attachments,
      authHeaders,
      {
        ...options,
        scopeType: options.scopeType || 'EXTERNAL_MESSAGE',
        scopeId: options.scopeId || source.sourceType
      }
    );
  }

  /**
   * Download multiple attachments with provided headers
   */
  private async downloadAttachments(
    attachments: ExternalAttachment[],
    headers: Record<string, string>,
    options: DownloadAttachmentsOptions
  ): Promise<DownloadedAttachment[]> {
    const downloadPromises = attachments.map(attachment =>
      this.downloadSingleAttachment(attachment, headers, options)
    );

    // Use Promise.allSettled to handle partial failures
    const results = await Promise.allSettled(downloadPromises);

    const successful: DownloadedAttachment[] = [];
    const failed: string[] = [];

    results.forEach((result, index) => {
      if (result.status === 'fulfilled' && result.value) {
        successful.push(result.value);
      } else {
        const fileName = attachments[index]?.fileName || `attachment-${index}`;
        const reason = result.status === 'rejected' ? result.reason : 'Unknown error';
        failed.push(`${fileName}: ${reason}`);
        logger.error(`Failed to download attachment ${fileName}:`, reason);
      }
    });

    if (failed.length > 0) {
      logger.warn(`Failed to download ${failed.length}/${attachments.length} attachments:`, failed);
    }

    logger.info(`Successfully downloaded ${successful.length}/${attachments.length} attachments`);
    return successful;
  }

  /**
   * Download a single attachment
   */
  private async downloadSingleAttachment(
    attachment: ExternalAttachment,
    authHeaders: Record<string, string>,
    options: DownloadAttachmentsOptions
  ): Promise<DownloadedAttachment | null> {
    const {
      maxFileSize = ExternalAttachmentService.DEFAULT_MAX_FILE_SIZE,
      timeout = ExternalAttachmentService.DEFAULT_TIMEOUT,
      scopeType = 'EXTERNAL_MESSAGE',
      scopeId = 'unknown'
    } = options;

    const { fileName, fileUrl, mimeType: expectedMimeType, size: expectedSize } = attachment;

    if (!fileUrl) {
      throw new Error(`No URL provided for attachment: ${fileName}`);
    }

    logger.debug(`Downloading attachment: ${fileName} from ${fileUrl}`);

    try {
      // Create fetch request with timeout
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeout);

      const response = await fetch(fileUrl, {
        method: 'GET',
        headers: authHeaders,
        signal: controller.signal
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      // Check content length
      const contentLength = response.headers.get('content-length');
      if (contentLength && parseInt(contentLength) > maxFileSize) {
        throw new Error(`File too large: ${contentLength} bytes (max: ${maxFileSize})`);
      }

      // Get file buffer
      const buffer = await response.buffer();

      if (buffer.length > maxFileSize) {
        throw new Error(`File too large: ${buffer.length} bytes (max: ${maxFileSize})`);
      }

      // Determine MIME type from response or fallback to expected
      let responseMimeType = response.headers.get('content-type')?.split(';')[0]?.trim();
      
      // If MIME type is ambiguous (binary/octet-stream or application/octet-stream), try to infer from file extension
      if (responseMimeType && (responseMimeType === 'binary/octet-stream' || responseMimeType === 'application/octet-stream')) {
        const extensionMimeType = this.getMimeTypeFromExtension(fileName);
        if (extensionMimeType) {
          logger.debug(`Inferred MIME type from extension: ${extensionMimeType} (original: ${responseMimeType})`);
          responseMimeType = extensionMimeType;
        }
      }
      
      const finalMimeType = responseMimeType || expectedMimeType || 'application/octet-stream';

      // Generate unique filename to avoid conflicts
      const fileExtension = path.extname(fileName) || this.getExtensionFromMimeType(finalMimeType);
      const baseName = path.basename(fileName, path.extname(fileName));
      const uniqueFileName = `${baseName}-${uuidv4().substring(0, 8)}${fileExtension}`;

      // Validate file
      const validationResult = await fileValidationService.validateFile({
        buffer,
        originalName: fileName,
        mimeType: finalMimeType,
        size: buffer.length
      });

      if (!validationResult.isValid) {
        throw new Error(`File validation failed: ${validationResult.errors.join(', ')}`);
      }

      // Log validation warnings
      if (validationResult.warnings.length > 0) {
        logger.warn(`File validation warnings for ${fileName}:`, validationResult.warnings);
      }

      // Upload to GCS
      const gcsResult = await gcsService.uploadFile(buffer, {
        filename: validationResult.sanitizedFilename || uniqueFileName,
        contentType: finalMimeType,
        metadata: {
          originalName: fileName,
          externalUrl: fileUrl,
          downloadedAt: new Date().toISOString(),
          expectedSize: expectedSize?.toString() || 'unknown',
          expectedMimeType: expectedMimeType || 'unknown'
        },
        scopeType,
        scopeId
      });

      return {
        originalName: fileName,
        fileName: gcsResult.filename,
        fileSize: gcsResult.size,
        mimeType: finalMimeType,
        fileUrl: gcsResult.gcsPath,
        metadata: {
          externalUrl: fileUrl,
          gcsPath: gcsResult.gcsPath,
          downloadedAt: new Date().toISOString()
        }
      };

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      logger.error(`Failed to download attachment ${fileName} from ${fileUrl}:`, errorMessage);
      throw new Error(`Download failed for ${fileName}: ${errorMessage}`);
    }
  }

  /**
   * Get authentication handler for source type
   */
  private getAuthHandler(sourceType: string): AuthHandler {
    return ExternalAttachmentService.authHandlers[sourceType] ||
           ExternalAttachmentService.authHandlers['default'];
  }

  /**
   * Get file extension from MIME type
   */
  private getExtensionFromMimeType(mimeType: string): string {
    const mimeToExt: Record<string, string> = {
      'image/jpeg': '.jpg',
      'image/png': '.png',
      'image/gif': '.gif',
      'image/webp': '.webp',
      'application/pdf': '.pdf',
      'text/plain': '.txt',
      'text/html': '.html',
      'application/json': '.json',
      'application/xml': '.xml',
      'application/zip': '.zip',
      'application/msword': '.doc',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document': '.docx',
      'application/vnd.ms-excel': '.xls',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': '.xlsx'
    };

    return mimeToExt[mimeType] || '';
  }

  /**
   * Get MIME type from file extension
   * Useful when the response MIME type is ambiguous (e.g., binary/octet-stream)
   */
  private getMimeTypeFromExtension(fileName: string): string | null {
    const extension = path.extname(fileName).toLowerCase();
    const extToMime: Record<string, string> = {
      // Images
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.png': 'image/png',
      '.gif': 'image/gif',
      '.webp': 'image/webp',
      '.svg': 'image/svg+xml',
      
      // Documents
      '.pdf': 'application/pdf',
      '.doc': 'application/msword',
      '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      '.xls': 'application/vnd.ms-excel',
      '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      '.ppt': 'application/vnd.ms-powerpoint',
      '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      
      // Text files
      '.txt': 'text/plain',
      '.md': 'text/markdown',
      '.csv': 'text/csv',
      '.json': 'application/json',
      '.xml': 'application/xml',
      '.html': 'text/html',
      '.htm': 'text/html',
      
      // Archives
      '.zip': 'application/zip',
      '.7z': 'application/x-7z-compressed',
      '.tar': 'application/x-tar',
      '.gz': 'application/gzip',
      
      // Video
      '.mp4': 'video/mp4',
      '.webm': 'video/webm',
      '.avi': 'video/avi',
      '.mov': 'video/quicktime',
      
      // Audio
      '.mp3': 'audio/mpeg',
      '.wav': 'audio/wav',
      '.ogg': 'audio/ogg'
    };

    return extToMime[extension] || null;
  }

  /**
   * Static factory method for convenience
   */
  static async downloadForSource(
    sourceName: string,
    attachments: ExternalAttachment[],
    options: DownloadAttachmentsOptions = {}
  ): Promise<DownloadedAttachment[]> {
    const service = new ExternalAttachmentService();
    return service.downloadAttachmentsForSource(sourceName, attachments, options);
  }
}
export class AttachmentConversionService {
  /**
   * Convert DownloadedAttachment[] to UploadedFileResult[]
   * Used to bridge external attachment downloads with conversation service
   */
  static convertDownloadedToUploaded(downloadedAttachments: DownloadedAttachment[]): UploadedFileResult[] {
    return downloadedAttachments.map(attachment => {
      const uploadedFile: UploadedFileResult = {
        originalName: attachment.originalName,
        fileName: attachment.fileName,
        fileSize: attachment.fileSize,
        mimeType: attachment.mimeType,
        fileUrl: attachment.fileUrl,
        thumbnailUrl: undefined, // External attachments typically don't have thumbnails
        metadata: {
          ...attachment.metadata,
          // Add marker to indicate this came from external source
          source: 'external_download',
          convertedAt: new Date().toISOString()
        }
      };

      return uploadedFile;
    });
  }

  /**
   * Validate that downloaded attachments are in the expected format
   */
  static validateDownloadedAttachments(attachments: DownloadedAttachment[]): void {
    for (const attachment of attachments) {
      if (!attachment.originalName) {
        throw new Error('Downloaded attachment missing originalName');
      }
      if (!attachment.fileName) {
        throw new Error('Downloaded attachment missing fileName');
      }
      if (!attachment.fileUrl) {
        throw new Error('Downloaded attachment missing fileUrl');
      }
      if (!attachment.mimeType) {
        throw new Error('Downloaded attachment missing mimeType');
      }
      if (typeof attachment.fileSize !== 'number' || attachment.fileSize < 0) {
        throw new Error('Downloaded attachment has invalid fileSize');
      }
    }
  }
}