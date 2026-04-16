import { Storage, Bucket, StorageOptions } from '@google-cloud/storage';
import { config } from '../config/env';
import { logger } from '../utils/logger';
import { v4 as uuidv4 } from 'uuid';

export interface GCSUploadOptions {
  filename: string;
  contentType: string;
  metadata?: Record<string, string>;
  scopeType?: string;
  scopeId?: string;
}

export interface GCSUploadResult {
  filename: string;
  gcsPath: string;
  size: number;
}

export interface GCSDeleteResult {
  filename: string;
  deleted: boolean;
}

export class GCSService {
  private static instance: GCSService;
  private storage: Storage;
  private bucket: Bucket;
  private bucketName: string;

  public constructor(bucketName?: string) {
    this.bucketName = bucketName || config.gcs.bucketName;

    // Use fake-gcs-server in development/test, real GCS in production
    const isEnvTestOrDevelopment = process.env.NODE_ENV === 'development' || process.env.NODE_ENV === 'test';
    const storageOptions: StorageOptions = {
      projectId: config.gcs.projectId,
    };

    if (isEnvTestOrDevelopment && config.gcs.fakeGcsHost) {
      // Point to fake-gcs-server for local development/test (only if FAKE_GCS_HOST is set)
      storageOptions.apiEndpoint = `http://${config.gcs.fakeGcsHost}`;
      logger.info(`GCS Service initialized with fake-gcs-server at ${config.gcs.fakeGcsHost} for bucket: ${this.bucketName}`);
    } else {
      // Use Application Default Credentials for authentication
      // In GKE: Uses Workload Identity
      // In production: Uses service account
      // In development without FAKE_GCS_HOST: Uses real GCS with ADC
      logger.info(`GCS Service initialized with Application Default Credentials for bucket: ${this.bucketName}`);
    }

    this.storage = new Storage(storageOptions);
    this.bucket = this.storage.bucket(this.bucketName);
  }

  public static getInstance(): GCSService {
    if (!GCSService.instance) {
      GCSService.instance = new GCSService();
    }
    return GCSService.instance;
  }

  /**
   * Upload file buffer to GCS with proper folder structure
   */
  async uploadFile(
    buffer: Buffer,
    options: GCSUploadOptions
  ): Promise<GCSUploadResult> {
    try {
      // Validate inputs
      if (!buffer || buffer.length === 0) {
        throw new Error('File buffer is empty or invalid');
      }

      if (!options.filename) {
        throw new Error('Filename is required');
      }

      if (!options.contentType) {
        throw new Error('Content type is required');
      }

      // Generate structured file path
      const filePath = this.generateFilePath(options);

      logger.info(`Uploading file to GCS: ${filePath}`, {
        filename: options.filename,
        contentType: options.contentType,
        size: buffer.length,
        scopeType: options.scopeType,
        scopeId: options.scopeId,
      });

      // Create file object in bucket
      const file = this.bucket.file(filePath);

      // Upload with metadata
      const uploadOptions = {
        metadata: {
          contentType: options.contentType,
          cacheControl: 'public, max-age=31536000', // 1 year cache
          ...options.metadata,
        },
        resumable: false, // Use simple upload for files under 5MB
      };

      await file.save(buffer, uploadOptions);

      // Get file metadata for size
      const [metadata] = await file.getMetadata();
      const fileSize = parseInt(String(metadata.size || '0'), 10);

      const result: GCSUploadResult = {
        filename: filePath,
        gcsPath: filePath,
        size: fileSize,
      };

      logger.info(`File uploaded successfully to GCS: ${filePath}`, {
        size: fileSize,
      });

      return result;
    } catch (error) {
      logger.error('Failed to upload file to GCS:', error);

      if (error instanceof Error) {
        // Re-throw with more context
        throw new Error(`GCS upload failed: ${error.message}`);
      }

      throw new Error('GCS upload failed: Unknown error');
    }
  }

