/**
 * Inbound ZIP archive ingest.
 *
 * Unzips the archive entry-by-entry, dispatches each entry through the
 * same per-type pipeline used at the top level (text/json/csv/yaml/xml/log,
 * pdf, xlsx, docx, pptx, html), and emits a list of derived context files
 * the caller writes under `.context/<zipName>/<entry-path>`.
 *
 * Hard safety caps to prevent zip-bombs / runaway parsing:
 *   - MAX_ENTRIES         200          stop after this many files
 *   - MAX_PER_ENTRY_BYTES  50 MB        skip oversized entries
 *   - MAX_TOTAL_BYTES     200 MB        stop reading after the running total
 *   - NO recursion        nested .zip entries are skipped (logged in manifest)
 *
 * Unsupported entry types (binary blobs we can't ingest, images, audio,
 * exe, etc.) are listed in the manifest but their contents are not
 * extracted. A summary manifest is always emitted as the first file so the
 * agent knows what was inside without having to enumerate the dir.
 *
 * Returns derived files relative to the archive root — the caller
 * namespaces them under the archive's own filename via `<zipName>/<path>`.
 */
import JSZip from "jszip";
import { matchesAttachmentType, ZIP_ATTACHMENT, TEXT_LIKE_ATTACHMENT } from "xyne-claw-shared";
import { isPdfAttachment, pdfBufferToMarkdown } from "./pdf-attachment.js";
import { isXlsxAttachment, xlsxBufferToMarkdown } from "./xlsx-attachment.js";
import { isDocxAttachment, docxBufferToMarkdown } from "./docx-attachment.js";
import { isPptxAttachment, pptxBufferToMarkdown } from "./pptx-attachment.js";
import { isHtmlAttachment, htmlBufferToMarkdown } from "./html-attachment.js";

export const ZIP_EXTENSIONS = ZIP_ATTACHMENT.extensions;

export function isZipAttachment(fileName: string, mimeType?: string | null): boolean {
  return matchesAttachmentType(fileName, mimeType, ZIP_ATTACHMENT.mimeTypes, ZIP_ATTACHMENT.extensions);
}

const MAX_ENTRIES = 200;
const MAX_PER_ENTRY_BYTES = 50 * 1024 * 1024;
const MAX_TOTAL_BYTES = 200 * 1024 * 1024;

const TEXT_LIKE_EXTENSIONS = TEXT_LIKE_ATTACHMENT.extensions;

function isTextLikeByName(name: string): boolean {
  const dot = name.lastIndexOf(".");
  if (dot < 0) return false;
  return TEXT_LIKE_EXTENSIONS.has(name.slice(dot).toLowerCase());
}

/** Safe-ish path: drop absolute roots, parent traversal, leading dots. */
function sanitizeEntryPath(p: string): string | null {
  const parts = p.split(/[/\\]+/).filter(Boolean);
  const cleaned: string[] = [];
  for (const part of parts) {
    if (part === "." || part === "..") return null;
    if (/^[a-zA-Z]:$/.test(part)) return null; // Windows drive
    cleaned.push(part);
  }
  if (cleaned.length === 0) return null;
  return cleaned.join("/");
}

export interface DerivedZipFile {
  /** Relative path under the archive root — caller prefixes with archive name. */
  path: string;
  content: string;
}

export interface ZipManifestEntry {
  path: string;
  bytes: number;
  status: "extracted" | "skipped-binary" | "skipped-nested-zip" | "skipped-oversize" | "skipped-error";
  outputPath?: string;
  reason?: string;
}

/**
 * Unzip and convert every supported entry. Returns:
 *   - files:    list of `{path, content}` (the manifest is index 0)
 *   - manifest: rich per-entry record (for logging upstream)
 *
 * Never throws — archive-level failures produce a single error stub manifest.
 */
