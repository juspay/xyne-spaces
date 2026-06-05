import multer from 'multer';
import { logger } from '../utils/logger';
import { storageService } from '../services/storage';
import { AppError } from './errorHandler';

const MAX_FILE_SIZE_BYTES = 1024 * 1024 * 1024; // 1GB max file size
const MAX_FILE_FIELDS = 20; // Supports files + thumbnails in one multipart request

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
          error: error instanceof Error ? error.message : String(error),
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
  limits: {
    fileSize: MAX_FILE_SIZE_BYTES,
    files: 10 // Max 10 files per request
  },
  // fileFilter: (_req, file, cb) => {
  //   // Allowed file types
  //   const allowedMimeTypes = [
  //     // Images
  //     'image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp', 'image/svg+xml',
  //     // Videos
  //     'video/mp4', 'video/avi', 'video/mov', 'video/wmv', 'video/webm',
  //     // Documents
  //     'application/pdf', 'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  //     'application/vnd.ms-excel', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  //     'application/vnd.ms-powerpoint', 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  //     'text/plain', 'text/csv',
  //     // Archives
  //     'application/zip', 'application/x-rar-compressed', 'application/x-7z-compressed'
  //   ];

  //   if (allowedMimeTypes.includes(file.mimetype)) {
  //     cb(null, true);
  //   } else {
  //     cb(new Error(`File type ${file.mimetype} is not allowed`));
  //   }
  // }
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
  limits: { fileSize: 100 * 1024 * 1024, files: 50 },
});

export const versionUpload = multer({
  storage: makeCollectionStreamingStorage('itemId'),
  limits: { fileSize: 100 * 1024 * 1024 },
});

const createUploadStreamConfig = (fileSizeBytes: number, maxFiles: number) =>
  multer({
    storage: streamingStorage,
    limits: {
      fileSize: fileSizeBytes,
      files: maxFiles,
    },
  });

const uploadStreamConfig = createUploadStreamConfig(MAX_FILE_SIZE_BYTES, MAX_FILE_FIELDS);

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
