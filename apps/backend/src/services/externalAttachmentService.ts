import { storageService, getStorageService } from './storage/index';
import { decryptStream } from '../migration/self-serve/migrationCrypto';
import { logger } from '../utils/logger';
import { ExternalSourceRepository } from '../database/repositories/externalSourceRepository';
import { decrypt } from './encryptionService';
import fetch from 'node-fetch';
import { v4 as uuidv4 } from 'uuid';
import path from 'path';
import { UploadedFileResult } from '@/services/fileUploadService';

export interface ExternalAttachment {
  fileName: string;
  /**
   * Public URL to GET. Required for URL-fetchable attachments (Slack, Zoho).
   * Optional when `buffer` is provided (Gmail / MS Graph fetch their bytes
   * via authed provider APIs that don't return raw HTTP responses).
   */
  fileUrl?: string;
  /** Pre-fetched bytes — when provided, the URL fetch is skipped. */
  buffer?: Buffer;
  /**
   * Path to bytes already in OUR storage (self-serve migration collection). Streamed straight
   * to the final location — no fetch/token, bounded memory. Takes precedence over `fileUrl`/`buffer`.
   */
  storageSourcePath?: string;
  /** True when `storageSourcePath` bytes are envelope-encrypted (migration bucket) — decrypt while streaming. */
  storageSourceEncrypted?: boolean;
  mimeType?: string;
  size?: number;
  /** MIME Content-ID (no angle brackets) for inline images referenced from the HTML body. */
  contentId?: string;
  /** Extra metadata to propagate onto the resulting MessageAttachment (e.g. provider-specific ids). */
  metadata?: Record<string, unknown>;
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

  /**
   * Override token for auth (e.g., Slack user token for DM attachments)
   * When provided, takes precedence over stored credentials
   */
  overrideToken?: string;
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

/** Split a `gs://`/`s3://` URI into bucket+key; a bare key (no scheme) returns `{ key }` (default bucket). */
function parseStorageUri(uri: string): { bucket?: string; key: string } {
  const m = /^[a-z0-9]+:\/\/([^/]+)\/(.+)$/i.exec(uri);
  return m ? { bucket: m[1], key: m[2] } : { key: uri };
}

export class ExternalAttachmentService {
  private static readonly DEFAULT_MAX_FILE_SIZE = 800 * 1024 * 1024; // 800MB
  private static readonly DEFAULT_TIMEOUT = 200000; // 200 seconds

  private static readonly authHandlers: Record<string, AuthHandler> = {
    'zoho': new ZohoAuthHandler(),
    'slack': new SlackAuthHandler(),
    'slack-desk': new SlackAuthHandler(),
    'default': new DefaultAuthHandler()
  };

  private externalSourceRepo: ExternalSourceRepository;

  constructor() {
    this.externalSourceRepo = new ExternalSourceRepository();
  }