  /**
   * Upload file buffer to GCS at an exact path without any modifications
   * Use this when you need full control over the file path
   */
  async uploadFileV2(
    buffer: Buffer,
    options: {
      path: string;
      contentType: string;
      metadata?: Record<string, string>;
    }
  ): Promise<GCSUploadResult> {
    try {
      // Validate inputs
      if (!buffer || buffer.length === 0) {
        throw new Error('File buffer is empty or invalid');
      }

      if (!options.path) {
        throw new Error('Path is required');
      }

      if (!options.contentType) {
        throw new Error('Content type is required');
      }

      // Use the exact path provided, no modifications
      const filePath = options.path;

      logger.info(`Uploading file to GCS at exact path: ${filePath}`, {
        contentType: options.contentType,
        size: buffer.length,
      });

      // Create file object in bucket
      const file = this.bucket.file(filePath);

      // Upload with metadata
      const uploadOptions = {
        metadata: {
          contentType: options.contentType,
          cacheControl: 'public, max-age=31536000', // 1 year cache
          ...options.metadata,
        },
        resumable: false, // Use simple upload for files under 5MB
      };

      await file.save(buffer, uploadOptions);

      // Get file metadata for size
      const [metadata] = await file.getMetadata();
      const fileSize = parseInt(String(metadata.size || '0'), 10);

      const result: GCSUploadResult = {
        filename: filePath,
        gcsPath: filePath,
        size: fileSize,
      };

      logger.info(`File uploaded successfully to GCS: ${filePath}`, {
        size: fileSize,
      });

      return result;
    } catch (error) {
      logger.error('Failed to upload file to GCS:', error);

      if (error instanceof Error) {
        throw new Error(`GCS upload failed: ${error.message}`);
      }

      throw new Error('GCS upload failed: Unknown error');
    }
  }

  /**
   * Delete file from GCS
   */
  async deleteFile(filename: string): Promise<GCSDeleteResult> {
    try {
      if (!filename) {
        throw new Error('Filename is required for deletion');
      }

      logger.info(`Deleting file from GCS: ${filename}`);

      const file = this.bucket.file(filename);

      // Check if file exists before deletion
      const [exists] = await file.exists();
      if (!exists) {
        logger.warn(`File does not exist in GCS: ${filename}`);
        return { filename, deleted: false };
      }

      await file.delete();

      logger.info(`File deleted successfully from GCS: ${filename}`);
      return { filename, deleted: true };
    } catch (error) {
      logger.error(`Failed to delete file from GCS: ${filename}`, error);

      if (error instanceof Error) {
        throw new Error(`GCS deletion failed: ${error.message}`);
      }

      throw new Error('GCS deletion failed: Unknown error');
    }
  }

  /**
   * Generate a new signed URL for an existing file
   */
  async generateSignedUrl(
    filename: string,
    expirationHours: number = 24
  ): Promise<string> {
    try {
      if (!filename) {
        throw new Error('Filename is required for signed URL generation');
      }

      const file = this.bucket.file(filename);

      // Check if file exists
      const [exists] = await file.exists();
      if (!exists) {
        throw new Error(`File does not exist: ${filename}`);
      }

      const [signedUrl] = await file.getSignedUrl({
        action: 'read',
        expires: Date.now() + expirationHours * 60 * 60 * 1000,
      });

      return signedUrl;
    } catch (error) {
      logger.error(`Failed to generate signed URL for: ${filename}`, error);

      if (error instanceof Error) {
        throw new Error(`Signed URL generation failed: ${error.message}`);
      }

      throw new Error('Signed URL generation failed: Unknown error');
    }
  }

  /**
   * Check if file exists in GCS
   */
  async fileExists(filename: string): Promise<boolean> {
    try {
      const file = this.bucket.file(filename);
      const [exists] = await file.exists();
      return exists;
    } catch (error) {
      logger.error(`Failed to check file existence: ${filename}`, error);
      return false;
    }
  }

  /**
   * Get file metadata from GCS
   */
  async getFileMetadata(filename: string): Promise<any> {
    try {
      const file = this.bucket.file(filename);
      const [metadata] = await file.getMetadata();
      return metadata;
    } catch (error) {
      logger.error(`Failed to get file metadata: ${filename}`, error);
      throw new Error(`Failed to get file metadata: ${error}`);
    }
  }

