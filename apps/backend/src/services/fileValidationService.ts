import { config } from '../config/env';
import { logger } from '../utils/logger';
import {
  DANGEROUS_EXTENSIONS,
} from '@xyne/shared';

export interface FileValidationInput {
  buffer: Buffer;
  originalName: string;
  mimeType: string;
  size: number;
}

export interface FileValidationResult {
  isValid: boolean;
  errors: string[];
  warnings: string[];
  sanitizedFilename?: string;
}

export class FileValidationService {
  private static instance: FileValidationService;

  // File validation uses a blocklist approach — all file types are allowed
  // except for dangerous extensions that could execute code.
  // SECURITY NOTE: Certificate files (.pem) can contain sensitive private keys.
  // Ensure upload handling includes appropriate security measures such as:
  // - Encryption at rest
  // - Access logging
  // - Clear retention policies

  // File extensions that are potentially dangerous and should be blocked
  private readonly dangerousExtensions: Set<string> = new Set(DANGEROUS_EXTENSIONS);

  private readonly maxFileSizeBytes: number;

  private constructor() {
    this.maxFileSizeBytes = config.gcs.maxFileSizeMB * 1024 * 1024; // Convert MB to bytes
    logger.info('File validation service initialized', {
      maxFileSizeMB: config.gcs.maxFileSizeMB,
      dangerousExtensionsCount: this.dangerousExtensions.size,
    });
  }

  public static getInstance(): FileValidationService {
    if (!FileValidationService.instance) {
      FileValidationService.instance = new FileValidationService();
    }
    return FileValidationService.instance;
  }

  /**
   * Validate uploaded file
   */
  async validateFile(input: FileValidationInput): Promise<FileValidationResult> {
    logger.info(`File validation: checking ${input.originalName} (${input.size} bytes, ${input.mimeType})`);
    const errors: string[] = [];
    const warnings: string[] = [];

    try {
      // Basic validation
      if (!input.buffer || input.buffer.length === 0) {
        errors.push('File is empty');
      }

      if (!input.originalName || input.originalName.trim() === '') {
        errors.push('Filename is required');
      }

      if (!input.mimeType || input.mimeType.trim() === '') {
        errors.push('File type is required');
      }

      // Early return if basic validation fails
      if (errors.length > 0) {
        return {
          isValid: false,
          errors,
          warnings,
        };
      }

      // File size validation
      if (input.size > this.maxFileSizeBytes) {
        errors.push(`File size exceeds limit of ${config.gcs.maxFileSizeMB}MB`);
      }

      // Validate buffer size matches reported size (security check)
      if (input.buffer.length !== input.size) {
        errors.push(`File size mismatch: expected ${input.size} bytes, got ${input.buffer.length} bytes`);
      }

      // Dangerous extension validation (blocklist approach — all types allowed except dangerous ones)
      const fileExtension = this.getFileExtension(input.originalName);
      if (this.dangerousExtensions.has(fileExtension.toLowerCase())) {
        errors.push(`File extension '${fileExtension}' is not allowed for security reasons`);
      }

      // Sanitize filename
      const sanitizedFilename = this.sanitizeFilename(input.originalName);
      if (sanitizedFilename !== input.originalName) {
        warnings.push('Filename contains unsafe characters and will be sanitized');
      }

      // Basic content validation
      const contentValidation = this.validateFileContent(input.buffer, input.mimeType);
      if (!contentValidation.isValid) {
        errors.push(...contentValidation.errors);
      }
      warnings.push(...contentValidation.warnings);

      const result: FileValidationResult = {
        isValid: errors.length === 0,
        errors,
        warnings,
        sanitizedFilename,
      };

      logger.info('File validation completed', {
        filename: input.originalName,
        mimeType: input.mimeType,
        size: input.size,
        isValid: result.isValid,
        errorCount: errors.length,
        warningCount: warnings.length,
      });

      return result;
    } catch (error) {
      logger.error('Error during file validation:', error);
      return {
        isValid: false,
        errors: ['File validation failed due to internal error'],
        warnings,
      };
    }
  }