  /**
   * Single ingest entry. Each attachment is either fetched from `fileUrl`
   * (Slack / Zoho — auth headers come from the source's credentials) or
   * processed straight from `buffer` (Gmail / Graph pre-fetched the bytes
   * via their provider API and pass them inline).
   */
  async downloadAttachmentsForSource(
    sourceName: string,
    attachments: ExternalAttachment[],
    options: DownloadAttachmentsOptions = {}
  ): Promise<DownloadedAttachment[]> {
    if (!attachments || attachments.length === 0) return [];

    // Migration attachments already live in our storage (collected earlier) — they are STREAM-COPIED bucket→bucket,
    // not re-fetched from Slack. Say so, so the ingestion logs don't look like a second collection pass.
    const fromStorageCount = attachments.filter((a) => a.storageSourcePath).length;
    logger.info(
      fromStorageCount === attachments.length
        ? `Moving ${attachments.length} attachment(s) storage→storage (already collected — not re-downloading from Slack) for source: ${sourceName}`
        : `Downloading ${attachments.length} attachments for source: ${sourceName}`,
    );

    const source = await this.externalSourceRepo.findByName(sourceName);
    if (!source) throw new Error(`External source not found: ${sourceName}`);
    if (!source.isActive) throw new Error(`External source is inactive: ${sourceName}`);

    // Auth headers are only needed when at least one attachment will be
    // URL-fetched. Skip the decrypt+handler dance if every entry already
    // carries its bytes.
    let authHeaders: Record<string, string> = {};
    if (attachments.some(a => !a.buffer && a.fileUrl)) {
      try {
        // If overrideToken is provided, use it directly (e.g., Slack user token for DMs) as user token will only have access to private dm's attachment's
        if (options.overrideToken) {
          authHeaders = this.getAuthHandler(source.sourceType).getHeaders({ botToken: options.overrideToken });
        } else {
          const credentials = JSON.parse(decrypt(source.credentials));
          authHeaders = this.getAuthHandler(source.sourceType).getHeaders(credentials);
        }
      } catch (error) {
        logger.error(`Failed to decrypt credentials for source: ${sourceName}`, error);
        throw new Error(`Invalid credentials for source: ${sourceName}`);
      }
    }

    return this.downloadAttachments(attachments, authHeaders, {
      ...options,
      scopeType: options.scopeType || 'EXTERNAL_MESSAGE',
      scopeId: options.scopeId || source.sourceType,
    });
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

    logger.info(`Successfully transferred ${successful.length}/${attachments.length} attachment(s) to storage`);
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

    // Bytes already in our storage (self-serve migration): stream straight to the final
    // location — no fetch/token, never lands whole in the pod's heap.
    if (attachment.storageSourcePath) {
      const finalMimeType = expectedMimeType || 'application/octet-stream';
      const fileExtension = path.extname(fileName) || this.getExtensionFromMimeType(finalMimeType);
      const baseName = path.basename(fileName, path.extname(fileName));
      const uniqueFileName = `${baseName}-${uuidv4().substring(0, 8)}${fileExtension}`;
      // Read from the source bucket (gs://bucket/key from the collector); write final to default bucket.
      const { bucket, key } = parseStorageUri(attachment.storageSourcePath);
      const sourceStore = bucket ? getStorageService(bucket) : storageService;
      logger.info('Moving attachment storage→storage (streamed, decrypted; no Slack fetch)', {
        from: attachment.storageSourcePath, fileName, scopeId,
      });
      const raw = await sourceStore.createReadStream(key);
      const source = attachment.storageSourceEncrypted ? decryptStream(raw) : raw;
      const gcsResult = await storageService.uploadStream(source, {
        filename: uniqueFileName,
        contentType: finalMimeType,
        metadata: {
          originalName: fileName,
          migratedFrom: attachment.storageSourcePath,
          downloadedAt: new Date().toISOString(),
        },
        scopeType,
        scopeId,
      });
      return {
        originalName: fileName,
        fileName: gcsResult.filename,
        fileSize: gcsResult.size,
        mimeType: finalMimeType,
        fileUrl: gcsResult.path,
        metadata: { gcsPath: gcsResult.path, storageSourcePath: attachment.storageSourcePath },
      };
    }

    let buffer: Buffer;
    let responseMimeType: string | undefined;

    if (attachment.buffer) {
      // Bytes already in hand (Gmail / Graph). Skip the HTTP fetch.
      buffer = attachment.buffer;
      if (buffer.length > maxFileSize) {
        throw new Error(`File too large: ${buffer.length} bytes (max: ${maxFileSize})`);
      }
    } else {
      if (!fileUrl) throw new Error(`No URL or buffer for attachment: ${fileName}`);
      logger.debug(`Downloading attachment: ${fileName} from ${fileUrl}`);

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeout);
      let response;
      try {
        response = await fetch(fileUrl, { method: 'GET', headers: authHeaders, signal: controller.signal });
      } finally {
        clearTimeout(timeoutId);
      }
      if (!response.ok) throw new Error(`HTTP ${response.status}: ${response.statusText}`);

      const contentLength = response.headers.get('content-length');
      if (contentLength && parseInt(contentLength) > maxFileSize) {
        throw new Error(`File too large: ${contentLength} bytes (max: ${maxFileSize})`);
      }
      buffer = await response.buffer();
      if (buffer.length > maxFileSize) {
        throw new Error(`File too large: ${buffer.length} bytes (max: ${maxFileSize})`);
      }
      responseMimeType = response.headers.get('content-type')?.split(';')[0] ?? undefined;
    }

