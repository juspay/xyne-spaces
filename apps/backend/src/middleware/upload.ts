import multer from 'multer';
import { logger } from '../utils/logger';
import { storageService } from '../services/storage';
import { AppError } from './errorHandler';
import { db } from '../database/client';
import { AttachmentUploadStatus } from '@xyne/shared';

const MAX_FILE_SIZE_BYTES = 1024 * 1024 * 1024; // 1GB max file size
const MAX_FILE_FIELDS = 20; // Supports files + thumbnails in one multipart request

/**
 * File types refused at upload: Windows executables and server-side scripts, which are
 * delivered to other people in a channel rather than rendered by the app. Documents and
 * markup are deliberately allowed — every serving path types them as an opaque download
 * (see setSafeDownloadHeaders), and images render under a script-blocking policy (see
 * setSafeInlineImageHeaders).
 *
 * Mobile build artifacts (.apk, .ipa) and shell scripts (.sh, .bash) are NOT listed:
 * sharing builds and ops scripts in a channel is an established workflow here, and
 * refusing them would break it. `.com` is likewise absent — it matches the content-id
 * filenames Outlook gives inline images far more often than any real executable.
 *
 * Keyed on extension: file.mimetype is supplied by the client, and a large share of real
 * uploads arrive as application/octet-stream because the client could not determine a type.
 * The MIME set below is a second pass for the cases where a type is declared.
 */
const BLOCKED_UPLOAD_EXTENSIONS = new Set([
  '.exe', '.dll', '.msi', '.scr', '.bat', '.cmd', '.ps1',
  '.php', '.phtml',
]);

const BLOCKED_UPLOAD_MIME_TYPES = new Set([
  'application/x-msdownload',
  'application/x-msdos-program',
  'application/x-httpd-php',
]);

export function isBlockedUpload(mimetype?: string, originalName?: string): boolean {
  const mime = (mimetype ?? '').split(';')[0].trim().toLowerCase();
  if (BLOCKED_UPLOAD_MIME_TYPES.has(mime)) return true;

  const name = (originalName ?? '').toLowerCase();
  const dot = name.lastIndexOf('.');
  if (dot === -1) return false;
  return BLOCKED_UPLOAD_EXTENSIONS.has(name.slice(dot));
}

/**
 * Skips a refused file rather than failing the request: returning an error to multer
 * discards every file in the same multipart upload, which on the inbound-email path would
 * drop the message entirely. Callers see the file missing from req.files.
 */
const uploadFileFilter: multer.Options['fileFilter'] = (_req, file, cb) => {
  if (isBlockedUpload(file.mimetype, file.originalname)) {
    logger.warn('[UPLOAD] Rejected file type', {
      mimetype: file.mimetype,
      originalname: file.originalname,
    });
    cb(null, false);
    return;
  }
  cb(null, true);
};

/**
 * office-conversion is single-purpose (shell the upload out to LibreOffice's
 * `soffice --convert-to pdf`), so unlike the generic uploadFileFilter above —
 * a denylist covering every other upload path in the app — this one is an
 * allowlist: only the office document types the FileViewer actually sends
 * (apps/dashboard/src/components/FileViewer/utils.ts) are accepted, not
 * "anything not explicitly blocked".
 */
const OFFICE_CONVERSION_EXTENSIONS = new Set([
  '.pptx', '.ppt', '.docx', '.doc', '.xlsx', '.xls',
]);

const OFFICE_CONVERSION_MIME_TYPES = new Set([
  'application/vnd.openxmlformats-officedocument.presentationml.presentation', // .pptx
  'application/vnd.ms-powerpoint', // .ppt
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document', // .docx
  'application/msword', // .doc
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', // .xlsx
  'application/vnd.ms-excel', // .xls
]);

const officeConversionFileFilter: multer.Options['fileFilter'] = (_req, file, cb) => {
  // Extension-primary, same as isBlockedUpload above: file.mimetype is
  // client-supplied and often generic (application/octet-stream) even for a
  // real office document.
  const name = (file.originalname ?? '').toLowerCase();
  const dot = name.lastIndexOf('.');
  const ext = dot === -1 ? '' : name.slice(dot);
  const mime = (file.mimetype ?? '').split(';')[0].trim().toLowerCase();

  if (!OFFICE_CONVERSION_EXTENSIONS.has(ext) && !OFFICE_CONVERSION_MIME_TYPES.has(mime)) {
    logger.warn('[UPLOAD] Rejected non-office file for conversion', {
      mimetype: file.mimetype,
      originalname: file.originalname,
    });
    cb(null, false);
    return;
  }
  cb(null, true);
};

