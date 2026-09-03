import multer from 'multer';
import { PassThrough, Writable, type Readable } from 'node:stream';
import { Parse as parseZipStream, type Entry as ZipEntry } from 'unzipper';
import { logger } from '../utils/logger';
import { storageService } from '../services/storage';
import { AppError } from './errorHandler';
import { config } from '@/config/env';
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

/** Bytes read before storing: enough for every signature checked below. */
const SNIFF_BYTES = 4100;

/**
 * Executable formats, refused whatever the file is named. Kept narrow on purpose:
 * only content that is unambiguously a program. Nothing legitimate begins with a
 * PE/ELF/Mach-O header, so there is no false-positive tail — whereas matching a
 * detected type against the declared extension would reject real files, since
 * .apk/.jar/.docx/.xlsx are all Zip containers and text has no signature at all.
 * The checks mirror `file`/file-type; universal Mach-O shares its magic with Java
 * class files and is told apart by the architecture count, as `file` does.
 */
function executableKind(head: Buffer): 'exe' | 'elf' | 'macho' | null {
  if (head.length >= 2 && head[0] === 0x4d && head[1] === 0x5a) return 'exe';
  if (head.length < 4) return null;
  const magic = head.readUInt32BE(0);
  if (magic === 0x7f454c46) return 'elf';
  if (magic === 0xfeedface || magic === 0xfeedfacf || magic === 0xcefaedfe || magic === 0xcffaedfe) {
    return 'macho';
  }
  if (magic === 0xcafebabe && head.length >= 8) {
    const architectures = head.readUInt32BE(4);
    if (architectures > 0 && architectures <= 30) return 'macho';
  }
  return null;
}

/**
 * The EICAR test file — the industry-standard harmless string every scanner is
 * expected to detect. Refusing it means the screening can be exercised end to end
 * without handling real malware, which is also how an assessor will test it.
 */
const EICAR_SIGNATURE = Buffer.from(
  'X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*',
  'latin1',
);

/** Why a file's bytes were refused, or null when they were not. */
async function forbiddenContentReason(head: Buffer): Promise<string | null> {
  try {
    if (head.length === 0) return null;
    if (head.indexOf(EICAR_SIGNATURE) !== -1) return 'eicar-test-file';
    return executableKind(head);
  } catch (err) {
    // A detection error must never fail the upload; log it and continue without a
    // verdict rather than error the request.
    logger.warn('[UPLOAD] content screening skipped after error', {
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

function extensionOf(name: string): string {
  const lower = name.toLowerCase().trim();
  const dot = lower.lastIndexOf('.');
  return dot === -1 || dot === lower.length - 1 ? '' : lower.slice(dot + 1);
}

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

  const reason = await forbiddenContentReason(head);
  if (!reason) return body;

  logger.warn('[UPLOAD] Rejected executable content', {
    originalName,
    declaredMimetype: mimetype,
    detected: reason,
  });
  body.destroy();
  throw new AppError('File content is not permitted', 400);
}

/** Exposed for tests; the storage engines that call it need a live request. */
export const __screenExecutableContentForTest = screenExecutableContent;

// ── Archive inspection ────────────────────────────────────────────────────
//
// A Zip is the one allowed container whose contents the extension and content
// checks above cannot see, so its entries get the same two checks: an entry
// named like a blocked type, or whose bytes are an executable, refuses the whole
// archive. Only plain `.zip` uploads are opened. The other Zip-based formats the
// product accepts (apk, ipa, docx, …) legitimately carry native code or are
// consumed as a unit, and opening them would refuse real files.

/** A Zip inside a Zip is opened; anything deeper is refused rather than followed. */
const MAX_ARCHIVE_DEPTH = 2;
/** Bounds on how much work one upload can demand of the inspector. */
const MAX_ARCHIVE_ENTRIES = 10_000;
const MAX_ARCHIVE_INFLATED_BYTES = 4 * 1024 * 1024 * 1024;

class ArchiveViolation extends AppError {
  constructor(public readonly reason: string, public readonly entryPath: string) {
    super('Archive contains content that is not permitted', 400);
  }
}

/** Consume a stream fully, keeping only its first `byteCount` bytes. */
function captureHead(stream: Readable, byteCount: number, budget: { bytes: number }): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let kept = 0;
    const sink = new Writable({
      write(chunk: Buffer, _encoding, next) {
        budget.bytes += chunk.length;
        if (budget.bytes > MAX_ARCHIVE_INFLATED_BYTES) {
          next(new ArchiveViolation('inflates beyond the inspection limit', ''));
          return;
        }
        if (kept < byteCount) {
          chunks.push(chunk.subarray(0, byteCount - kept));
          kept += chunk.length;
        }
        next();
      },
    });
    sink.once('finish', () => resolve(Buffer.concat(chunks)));
    sink.once('error', reject);
    stream.once('error', reject);
    stream.pipe(sink);
  });
}