  /**
   * Get file content as buffer from GCS with retry mechanism
   * Retries are needed because blob finalization can take a moment after stream closes
   * Since webhook is called after upload completes, 3 retries should be sufficient
   */
  async getFileBuffer(gcsPath: string, maxRetries: number = 3): Promise<Buffer> {
    const initialDelay = 1000; // 1 second
    let lastError: Error | undefined;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        if (!gcsPath) {
          throw new Error('GCS path is required for file content retrieval');
        }

        const file = this.bucket.file(gcsPath);

        // Check if file exists
        const [exists] = await file.exists();
        if (!exists) {
          throw new Error(`File does not exist in GCS: ${gcsPath}`);
        }

        // Try to download the file
        const [buffer] = await file.download();

        if (attempt > 1) {
          logger.info(`Successfully fetched file from GCS after ${attempt} attempts: ${gcsPath}`);
        }

        return buffer;
      } catch (error) {
        lastError = error instanceof Error ? error : new Error('Unknown error');

        // If this is the last attempt, don't retry
        if (attempt === maxRetries) {
          break;
        }

        // Calculate exponential backoff delay: 1s, 2s, 4s
        const delay = initialDelay * Math.pow(2, attempt - 1);

        logger.warn(
          `Attempt ${attempt}/${maxRetries} failed to fetch file from GCS: ${gcsPath}. ` +
          `Retrying in ${delay}ms... Error: ${lastError.message}`
        );

        // Wait before retrying
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }

    // All retries exhausted
    logger.error(`Failed to get file buffer from GCS after ${maxRetries} attempts: ${gcsPath}`, lastError);

    if (lastError instanceof Error) {
      throw new Error(`GCS file read failed after ${maxRetries} attempts: ${lastError.message}`);
    }

