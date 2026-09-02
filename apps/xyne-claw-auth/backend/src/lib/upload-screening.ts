import { createLogger } from "../logger.js";

const log = createLogger("upload-screening");

/**
 * Server-side screening for uploaded chat attachments (PY-JP-011).
 *
 * Attachments are stored and later handed to other people, so an executable
 * uploaded here becomes a malware-distribution vector. The upload path had no
 * content check at all. This rejects native executables and the EICAR test file
 * by their magic bytes — regardless of filename or the client-declared MIME —
 * plus an executable extension / declared-MIME block-list. Content-based
 * anti-virus (ClamAV) is a planned follow-up; this closes the "any content
 * accepted" gap in the meantime.
 *
 * Detection ERRORS fail open (log + allow) so a screening bug cannot take the
 * whole upload path down; a positive detection always rejects.
 */

// The EICAR anti-virus test string (first bytes are enough to identify it).
const EICAR_PREFIX = "X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*";

// Client-declared content types that describe executable/installer content.
const FORBIDDEN_MIME_TYPES = new Set<string>([
  "application/x-msdownload",
  "application/x-msdos-program",
  "application/x-dosexec",
  "application/x-executable",
  "application/x-elf",
  "application/x-mach-binary",
  "application/vnd.microsoft.portable-executable",
  "application/x-sharedlib",
  "application/x-msi",
  "application/vnd.android.package-archive",
]);

// Obvious executable / installer extensions, matched case-insensitively.
const FORBIDDEN_EXTENSIONS = new Set<string>([
  ".exe", ".dll", ".msi", ".scr", ".com", ".bat", ".cmd", ".ps1",
  ".so", ".dylib", ".msix", ".cpl",
]);

/** Identify a native executable by its leading magic bytes, or null. */
function executableKind(buf: Buffer): string | null {
  if (buf.length >= 2 && buf[0] === 0x4d && buf[1] === 0x5a) return "PE/DOS (MZ)"; // .exe/.dll
  if (buf.length >= 4 && buf[0] === 0x7f && buf[1] === 0x45 && buf[2] === 0x4c && buf[3] === 0x46) return "ELF";
  if (buf.length >= 4) {
    const m = buf.readUInt32BE(0);
    // Mach-O (32/64, both endiannesses) and the universal "fat" binary header.
    if (m === 0xfeedface || m === 0xfeedfacf || m === 0xcefaedfe || m === 0xcffaedfe || m === 0xcafebabe) {
      return "Mach-O";
    }
  }
  return null;
}

function extensionOf(filename: string): string {
  const dot = filename.lastIndexOf(".");
  return dot >= 0 ? filename.slice(dot).toLowerCase() : "";
}

/** Reason an upload is refused, or null if it passes screening. */
export function forbiddenContentReason(
  buffer: Buffer,
  filename: string,
  declaredMime: string | undefined,
): string | null {
  try {
    const kind = executableKind(buffer);
    if (kind) return `executable content (${kind})`;
    if (buffer.length >= EICAR_PREFIX.length &&
        buffer.subarray(0, EICAR_PREFIX.length).toString("latin1") === EICAR_PREFIX) {
      return "EICAR anti-virus test file";
    }
    const ext = extensionOf(filename);
    if (ext && FORBIDDEN_EXTENSIONS.has(ext)) return `blocked file extension (${ext})`;
    const mime = (declaredMime ?? "").trim().toLowerCase();
    if (mime && FORBIDDEN_MIME_TYPES.has(mime)) return `blocked content type (${mime})`;
    return null;
  } catch (err) {
    // Fail open on a detection error — never block all uploads on a screening bug.
    log.warn("[upload-screening] content screening skipped after error", {
      filename,
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

export interface ScreenableFile {
  originalname?: string;
  mimetype?: string;
  buffer: Buffer;
}

/** Screen a batch of in-memory upload files. Returns the first rejection, or null. */
export function screenUploadFiles(
  files: ScreenableFile[],
): { filename: string; reason: string } | null {
  for (const f of files) {
    const filename = f.originalname || "upload";
    const reason = forbiddenContentReason(f.buffer, filename, f.mimetype);
    if (reason) {
      log.warn("[upload-screening] rejected upload", { filename, reason });
      return { filename, reason };
    }
  }
  return null;
}