// Generic streaming storage engine for message attachments.
// Streams directly to object storage without buffering in memory.
const streamingStorage: multer.StorageEngine = {
  _handleFile(req, file, cb) {
    (async () => {
      const requestIdHeader = req.headers['x-request-id'];
      const requestId = Array.isArray(requestIdHeader)
        ? requestIdHeader[0]
        : requestIdHeader || 'no-request-id';
      const startedAt = Date.now();
      const traceLabel = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

      const originalName =
        file.originalname && file.originalname.trim().length > 0
          ? file.originalname
          : `upload-${Date.now()}`;

      logger.info(`[UPLOAD-STREAM] Inbound stream received`, {
        traceLabel,
        requestId,
        fieldName: file.fieldname,
        originalName,
        mimeType: file.mimetype || 'application/octet-stream',
      });

      file.stream.once('end', () => {
        logger.info(`[UPLOAD-STREAM] Inbound stream fully consumed`, {
          traceLabel,
          requestId,
          fieldName: file.fieldname,
          originalName,
        });
      });

      file.stream.once('error', (error) => {
        logger.error(`[UPLOAD-STREAM] Inbound stream error before propagation completed`, {
          traceLabel,
          requestId,
          fieldName: file.fieldname,
          originalName,
          error: error,
        });
      });

      const result = await storageService.uploadStream(file.stream, {
        filename: originalName,
        contentType: file.mimetype || 'application/octet-stream',
        metadata: {
          originalName,
          uploadedAt: new Date().toISOString(),
          proxied: 'true',
        },
        scopeType: 'CONVERSATION',
        scopeId: 'temp',
      });

      logger.info(`[UPLOAD-STREAM] Stream propagated to object storage`, {
        traceLabel,
        requestId,
        fieldName: file.fieldname,
        originalName,
        storagePath: result.path,
        storedBytes: result.size,
        durationMs: Date.now() - startedAt,
      });

      cb(null, {
        path: result.path,
        filename: result.filename,
        size: result.size,
      });
    })().catch((error) => cb(error as Error));
  },

  _removeFile(_req, file, cb) {
    const storagePath = file.path;
    if (!storagePath) {
      cb(null);
      return;
    }
    storageService
      .deleteFile(storagePath)
      .then(() => cb(null))
      .catch((error) => cb(error as Error));
  },
};

// Common multer configuration for file uploads
export const uploadConfig = multer({
  storage: multer.memoryStorage(),
  fileFilter: uploadFileFilter,
  limits: {
    fileSize: MAX_FILE_SIZE_BYTES,
    files: 10 // Max 10 files per request
  },
});

// Factory: creates a streaming Multer storage engine that pipes files directly to GCS.
// scopeIdParam — the req.params key to use as the GCS scopeId (e.g. 'collectionId', 'itemId').
function makeCollectionStreamingStorage(scopeIdParam: string): multer.StorageEngine {
  return {
    _handleFile(req, file, cb) {
      const scopeId = req.params?.[scopeIdParam];
      if (!scopeId) {
        file.stream.resume();
        cb(new Error(`${scopeIdParam} is required`));
        return;
      }

      storageService.uploadStream(file.stream, {
        filename: file.originalname || `upload-${Date.now()}`,
        contentType: file.mimetype || 'application/octet-stream',
        scopeType: 'collection',
        scopeId,
        metadata: {
          originalName: file.originalname,
          uploadedAt: new Date().toISOString(),
        },
      }).then((result) => {
        logger.info(`[COLLECTION-UPLOAD] Streamed to GCS: ${file.originalname} -> ${result.path} (${result.size} bytes)`);
        cb(null, { path: result.path, filename: result.filename, size: result.size });
      }).catch((error) => {
        logger.error(`[COLLECTION-UPLOAD] Stream failed for ${file.originalname}:`, error);
        cb(error instanceof Error ? error : new Error(String(error)));
      });
    },

    _removeFile(_req, file, cb) {
      if (!file.path) { cb(null); return; }
      storageService.deleteFile(file.path)
        .then(() => cb(null))
        .catch((err) => cb(err instanceof Error ? err : new Error(String(err))));
    },
  };
}

export const collectionUpload = multer({
  storage: makeCollectionStreamingStorage('collectionId'),
  fileFilter: uploadFileFilter,
  limits: { fileSize: 100 * 1024 * 1024, files: 50 },
});

export const versionUpload = multer({
  storage: makeCollectionStreamingStorage('itemId'),
  fileFilter: uploadFileFilter,
  limits: { fileSize: 100 * 1024 * 1024 },
});

// In-memory (not GCS-streamed): the file is transient input to a conversion,
// never stored.
export const officeConversionUpload = multer({
  storage: multer.memoryStorage(),
  fileFilter: officeConversionFileFilter,
  limits: { fileSize: 100 * 1024 * 1024, files: 1 },
});

const createUploadStreamConfig = (fileSizeBytes: number, maxFiles: number) =>
  multer({
    storage: streamingStorage,
    fileFilter: uploadFileFilter,
    limits: {
      fileSize: fileSizeBytes,
      files: maxFiles,
    },
  });

const uploadStreamConfig = createUploadStreamConfig(MAX_FILE_SIZE_BYTES, MAX_FILE_FIELDS);

const AUTOMATION_TEMPLATE_MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024;
const automationTemplateUploadConfig = createUploadStreamConfig(
  AUTOMATION_TEMPLATE_MAX_FILE_SIZE_BYTES,
  10,
);