    try {
      const finalMimeType = responseMimeType || expectedMimeType || 'application/octet-stream';

      // Generate unique filename to avoid conflicts
      const fileExtension = path.extname(fileName) || this.getExtensionFromMimeType(finalMimeType);
      const baseName = path.basename(fileName, path.extname(fileName));
      const uniqueFileName = `${baseName}-${uuidv4().substring(0, 8)}${fileExtension}`;

      // Upload to storage
      const gcsResult = await storageService.uploadFile(buffer, {
        filename: uniqueFileName,
        contentType: finalMimeType,
        metadata: {
          originalName: fileName,
          ...(fileUrl && { externalUrl: fileUrl }),
          downloadedAt: new Date().toISOString(),
          expectedSize: expectedSize?.toString() || 'unknown',
          expectedMimeType: expectedMimeType || 'unknown',
        },
        scopeType,
        scopeId,
      });

      return {
        originalName: fileName,
        fileName: gcsResult.filename,
        fileSize: gcsResult.size,
        mimeType: finalMimeType,
        fileUrl: gcsResult.path,
        metadata: {
          ...(fileUrl && { externalUrl: fileUrl }),
          gcsPath: gcsResult.path,
          downloadedAt: new Date().toISOString(),
          // Propagate provider-side hints (contentId for inline cid references,
          // gmailAttachmentId, etc.) so downstream code can rewrite HTML refs.
          ...(attachment.contentId && { contentId: attachment.contentId }),
          ...(attachment.metadata ?? {}),
        },
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      logger.error(`Failed to process attachment ${fileName}:`, errorMessage);
      throw new Error(`Download failed for ${fileName}: ${errorMessage}`);
    }
  }

  /**
   * Outbound: resolve staged attachment ids (GCS-uploaded MessageAttachment
   * rows) to Buffers, merge with caller-supplied inline file attachments,
   * dedupe by `name+contentType`. Used by the email reply send path.
   */
  async prepareOutboundAttachments(params: {
    attachmentIds?: string[];
    fileAttachments?: Array<{ name: string; contentType: string; content: Buffer | string }>;
  }): Promise<{
    attachments: Array<{
      name: string;
      contentType: string;
      content: Buffer | string;
      attachmentId?: string;
    }>;
    stagedRowIds: string[];
  }> {
    const ids = params.attachmentIds ?? [];
    const stagedRowIds: string[] = [];
    let stagedAttachments: Array<{
      name: string;
      contentType: string;
      content: Buffer;
      attachmentId: string;
    }> = [];

    if (ids.length > 0) {
      const { repositories } = await import('@/database/repositories');
      const results = await Promise.allSettled(
        ids.map(async id => {
          const row = await repositories.messageAttachments.findById(id);
          if (!row) return null;
          const content = await storageService.getFileBuffer(row.url);
          return {
            row,
            attachment: {
              name: row.originalFilename,
              contentType: row.mimetype,
              content,
              attachmentId: row.id,
            },
          };
        }),
      );

      stagedAttachments = results.flatMap((result, i) => {
        if (result.status === 'rejected') {
          logger.warn(
            `[ExternalAttachmentService] failed to load staged attachment id=${ids[i]}: ${result.reason instanceof Error ? result.reason.message : 'unknown'}`,
          );
          return [];
        }
        if (!result.value) {
          logger.warn(`[ExternalAttachmentService] staged attachment not found: ${ids[i]}`);
          return [];
        }
        stagedRowIds.push(result.value.row.id);
        return [result.value.attachment];
      });
    }

    const seen = new Set<string>();
    const attachments = [...(params.fileAttachments ?? []), ...stagedAttachments].filter(att => {
      const id = (att as { attachmentId?: string }).attachmentId;
      const key = id ? `id:${id}` : `nc:${att.name}|${att.contentType}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    return { attachments, stagedRowIds };
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

}
