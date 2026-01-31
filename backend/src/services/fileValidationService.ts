import { config } from '../config/env';
import { logger } from '../utils/logger';

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

  // Allowed file types and their MIME types
  private readonly allowedMimeTypes = new Set([
    // Images
    'image/jpeg',
    'image/jpg',
    'image/png',
    'image/gif',
    'image/webp',
    'image/svg+xml',

    // Documents
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.ms-powerpoint',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',

    // Text files
    'text/plain',
    'text/markdown',
    'text/csv',
    'application/json',
    'application/xml',
    'text/xml',

    // Archive files
    'application/zip',
    'application/x-7z-compressed',
    'application/x-tar',
    'application/gzip',

    // Video files (common formats)
    'video/mp4',
    'video/webm',
    'video/avi',
    'video/quicktime',

    // Audio files (common formats)
    'audio/mpeg',
    'audio/wav',
    'audio/ogg',
    'audio/mp3',
  ]);

  // File extensions that are potentially dangerous
  private readonly dangerousExtensions = new Set([
    '.exe', '.bat', '.cmd', '.com', '.pif', '.scr', '.vbs', '.js', '.jar',
    '.msi', '.dll', '.sys', '.bin', '.sh', '.ps1', '.php', '.asp', '.jsp'
  ]);

  private readonly maxFileSizeBytes: number;

  private constructor() {
    this.maxFileSizeBytes = config.gcs.maxFileSizeMB * 1024 * 1024; // Convert MB to bytes
    logger.info('File validation service initialized', {
      maxFileSizeMB: config.gcs.maxFileSizeMB,
      allowedMimeTypesCount: this.allowedMimeTypes.size,
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

      // MIME type validation
      if (!this.allowedMimeTypes.has(input.mimeType.toLowerCase())) {
        errors.push(`File type '${input.mimeType}' is not allowed`);
      }

      // Filename validation
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
    // Remove path traversal attempts and unsafe characters
    return filename
      .replace(/[/\\:*?"<>|]/g, '_') // Replace filesystem unsafe chars
      .replace(/\.\./g, '_') // Replace path traversal attempts
      .replace(/^\.+/, '') // Remove leading dots
      .substring(0, 255) // Limit filename length
      .trim();
  }

  /**
   * Check if file type is allowed
   */
  isFileTypeAllowed(mimeType: string): boolean {
    return this.allowedMimeTypes.has(mimeType.toLowerCase());
  }

  /**
   * Get allowed file types for client-side validation
   */
  getAllowedMimeTypes(): string[] {
    return Array.from(this.allowedMimeTypes);
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