function inspectZipEntries(
  archive: Readable,
  depth: number,
  budget: { entries: number; bytes: number },
): Promise<void> {
  return new Promise((resolve, reject) => {
    const parser = parseZipStream();
    let chain: Promise<void> = Promise.resolve();
    let failed = false;

    const fail = (err: unknown) => {
      if (failed) return;
      failed = true;
      parser.destroy();
      reject(err);
    };

    parser.on('entry', (entry: ZipEntry) => {
      chain = chain
        .then(async () => {
          if (failed) {
            entry.autodrain();
            return;
          }
          budget.entries += 1;
          if (budget.entries > MAX_ARCHIVE_ENTRIES) {
            throw new ArchiveViolation('has more entries than can be inspected', entry.path);
          }
          if (entry.type === 'Directory') {
            await entry.autodrain().promise();
            return;
          }
          // Deny-by-default, same as a direct upload (uploadFileFilter refuses
          // anything not 'allowed'): otherwise a non-allowlisted-but-dangerous type
          // (.jar/.hta/.vbs — no executable magic bytes) would slip through inside a zip.
          if (classifyUpload(undefined, entry.path) !== 'allowed') {
            throw new ArchiveViolation('file type not allowed', entry.path);
          }
          if (extensionOf(entry.path) === 'zip') {
            if (depth >= MAX_ARCHIVE_DEPTH) {
              throw new ArchiveViolation('nested archives beyond the inspection depth', entry.path);
            }
            await inspectZipEntries(entry, depth + 1, budget);
            return;
          }
          const head = await captureHead(entry, SNIFF_BYTES, budget);
          const reason = await forbiddenContentReason(head);
          if (reason) throw new ArchiveViolation(reason, entry.path);
        })
        .catch((err) => {
          entry.autodrain();
          fail(err);
        });
    });

    // A `.zip` that cannot be parsed is not something a user can extract either;
    // refusing it costs nothing legitimate and denies a malformed header as a
    // way past the inspection.
    parser.once('error', (err: Error) =>
      fail(new ArchiveViolation(`could not be read (${err.message})`, '')),
    );
    parser.once('finish', () => {
      chain.then(() => {
        if (!failed) resolve();
      }, fail);
    });
    archive.once('error', fail);
    archive.pipe(parser);
  });
}

type ArchiveScreeningMode = 'shadow' | 'enforce';
let archiveScreeningMode: ArchiveScreeningMode = config.uploads.archiveScreening;

/** Exposed for tests. */
export function __setArchiveScreeningModeForTest(mode: ArchiveScreeningMode): void {
  archiveScreeningMode = mode;
}

/**
 * Inspect a Zip upload while it streams to storage. The returned `body` is what
 * storage receives; `verdict` settles when inspection finishes. In enforce mode a
 * violation destroys `body` so the upload stops, and rejects `verdict` so the
 * caller can remove anything already stored. In shadow mode the violation is
 * recorded without blocking, so the inspector can be validated before it enforces.
 */