export async function zipBufferToContextFiles(
  buf: Buffer,
  archiveFileName: string,
): Promise<{ files: DerivedZipFile[]; manifest: ZipManifestEntry[] }> {
  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(buf);
  } catch (err) {
    const stub: DerivedZipFile = {
      path: `_MANIFEST.md`,
      content: `# Archive: ${archiveFileName}\n\nFailed to open: ${err instanceof Error ? err.message : String(err)}\n`,
    };
    return { files: [stub], manifest: [] };
  }

  const manifest: ZipManifestEntry[] = [];
  const files: DerivedZipFile[] = [];
  let totalBytes = 0;
  let entriesProcessed = 0;

  // Stable iteration order — sort entries by path.
  const allEntries: { path: string; entry: JSZip.JSZipObject }[] = [];
  zip.forEach((p, e) => { if (!e.dir) allEntries.push({ path: p, entry: e }); });
  allEntries.sort((a, b) => a.path.localeCompare(b.path));

  for (const { path: rawPath, entry } of allEntries) {
    if (entriesProcessed >= MAX_ENTRIES) {
      manifest.push({ path: rawPath, bytes: 0, status: "skipped-oversize", reason: `entry cap (${MAX_ENTRIES}) reached` });
      continue;
    }
    const safe = sanitizeEntryPath(rawPath);
    if (!safe) {
      manifest.push({ path: rawPath, bytes: 0, status: "skipped-error", reason: "unsafe path (absolute or traversal)" });
      continue;
    }

    // Detect type by name first — saves a buffer read for unsupported files.
    const lowerName = safe.toLowerCase();
    if (lowerName.endsWith(".zip")) {
      manifest.push({ path: safe, bytes: 0, status: "skipped-nested-zip", reason: "nested archives are not expanded" });
      continue;
    }
    const isText = isTextLikeByName(safe);
    const isPdf = isPdfAttachment(safe, "");
    const isXlsx = isXlsxAttachment(safe, "");
    const isDocx = isDocxAttachment(safe, "");
    const isPptx = isPptxAttachment(safe, "");
    const isHtml = isHtmlAttachment(safe, "");
    const supported = isText || isPdf || isXlsx || isDocx || isPptx || isHtml;

    if (!supported) {
      manifest.push({ path: safe, bytes: 0, status: "skipped-binary", reason: "unsupported type" });
      continue;
    }

    let entryBuf: Buffer;
    try {
      const u8 = await entry.async("uint8array");
      if (u8.byteLength > MAX_PER_ENTRY_BYTES) {
        manifest.push({ path: safe, bytes: u8.byteLength, status: "skipped-oversize", reason: `> ${MAX_PER_ENTRY_BYTES.toLocaleString()} bytes per-entry cap` });
        continue;
      }
      if (totalBytes + u8.byteLength > MAX_TOTAL_BYTES) {
        manifest.push({ path: safe, bytes: u8.byteLength, status: "skipped-oversize", reason: `total cap (${MAX_TOTAL_BYTES.toLocaleString()} bytes) would be exceeded` });
        continue;
      }
      entryBuf = Buffer.from(u8);
      totalBytes += u8.byteLength;
    } catch (err) {
      manifest.push({ path: safe, bytes: 0, status: "skipped-error", reason: err instanceof Error ? err.message : String(err) });
      continue;
    }

    try {
      let outPath: string;
      let content: string;
      if (isText) {
        // Text-like → keep extension, raw content.
        outPath = safe;
        content = entryBuf.toString("utf8");
        if (content.charCodeAt(0) === 0xFEFF) content = content.slice(1);
      } else if (isPdf) {
        outPath = `${safe}.md`;
        content = await pdfBufferToMarkdown(entryBuf, safe);
      } else if (isXlsx) {
        outPath = `${safe}.md`;
        content = await xlsxBufferToMarkdown(entryBuf, safe);
      } else if (isDocx) {
        outPath = `${safe}.md`;
        content = await docxBufferToMarkdown(entryBuf, safe);
      } else if (isPptx) {
        outPath = `${safe}.md`;
        content = await pptxBufferToMarkdown(entryBuf, safe);
      } else if (isHtml) {
        outPath = safe;
        content = await htmlBufferToMarkdown(entryBuf, safe);
      } else {
        // Defensive: the supported-flag block above is exhaustive, so this
        // branch is unreachable. Keep it for future-proofing if a new
        // detector is added but the dispatch is forgotten.
        continue;
      }
      files.push({ path: outPath, content });
      manifest.push({ path: safe, bytes: entryBuf.byteLength, status: "extracted", outputPath: outPath });
      entriesProcessed += 1;
    } catch (err) {
      manifest.push({ path: safe, bytes: entryBuf.byteLength, status: "skipped-error", reason: err instanceof Error ? err.message : String(err) });
    }
  }

  // Manifest first — gives the agent a directory at a glance.
  const manifestMd = buildManifestMd(archiveFileName, manifest);
  files.unshift({ path: `_MANIFEST.md`, content: manifestMd });
  return { files, manifest };
}

function buildManifestMd(archiveFileName: string, manifest: ZipManifestEntry[]): string {
  const lines: string[] = [
    `# Archive: ${archiveFileName}`,
    "",
    `Entries: ${manifest.length}`,
    "",
    "| Status | Path | Size | Output / Reason |",
    "| --- | --- | --- | --- |",
  ];
  for (const m of manifest) {
    const sizeKb = m.bytes > 0 ? `${Math.max(1, Math.round(m.bytes / 1024))} KB` : "—";
    const tail = m.status === "extracted" ? (m.outputPath ?? "") : (m.reason ?? "");
    lines.push(`| ${m.status} | \`${m.path}\` | ${sizeKb} | ${tail} |`);
  }
  return lines.join("\n") + "\n";
}