  /**
   * Validate file content based on MIME type
   */
  private validateFileContent(buffer: Buffer, mimeType: string): { isValid: boolean; errors: string[]; warnings: string[] } {
    const errors: string[] = [];
    const warnings: string[] = [];

    try {
      // Basic virus-like pattern detection (very basic)
      const content = buffer.toString('binary');

      // Check for suspicious patterns (basic heuristics)
      if (content.includes('eval(') || content.includes('exec(') || content.includes('system(')) {
        warnings.push('File contains potentially suspicious code patterns');
      }

      // MIME type specific validation
      if (mimeType.startsWith('image/')) {
        // Basic image validation - check for common image headers
        if (!this.isValidImageFile(buffer, mimeType)) {
          errors.push('File does not appear to be a valid image despite claiming to be one');
        }
      } else if (mimeType === 'application/pdf') {
        // Basic PDF validation
        if (buffer.subarray(0, 4).toString() !== '%PDF') {
          errors.push('File does not appear to be a valid PDF');
        }
      }

      return { isValid: errors.length === 0, errors, warnings };
    } catch (error) {
      logger.warn('Error validating file content:', error);
      return {
        isValid: true, // Don't fail validation due to content check errors
        errors: [],
        warnings: ['Could not perform content validation']
      };
    }
  }

  /**
   * Basic image file validation
   */
  private isValidImageFile(buffer: Buffer, mimeType: string): boolean {
    try {
      const header = buffer.subarray(0, 10);

      switch (mimeType) {
        case 'image/jpeg':
        case 'image/jpg':
          return header[0] === 0xFF && header[1] === 0xD8; // JPEG magic bytes
        case 'image/png':
          return header.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A])); // PNG signature
        case 'image/gif':
          return header.subarray(0, 6).toString() === 'GIF87a' || header.subarray(0, 6).toString() === 'GIF89a';
        case 'image/webp':
          return header.subarray(0, 4).toString() === 'RIFF' && header.subarray(8, 12).toString() === 'WEBP';
        default:
          return true; // For other image types, assume valid
      }
    } catch (error) {
      logger.warn('Error validating image file:', error);
      return true; // Don't fail validation due to header check errors
    }
  }

  /**
   * Get file extension from filename
   */
  private getFileExtension(filename: string): string {
    const lastDotIndex = filename.lastIndexOf('.');
    return lastDotIndex === -1 ? '' : filename.substring(lastDotIndex);
  }

  /**
   * Sanitize filename to remove unsafe characters
   */
  private sanitizeFilename(filename: string): string {
    const rawName = filename || 'unnamed_file';
    const lastDotIdx = rawName.lastIndexOf('.');

    let ext = '';
    let nameWithoutExt = rawName;

    if (lastDotIdx === 0) {
      ext = rawName;
      nameWithoutExt = '';
    } else if (lastDotIdx > 0) {
      ext = rawName.substring(lastDotIdx);
      nameWithoutExt = rawName.substring(0, lastDotIdx);
    }

    const maxBaseLength = Math.max(1, 255 - ext.length);

    let sanitizedBase = nameWithoutExt
      .replace(/[^a-zA-Z0-9 ._-]/g, '_')
      .replace(/\.\./g, '_')
      .replace(/^\.+/, '')
      .replace(/[\s.]+$/, '')
      .replace(/_+/g, '_')
      .replace(/^_|_$/g, '')
      .substring(0, maxBaseLength)
      .trim();

    if (!sanitizedBase) {
      sanitizedBase = `file_${Date.now()}`;
    }

    return sanitizedBase + ext;
  }

  /**
   * Check if file type is allowed (blocklist approach — checks extension is not dangerous)
   */
  isFileTypeAllowed(_mimeType: string, filename?: string): boolean {
    if (filename) {
      const ext = this.getFileExtension(filename);
      if (this.dangerousExtensions.has(ext.toLowerCase())) {
        return false;
      }
    }
    return true;
  }

  /**
   * Get dangerous file extensions that are blocked
   */
  getDangerousExtensions(): string[] {
    return Array.from(this.dangerousExtensions);
  }

  /**
   * Get max file size in bytes
   */
  getMaxFileSizeBytes(): number {
    return this.maxFileSizeBytes;
  }
}

// Export singleton instance
export const fileValidationService = FileValidationService.getInstance();