import multer from 'multer';
import { PassThrough, type Readable } from 'node:stream';
import { fileTypeFromBuffer } from 'file-type';
import { logger } from '../utils/logger';
import { storageService } from '../services/storage';
import { AppError } from './errorHandler';

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
 * Extensions accepted by default; anything else is refused. Derived from the
 * production upload distribution, so it includes types that look unusual but are
 * established workflows here and would break if dropped: .apk/.ipa (builds shared
 * in channels), .html (automated reports), .svg (custom emoji are SVGs),
 * .sh/.bash, .crt/.pem. Compared lower-cased, without the dot.
 */
const ALLOWED_UPLOAD_EXTENSIONS = new Set([
  // images
  'png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'heic', 'heif', 'bmp', 'tiff', 'tif', 'ico', 'jfif', 'avif',
  // video / audio
  'mp4', 'mov', 'webm', 'm4v', 'avi', 'mkv', 'mp3', 'm4a', 'wav', 'ogg', 'opus', 'aac', 'amr',
  // documents
  'pdf', 'doc', 'docx', 'xls', 'xlsx', 'xlsm', 'xlsb', 'ppt', 'pptx', 'odt', 'ods', 'odp',
  'rtf', 'pages', 'numbers', 'key', 'eml', 'msg', 'ics', 'vcf',
  // text / data
  'txt', 'md', 'csv', 'tsv', 'log', 'json', 'jsonl', 'xml', 'yaml', 'yml', 'toml',
  'ini', 'conf', 'env', 'sql', 'har', 'html', 'htm', 'xhtml',
  // archives
  'zip', 'tar', 'gz', 'tgz', 'bz2', '7z', 'rar', 'xz',
  // mobile build artifacts
  'apk', 'ipa', 'aab', 'aar',
  // source / dev
  'py', 'js', 'mjs', 'cjs', 'ts', 'tsx', 'jsx', 'sh', 'bash', 'java', 'go', 'rs', 'rb',
  'c', 'h', 'cpp', 'hpp', 'patch', 'diff', 'ipynb', 'drawio', 'gradle',
  // keys / certificates
  'pem', 'crt', 'cer', 'csr', 'pub', 'asc', 'gpg', 'pgp',
  // other formats with real traffic
  'bin', 'dat', 'stl', 'kml', 'ditamap', 'xsd', 'ttf', 'otf', 'plist',
  // Outlook uses .com content-id filenames for inline images; inbound email runs
  // through this filter. Downloads as an opaque octet-stream regardless.
  'com',
]);

/** `report.log.1` from log rotation — a numeric suffix is not a file format. */
const NUMERIC_SUFFIX = /^\d{1,3}$/;

export type UploadVerdict = 'allowed' | 'blocked' | 'not-allowlisted';

/**
 * Extension-based verdict. Files with no extension are allowed here — the
 * filename cannot classify them, and content screening in the storage engine
 * covers them instead.
 */
export function classifyUpload(mimetype?: string, originalName?: string): UploadVerdict {
  if (isBlockedUpload(mimetype, originalName)) return 'blocked';

  const name = (originalName ?? '').toLowerCase().trim();
  const dot = name.lastIndexOf('.');
  if (dot === -1 || dot === name.length - 1) return 'allowed';

  const ext = name.slice(dot + 1);
  if (NUMERIC_SUFFIX.test(ext)) return 'allowed';

  return ALLOWED_UPLOAD_EXTENSIONS.has(ext) ? 'allowed' : 'not-allowlisted';
}

/** file-type's recommended read length; covers signatures not at offset zero. */
const SNIFF_BYTES = 4100;

/**
 * Executable formats, refused whatever the file is named. Kept narrow on purpose:
 * only content that is unambiguously a program. Nothing legitimate begins with a
 * PE/ELF/Mach-O header, so there is no false-positive tail — whereas matching the
 * detected type against the declared extension would reject real files, since
 * .apk/.jar/.docx/.xlsx are all Zip containers and text has no signature at all.
 */
