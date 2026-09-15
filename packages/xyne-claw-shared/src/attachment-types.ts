/** Shared MIME and extension matching for inbound attachments. */
export function matchesAttachmentType(
  fileName: string,
  mimeType: string | null | undefined,
  mimeTypes: ReadonlySet<string>,
  extensions: ReadonlySet<string>,
): boolean {
  const normalizedMimeType = (mimeType ?? "").toLowerCase();
  for (const candidate of mimeTypes) {
    const matchesMimeType = candidate.endsWith("/")
      ? normalizedMimeType.startsWith(candidate)
      : normalizedMimeType === candidate;
    if (matchesMimeType) {
      return true;
    }
  }

  const dot = fileName.lastIndexOf(".");
  if (dot < 0) return false;
  return extensions.has(fileName.slice(dot).toLowerCase());
}

export interface AttachmentFamily {
  mimeTypes: ReadonlySet<string>;
  extensions: ReadonlySet<string>;
}

export const IMAGE_ATTACHMENT: AttachmentFamily = {
  mimeTypes: new Set(["image/"]),
  extensions: new Set<string>(),
};

// Video — extracted to a frame-by-frame narrative + keyframes by
// videoBufferToContext in xyne-claw/src/video-attachment.ts before the
// agent sees it (the model can't ingest video, only frames).
export const VIDEO_MIME_PREFIX = "video/";
export const VIDEO_ATTACHMENT: AttachmentFamily = {
  mimeTypes: new Set([VIDEO_MIME_PREFIX]),
  extensions: new Set([
    ".mov", ".mp4", ".m4v", ".webm", ".avi", ".mkv", ".mpg", ".mpeg", ".wmv", ".flv",
  ]),
};

export function isVideoAttachment(fileName: string | null | undefined, mimeType: string | null | undefined): boolean {
  return matchesAttachmentType(fileName ?? "", mimeType, VIDEO_ATTACHMENT.mimeTypes, VIDEO_ATTACHMENT.extensions);
}

export function videoFileExtension(fileName: string | null | undefined): string | null {
  const name = fileName ?? "";
  const dot = name.lastIndexOf(".");
  if (dot < 0) return null;
  const ext = name.slice(dot).toLowerCase();
  return VIDEO_ATTACHMENT.extensions.has(ext) ? ext.slice(1) : null;
}

export const TEXT_LIKE_ATTACHMENT: AttachmentFamily = {
  mimeTypes: new Set([
    "text/plain",
    "text/markdown",
    "application/json",
    "text/csv",
    "application/yaml",
    "text/yaml",
    "application/xml",
    "text/xml",
  ]),
  extensions: new Set([
    ".txt", ".md", ".json", ".csv", ".yml", ".yaml", ".xml", ".log",
  ]),
};

// HTML — written verbatim to .context/<file>.html so the model can
// reason about structure inline (no DOM stripping). See html-attachment.ts.
export const HTML_ATTACHMENT: AttachmentFamily = {
  mimeTypes: new Set(["text/html", "application/xhtml+xml"]),
  extensions: new Set([".html", ".htm", ".xhtml"]),
};

export const PDF_ATTACHMENT: AttachmentFamily = {
  mimeTypes: new Set(["application/pdf"]),
  extensions: new Set([".pdf"]),
};

// xlsx / xlsm — extracted to multi-sheet markdown by xlsxBufferToMarkdown
// in xyne-claw/src/xlsx-attachment.ts before the agent sees it.
export const XLSX_ATTACHMENT: AttachmentFamily = {
  mimeTypes: new Set([
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "application/vnd.ms-excel.sheet.macroenabled.12",
  ]),
  extensions: new Set([".xlsx", ".xlsm"]),
};

// docx / pptx — converted to markdown by mammoth / JSZip+XML parsing.
export const DOCX_ATTACHMENT: AttachmentFamily = {
  mimeTypes: new Set([
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ]),
  extensions: new Set([".docx"]),
};

export const PPTX_ATTACHMENT: AttachmentFamily = {
  mimeTypes: new Set([
    "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  ]),
  extensions: new Set([".pptx"]),
};

// ZIP — unzipped server-side; each entry routes through the same
// per-type pipeline. Nested zips are skipped (logged in manifest).
// See xyne-claw/src/zip-attachment.ts for safety caps (200 entries,
// 50 MB/entry, 200 MB total).
export const ZIP_ATTACHMENT: AttachmentFamily = {
  mimeTypes: new Set([
    "application/zip",
    "application/x-zip-compressed",
    "application/x-zip",
  ]),
  extensions: new Set([".zip"]),
};

export const INBOUND_ATTACHMENT_FAMILIES = {
  image: IMAGE_ATTACHMENT,
  video: VIDEO_ATTACHMENT,
  textLike: TEXT_LIKE_ATTACHMENT,
  html: HTML_ATTACHMENT,
  pdf: PDF_ATTACHMENT,
  xlsx: XLSX_ATTACHMENT,
  docx: DOCX_ATTACHMENT,
  pptx: PPTX_ATTACHMENT,
  zip: ZIP_ATTACHMENT,
} as const satisfies Record<string, AttachmentFamily>;

export type InboundAttachmentFamily = keyof typeof INBOUND_ATTACHMENT_FAMILIES;

export function isSupportedInboundAttachment(
  fileName: string,
  mimeType: string | null | undefined,
): boolean {
  for (const family of Object.values(INBOUND_ATTACHMENT_FAMILIES)) {
    if (matchesAttachmentType(fileName, mimeType, family.mimeTypes, family.extensions)) {
      return true;
    }
  }
  return false;
}