/** Stream up to ten automation text templates directly to object storage. */
export const uploadAutomationTemplates = (req: any, res: any, next: any) => {
  const multerMiddleware = automationTemplateUploadConfig.array('files', 10);
  multerMiddleware(req, res, (err: any) => {
    if (err) {
      const normalized = normalizeMulterError(
        err,
        AUTOMATION_TEMPLATE_MAX_FILE_SIZE_BYTES,
      );
      if (normalized instanceof AppError) return next(normalized);
      logger.error('[AUTOMATION-TEMPLATE-UPLOAD] Storage upload failed', normalized);
      return next(new AppError('Failed to upload template attachment', 500));
    }
    next();
  });
};

const formatFileSize = (bytes: number): string => {
  if (bytes >= 1024 * 1024 && bytes % (1024 * 1024) === 0) {
    return `${bytes / (1024 * 1024)}MB`;
  }

  if (bytes >= 1024 && bytes % 1024 === 0) {
    return `${bytes / 1024}KB`;
  }

  return `${bytes}B`;
};

const normalizeMulterError = (err: any, maxFileSizeBytes: number): Error => {
  if (err instanceof multer.MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') {
      return new AppError(`File too large (max ${formatFileSize(maxFileSizeBytes)})`, 413);
    }

    if (err.code === 'LIMIT_FILE_COUNT' || err.code === 'LIMIT_UNEXPECTED_FILE') {
      return new AppError(err.message, 400);
    }
  }

  return err instanceof Error ? err : new Error(String(err));
};

interface UploadSingleOptions {
  fieldName?: string;
  maxBytes?: number;
}

export const uploadSingle = (options: UploadSingleOptions = {}) => {
  const fieldName = options.fieldName || 'file';
  const requestedMaxBytes =
    typeof options.maxBytes === 'number' && options.maxBytes > 0
      ? options.maxBytes
      : MAX_FILE_SIZE_BYTES;
  const effectiveMaxFileSizeBytes = Math.min(requestedMaxBytes, MAX_FILE_SIZE_BYTES);
  const singleUploadConfig = createUploadStreamConfig(effectiveMaxFileSizeBytes, 1);

  return (req: any, res: any, next: any) => {
    const multerMiddleware = singleUploadConfig.single(fieldName);
    multerMiddleware(req, res, (err: any) => {
      if (err) {
        logger.error('[MULTER] Single upload middleware error:', err.message);
        return next(normalizeMulterError(err, effectiveMaxFileSizeBytes));
      }

      const file = req.file as Express.Multer.File | undefined;
      if (file) {
        logger.info(`[MULTER] Single file proxied to storage: ${file.originalname} -> ${file.path}`);
      }

      next();
    });
  };
};

/**
 * A disconnect mid-upload leaves the client-created attachment rows PENDING with no
 * object behind them. The ids arrive as text fields ahead of the file bodies, so they
 * are already parsed here and the rows can be parked in FAILED. Best-effort.
 */
const markUploadedAttachmentsFailed = async (req: any): Promise<void> => {
  const raw = req.body?.attachmentIds;
  if (!raw) return;
  try {
    const ids: string[] = typeof raw === 'string' ? JSON.parse(raw) : raw;
    if (!Array.isArray(ids) || ids.length === 0) return;
    await db.messageAttachment.updateMany({
      where: { id: { in: ids }, url: '' },
      data: { uploadStatus: AttachmentUploadStatus.FAILED },
    });
  } catch (error) {
    logger.error('[MULTER] Failed to mark interrupted attachments as failed:', error);
  }
};

// Custom uploadMultiple that proxies multipart file streams directly to object storage
export const uploadMultiple = (req: any, res: any, next: any) => {
  logger.info('fixingAttachment 🗂️ [MULTER] Starting multipart stream proxy...');

  const multerMiddleware = uploadStreamConfig.fields([
    { name: 'files', maxCount: 10 },
    { name: 'thumbnails', maxCount: 10 }
  ]);

  multerMiddleware(req, res, (err: any) => {
    if (err) {
      logger.error('fixingAttachment ❌ [MULTER] Upload middleware error:', err.message);
      void markUploadedAttachmentsFailed(req);
      return next(normalizeMulterError(err, MAX_FILE_SIZE_BYTES));
    }

    const reqFiles = req.files as { [fieldname: string]: Express.Multer.File[] } || {};
    const files = reqFiles['files'] || [];
    const thumbnails = reqFiles['thumbnails'] || [];

    logger.info(`fixingAttachment 💾 [MULTER] Files proxied to storage: ${files.length} files, ${thumbnails.length} thumbnails`);

    files.forEach((file: Express.Multer.File, index: number) => {
      logger.info(`fixingAttachment 📁 [MULTER] File ${index + 1} proxied: ${file.originalname} -> ${file.path}`);
    });

    thumbnails.forEach((thumbnail: Express.Multer.File, index: number) => {
      logger.info(`fixingAttachment 🖼️ [MULTER] Thumbnail ${index + 1} proxied: ${thumbnail.originalname} -> ${thumbnail.path}`);
    });

    logger.info('fixingAttachment ✅ [MULTER] All files successfully proxied to storage');

    next();
  });
};