const EXECUTABLE_CONTENT = new Set(['exe', 'elf', 'macho']);

/**
 * Read the first bytes of a stream and return a stream that still yields the whole
 * file — the head, then the remainder. Rebuilds the stream rather than using
 * `readable.unshift`, which is a no-op once a stream has ended: a file shorter than
 * the sniff length is fully consumed by the read, and most attachments are small.
 */
async function readHeadAndRewind(
  stream: Readable,
  byteCount: number,
): Promise<{ head: Buffer; body: Readable }> {
  const chunks: Buffer[] = [];
  let total = 0;

  // A stream error (a client disconnecting mid-upload is the common one) must
  // reject rather than leave this pending: 'readable'/'end' never fire after an
  // error. Listeners are removed on the first of the three to settle so a large
  // file does not accumulate one per chunk read.
  if (!stream.readableEnded) {
    await new Promise<void>((resolve, reject) => {
      const cleanup = () => {
        stream.off('readable', onReadable);
        stream.off('end', onDone);
        stream.off('error', onError);
      };
      const onReadable = () => {
        let chunk: Buffer | null;
        while (total < byteCount && (chunk = stream.read() as Buffer | null) !== null) {
          chunks.push(chunk);
          total += chunk.length;
        }
        if (total >= byteCount) {
          cleanup();
          resolve();
        }
      };
      const onDone = () => {
        cleanup();
        resolve();
      };
      const onError = (err: Error) => {
        cleanup();
        reject(err);
      };
      stream.on('readable', onReadable);
      stream.once('end', onDone);
      stream.once('error', onError);
      onReadable();
    });
  }

  const head = Buffer.concat(chunks);

  const body = new PassThrough();
  stream.once('error', (err) => body.destroy(err));
  if (head.length > 0) body.write(head);
  if (stream.readableEnded) {
    body.end();
  } else {
    stream.pipe(body);
  }

  return { head, body };
}

/**
 * Refuse a file whose contents are an executable, whatever its name says. Runs in
 * the storage engine, not fileFilter, which only sees the filename — and this is
 * what covers extensionless uploads the allow-list cannot classify. Fails the
 * request rather than silently dropping the file, unlike a filtered extension.
 */
async function screenExecutableContent(
  stream: Readable,
  originalName: string,
  mimetype: string | undefined,
): Promise<Readable> {
  const { head, body } = await readHeadAndRewind(stream, SNIFF_BYTES);
  if (head.length === 0) return body;

  const detected = await fileTypeFromBuffer(head);
  if (!detected || !EXECUTABLE_CONTENT.has(detected.ext)) return body;

  logger.warn('[UPLOAD] Rejected executable content', {
    originalName,
    declaredMimetype: mimetype,
    detectedExt: detected.ext,
    detectedMime: detected.mime,
  });
  body.destroy();
  throw new AppError('File content is not permitted', 400);
}

/** Exposed for tests; the storage engines that call it need a live request. */
export const __screenExecutableContentForTest = screenExecutableContent;

/**
 * Skips a refused file rather than failing the request: returning an error to multer
 * discards every file in the same multipart upload, which on the inbound-email path would
 * drop the message entirely. Callers see the file missing from req.files.
 */
const uploadFileFilter: multer.Options['fileFilter'] = (_req, file, cb) => {
  const verdict = classifyUpload(file.mimetype, file.originalname);
  if (verdict !== 'allowed') {
    logger.warn('[UPLOAD] Rejected file type', {
      reason: verdict,
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

      const screened = await screenExecutableContent(file.stream, originalName, file.mimetype);

      const result = await storageService.uploadStream(screened, {
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

      screenExecutableContent(file.stream, file.originalname, file.mimetype)
        .then((screened) => storageService.uploadStream(screened, {
        filename: file.originalname || `upload-${Date.now()}`,
        contentType: file.mimetype || 'application/octet-stream',
        scopeType: 'collection',
        scopeId,
        metadata: {
          originalName: file.originalname,
          uploadedAt: new Date().toISOString(),
        },
      })).then((result) => {
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