function screenArchiveContent(
  stream: Readable,
  originalName: string,
): { body: Readable; verdict: Promise<void> } {
  const body = new PassThrough();
  const toInspector = new PassThrough();
  stream.once('error', (err) => {
    body.destroy(err);
    toInspector.destroy(err);
  });
  stream.pipe(body);
  stream.pipe(toInspector);

  const verdict = inspectZipEntries(toInspector, 1, { entries: 0, bytes: 0 }).catch((err) => {
    const violation = err instanceof ArchiveViolation ? err : null;
    logger.warn('[UPLOAD] Archive content violation', {
      originalName,
      mode: archiveScreeningMode,
      reason: violation?.reason ?? String(err),
      entryPath: violation?.entryPath,
    });
    toInspector.destroy();
    if (archiveScreeningMode === 'shadow') return;
    const rejection = violation ?? new AppError('Archive could not be inspected', 400);
    body.destroy(rejection);
    throw rejection;
  });

  return { body, verdict };
}

/** Exposed for tests; resolves to the full stored bytes or rejects with the verdict. */
export async function __screenArchiveContentForTest(stream: Readable, originalName: string): Promise<Buffer> {
  const { body, verdict } = screenArchiveContent(stream, originalName);
  const stored = new Promise<Buffer>((resolve, reject) => {
    const chunks: Buffer[] = [];
    body.on('data', (c: Buffer) => chunks.push(c));
    body.once('end', () => resolve(Buffer.concat(chunks)));
    body.once('error', reject);
  });
  const [storedOutcome] = await Promise.allSettled([stored, verdict]);
  await verdict;
  if (storedOutcome.status === 'rejected') throw storedOutcome.reason;
  return storedOutcome.value;
}

/**
 * Run every content check and store the file. Inspection of an archive overlaps
 * the upload, so a violation found after storage has finished is followed by
 * removal of what was stored; the caller only ever sees the rejection.
 */
async function uploadScreened<R extends { path: string }>(
  stream: Readable,
  originalName: string,
  mimetype: string | undefined,
  upload: (body: Readable) => Promise<R>,
): Promise<R> {
  const screened = await screenExecutableContent(stream, originalName, mimetype);
  if (extensionOf(originalName) !== 'zip') {
    return upload(screened);
  }

  const { body, verdict } = screenArchiveContent(screened, originalName);
  const [uploadOutcome, verdictOutcome] = await Promise.allSettled([upload(body), verdict]);
  if (verdictOutcome.status === 'rejected') {
    if (uploadOutcome.status === 'fulfilled') {
      await storageService.deleteFile(uploadOutcome.value.path).catch((err) => {
        logger.error('[UPLOAD] Failed to remove rejected archive from storage', {
          originalName,
          storagePath: uploadOutcome.value.path,
          error: err,
        });
      });
    }
    throw verdictOutcome.reason;
  }
  if (uploadOutcome.status === 'rejected') throw uploadOutcome.reason;
  return uploadOutcome.value;
}

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

      const result = await uploadScreened(file.stream, originalName, file.mimetype, (body) =>
        storageService.uploadStream(body, {
          filename: originalName,
          contentType: file.mimetype || 'application/octet-stream',
          metadata: {
            originalName,
            uploadedAt: new Date().toISOString(),
            proxied: 'true',
          },
          scopeType: 'CONVERSATION',
          scopeId: 'temp',
        }),
      );

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

      uploadScreened(file.stream, file.originalname, file.mimetype, (body) =>
        storageService.uploadStream(body, {
          filename: file.originalname || `upload-${Date.now()}`,
          contentType: file.mimetype || 'application/octet-stream',
          scopeType: 'collection',
          scopeId,
          metadata: {
            originalName: file.originalname,
            uploadedAt: new Date().toISOString(),
          },
        }),
      ).then((result) => {
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