    throw new Error('GCS file read failed: Unknown error');
  }

  /**
   * Download file from GCS to local path
   */
  async downloadFile(gcsPath: string, localPath: string): Promise<void> {
    try {
      if (!gcsPath) {
        throw new Error('GCS path is required for file download');
      }

      if (!localPath) {
        throw new Error('Local path is required for file download');
      }

      const file = this.bucket.file(gcsPath);

      // Check if file exists
      const [exists] = await file.exists();
      if (!exists) {
        throw new Error(`File does not exist in GCS: ${gcsPath}`);
      }

      logger.info(`Downloading file from GCS: ${gcsPath} to ${localPath}`);

      await file.download({ destination: localPath });

      logger.info(`File downloaded successfully: ${localPath}`);
    } catch (error) {
      logger.error(`Failed to download file from GCS: ${gcsPath}`, error);

      if (error instanceof Error) {
        throw new Error(`GCS download failed: ${error.message}`);
      }

      throw new Error('GCS download failed: Unknown error');
    }
  }

  /**
   * Create a readable stream from GCS with optional range support
   * This enables video streaming with seek support
   */
  async createReadStream(
    gcsPath: string,
    options?: { start?: number; end?: number }
  ): Promise<NodeJS.ReadableStream> {
    try {
      if (!gcsPath) {
        throw new Error('GCS path is required for creating read stream');
      }

      const file = this.bucket.file(gcsPath);

      // Check if file exists
      const [exists] = await file.exists();
      if (!exists) {
        throw new Error(`File does not exist in GCS: ${gcsPath}`);
      }

      // Create stream with optional range
      const streamOptions: { start?: number; end?: number } = {};
      if (options?.start !== undefined) {
        streamOptions.start = options.start;
      }
      if (options?.end !== undefined) {
        streamOptions.end = options.end;
      }

      logger.info(`Creating read stream for: ${gcsPath}`, streamOptions);

      return file.createReadStream(streamOptions);
    } catch (error) {
      logger.error(`Failed to create read stream for: ${gcsPath}`, error);

      if (error instanceof Error) {
        throw new Error(`Stream creation failed: ${error.message}`);
      }

      throw new Error('Stream creation failed: Unknown error');
    }
  }

  /**
   * Generate structured file path based on scope and timestamp
   * Format: attachments/{scopeType}/{scopeId}/{year}/{month}/{timestamp}-{uuid}-{filename}
   */
  private generateFilePath(options: GCSUploadOptions): string {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const timestamp = now.getTime();
    const uuid = uuidv4().split('-')[0]; // Use short UUID for uniqueness

    // Sanitize filename to remove unsafe characters
    const sanitizedFilename = this.sanitizeFilename(options.filename);

    // Build path components for attachments
    const pathComponents = ['attachments'];

    if (options.scopeType && options.scopeId) {
      pathComponents.push(options.scopeType, options.scopeId);
    }

    pathComponents.push(String(year), month);

    const finalFilename = `${timestamp}-${uuid}-${sanitizedFilename}`;
    pathComponents.push(finalFilename);

    return pathComponents.join('/');
  }

  /**
   * Sanitize filename to remove unsafe characters
   */
  private sanitizeFilename(filename: string): string {
    // Handle completely empty filename
    if (!filename || filename.trim().length === 0) {
      return 'file';
    }

    // Extract file extension before sanitization
    const lastDotIndex = filename.lastIndexOf('.');
    const extension = lastDotIndex > 0 ? filename.substring(lastDotIndex).toLowerCase() : '';
    const nameWithoutExtension = lastDotIndex > 0 ? filename.substring(0, lastDotIndex) : filename;

    // Handle edge case where filename starts with dot (hidden file) and has no name part
    if (lastDotIndex === 0) {
      return 'file' + filename; // Keep the full extension part
    }

    // Sanitize the filename part (without extension)
    let sanitized = nameWithoutExtension
      .replace(/[^a-zA-Z0-9.-]/g, '_') // Replace unsafe chars with underscore
      .replace(/_+/g, '_') // Replace multiple underscores with single
      .replace(/^_|_$/g, '') // Remove leading/trailing underscores
      .toLowerCase();

    // Handle edge case where sanitization results in empty string
    if (!sanitized || sanitized.length === 0) {
      sanitized = 'file'; // Default fallback name
    }

    // Ensure minimum length and add extension back
    if (sanitized.length < 3) {
      sanitized = 'file_' + sanitized.padEnd(3, '0');
    }

    return sanitized + extension;
  }

  /**
   * Move a file within the same bucket from one path to another.
   */
  async moveFile(sourcePath: string, destinationPath: string): Promise<void> {
    await this.bucket.file(sourcePath).move(this.bucket.file(destinationPath));
    logger.info(`File moved in GCS: ${sourcePath} -> ${destinationPath}`);
  }

  /**
   * List files in the bucket with a given prefix.
   * Returns an array of objects with name and optional contentType metadata.
   */
  async listFiles(prefix: string): Promise<Array<{ name: string; contentType?: string }>> {
    const [files] = await this.bucket.getFiles({ prefix });
    return files.map(file => ({
      name: file.name,
      contentType: (file.metadata as { contentType?: string } | undefined)?.contentType,
    }));
  }

  /**
   * Ensure bucket exists (useful for initialization)
   */
  async ensureBucketExists(): Promise<void> {
    try {
      const [exists] = await this.bucket.exists();

      if (!exists) {
        logger.info(`Creating bucket: ${this.bucketName}`);
        await this.bucket.create({
          location: 'US',
          storageClass: 'STANDARD',
        });
        logger.info(`Bucket created successfully: ${this.bucketName}`);
      } else {
        logger.info(`Bucket exists: ${this.bucketName}`);
      }
    } catch (error) {
      logger.error(`Failed to ensure bucket exists: ${this.bucketName}`, error);
      throw new Error(`Failed to ensure bucket exists: ${error}`);
    }
  }

  /**
   * Check if bucket exists
   */
  async checkBucketExists(): Promise<void> {
    try {
      const [exists] = await this.bucket.exists();

      if (!exists) {
        throw new Error(`Bucket does not exist: ${this.bucketName}`);
      }
      logger.info(`Bucket exists: ${this.bucketName}`);
    } catch (error) {
      logger.error(`Failed to check bucket: ${this.bucketName}`, error);
      if (error instanceof Error) {
        throw error;
      }
      throw new Error(`Failed to check bucket: ${error}`);
    }
  }
}

// Export singleton instance for easy importing
export const gcsService = GCSService.getInstance();
