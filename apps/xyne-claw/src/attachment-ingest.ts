/**
 * Attachment ingestion — turns the raw `attachments[]` on a /run request into
 * the derived artefacts the agent loop consumes. Extracted verbatim from
 * routes/run.ts (processTask) so the per-type pipelines are testable in
 * isolation and the base64-decode + filter+map boilerplate lives in one place.
 *
 * Each non-image, non-zip attachment is decoded once and converted to a
 * markdown sibling under `.context/`. Three types carry side effects that keep
 * them out of the simple converter table:
 *   - pdf   → also retains the RAW bytes (fill-pdf-form needs the real file)
 *   - video → also emits keyframes for the opening prompt
 *   - zip   → fans out to many files + a per-archive manifest log
 *
 * Ordering of `derivedContextFiles` is significant: later entries can shadow
 * earlier `.context/` paths when written to disk, so it MUST stay
 * text → xlsx → pdf → video → docx → pptx → html → zip (the original order).
 */
import { isXlsxAttachment, xlsxBufferToMarkdown } from "./xlsx-attachment.js";
import { isPdfAttachment, pdfBufferToMarkdown } from "./pdf-attachment.js";
import { isVideoAttachment, videoBufferToContext, type VideoKeyframe } from "./video-attachment.js";
import { isDocxAttachment, docxBufferToMarkdown } from "./docx-attachment.js";
import { isPptxAttachment, pptxBufferToMarkdown } from "./pptx-attachment.js";
import { isHtmlAttachment, htmlBufferToMarkdown } from "./html-attachment.js";
import { isZipAttachment, zipBufferToContextFiles } from "./zip-attachment.js";
import { isTextAttachment, normalizeAttachmentBase64 } from "./attachment-write.js";

/** Raw attachment as it arrives on the /run request body. */
export interface AttachmentInput {
  fileName: string;
  mimeType: string;
  data: string;
}

export interface TextAttachmentFile {
  path: string;
  content: string;
  fileName: string;
  mimeType: string;
}

export interface ContextFile {
  path: string;
  content: string;
}

export interface IngestedAttachments {
  /** Markdown/context files to write under the workspace `.context/` dir, in
   *  shadow-order (see module header). */
  derivedContextFiles: ContextFile[];
  /** Raw PDF bytes kept alongside the extracted markdown. */
  pdfBuffers: Array<{ fileName: string; buf: Buffer }>;
  /** Keyframes extracted from videos, injected into the opening prompt. */
  videoKeyframes: VideoKeyframe[];
  /** Raw recordings retained only for /record-skill's sandbox analyzer. */
  videoBuffers: Array<{ fileName: string; mimeType: string; buf: Buffer }>;
  /** Per-type attachment lists the prompt-builder still references by name. */
  imageAttachments: AttachmentInput[];
  textAttachments: TextAttachmentFile[];
  xlsxAttachments: AttachmentInput[];
  pdfAttachments: AttachmentInput[];
  docxAttachments: AttachmentInput[];
  pptxAttachments: AttachmentInput[];
  htmlAttachments: AttachmentInput[];
  videoAttachments: AttachmentInput[];
}

export interface IngestAttachmentOptions {
  /** Keep videos raw for the sandbox-backed /record-skill analyzer instead of
   * running ffmpeg in the xyne-claw pod. Ordinary attachment behavior is
   * unchanged when false/omitted. */
  deferVideoProcessing?: boolean;
  litellmApiKey?: string;
}

/** Decode an attachment's base64 payload to bytes (handles data-URI prefixes). */
function decode(a: AttachmentInput): Buffer {
  return Buffer.from(normalizeAttachmentBase64(a.data), "base64");
}

/** Decode a text attachment to a UTF-8 string, stripping a leading BOM. */
function decodeTextAttachment(data: string): string {
  const decoded = Buffer.from(normalizeAttachmentBase64(data), "base64").toString("utf8");
  return decoded.charCodeAt(0) === 0xfeff ? decoded.slice(1) : decoded;
}

// Types whose pipeline is identical: filter → decode → bufferToMarkdown →
// `{ path: <name><suffix>, content }`. html keeps the raw filename (suffix ""),
// the rest get a `.md` sibling.
const MD_CONVERTERS: ReadonlyArray<{
  match: (fileName: string, mimeType: string) => boolean;
  convert: (buf: Buffer, fileName: string) => Promise<string>;
  suffix: string;
}> = [
  { match: isXlsxAttachment, convert: xlsxBufferToMarkdown, suffix: ".md" },
  { match: isDocxAttachment, convert: docxBufferToMarkdown, suffix: ".md" },
  { match: isPptxAttachment, convert: pptxBufferToMarkdown, suffix: ".md" },
  { match: isHtmlAttachment, convert: htmlBufferToMarkdown, suffix: "" },
];

/**
 * Convert a single document buffer to markdown iff its type is convertible —
 * the one reusable "is this convertible + convert it" decision, shared by the
 * /run attachment pipeline above and skill-file materialization
 * (session-skills.ts). Returns null for unsupported types. Throws whatever
 * the underlying converter throws (corrupt file etc.) — callers decide
 * whether that is fatal (attachments) or skippable (skill files).
 */
export async function documentBufferToMarkdown(
  buf: Buffer,
  fileName: string,
  mimeType: string,
): Promise<string | null> {
  if (isPdfAttachment(fileName, mimeType)) return pdfBufferToMarkdown(buf, fileName);
  for (const c of MD_CONVERTERS) {
    if (c.match(fileName, mimeType)) return c.convert(buf, fileName);
  }
  return null;
}

async function convertAll(
  attachments: AttachmentInput[],
  convert: (buf: Buffer, fileName: string) => Promise<string>,
  suffix: string,
): Promise<ContextFile[]> {
  return Promise.all(
    attachments.map(async (a) => ({
      path: `${a.fileName}${suffix}`,
      content: await convert(decode(a), a.fileName),
    })),
  );
}

/**
 * Run every per-type pipeline over the request's attachments. Pure aside from
 * `log` calls (video/zip ingest summaries) — no disk writes happen here; the
 * caller persists `derivedContextFiles` / `pdfBuffers` to the workspace.
 *
 * `opts.litellmApiKey`, when present, is forwarded to the video pipeline so its
 * vision-model calls charge the user's per-key budget instead of the shared
 * server key.
 */
export async function ingestAttachments(
  attachments: AttachmentInput[] | undefined,
  log: (message: string) => void,
  options: IngestAttachmentOptions = {},
): Promise<IngestedAttachments> {
  const all = attachments ?? [];

  const imageAttachments = all.filter((a) => a.mimeType.startsWith("image/"));

  const textAttachments: TextAttachmentFile[] = all
    .filter((a) => isTextAttachment(a.fileName, a.mimeType))
    .map((a) => ({
      path: a.fileName,
      content: decodeTextAttachment(a.data),
      fileName: a.fileName,
      mimeType: a.mimeType,
    }));

  // Simple markdown converters (xlsx/docx/pptx/html). Every list is returned by
  // name: the prompt-builder needs them to advertise the derived `.context/`
  // paths, and a type missing from that block is invisible to the agent even
  // though its markdown sibling is on disk.
  const xlsxAttachments = all.filter((a) => isXlsxAttachment(a.fileName, a.mimeType));
  const docxAttachments = all.filter((a) => isDocxAttachment(a.fileName, a.mimeType));
  const pptxAttachments = all.filter((a) => isPptxAttachment(a.fileName, a.mimeType));
  const htmlAttachments = all.filter((a) => isHtmlAttachment(a.fileName, a.mimeType));
  const [xlsxDerived, docxDerived, pptxDerived, htmlDerived] = await Promise.all([
    convertAll(xlsxAttachments, xlsxBufferToMarkdown, ".md"),
    convertAll(docxAttachments, docxBufferToMarkdown, ".md"),
    convertAll(pptxAttachments, pptxBufferToMarkdown, ".md"),
    convertAll(htmlAttachments, htmlBufferToMarkdown, ""),
  ]);

  // PDF — markdown sibling AND retain raw bytes for fill-pdf-form / inspect.
  const pdfAttachments = all.filter((a) => isPdfAttachment(a.fileName, a.mimeType));
  const pdfBuffers: Array<{ fileName: string; buf: Buffer }> = [];
  const pdfDerived = await Promise.all(
    pdfAttachments.map(async (a) => {
      const buf = decode(a);
      pdfBuffers.push({ fileName: a.fileName, buf });
      return { path: `${a.fileName}.md`, content: await pdfBufferToMarkdown(buf, a.fileName) };
    }),
  );

  // Video — narrative file + keyframes for the prompt.
  const videoAttachments = all.filter((a) => isVideoAttachment(a.fileName, a.mimeType));
  const videoKeyframes: VideoKeyframe[] = [];
  const videoBuffers: Array<{ fileName: string; mimeType: string; buf: Buffer }> = [];
  const videoDerived = await Promise.all(
    videoAttachments.map(async (a) => {
      const buf = decode(a);
      if (options.deferVideoProcessing) {
        videoBuffers.push({ fileName: a.fileName, mimeType: a.mimeType, buf });
        return {
          path: `${a.fileName}.video.md`,
          content:
            `# Recording: ${a.fileName}\n\n` +
            `This recording is staged for the sandbox-backed \`analyze-skill-recording\` tool.\n`,
        };
      }
      const { narrative, keyframes } = await videoBufferToContext(buf, a.fileName, options.litellmApiKey ? { litellmApiKey: options.litellmApiKey } : undefined);
      videoKeyframes.push(...keyframes);
      return { path: `${a.fileName}.video.md`, content: narrative };
    }),
  );
  if (videoAttachments.length > 0) {
    log(`Video ingest: ${videoAttachments.length} video(s) → ${videoKeyframes.length} keyframe(s) + narrative(s)`);
  }

  // ZIP — unzip and fan each entry into a namespaced context file. Sequential
  // (not Promise.all) to bound peak memory across large archives.
  const zipAttachments = all.filter((a) => isZipAttachment(a.fileName, a.mimeType));
  const zipDerived: ContextFile[] = [];
  for (const a of zipAttachments) {
    const { files: entries, manifest } = await zipBufferToContextFiles(decode(a), a.fileName);
    const extractedCount = manifest.filter((m) => m.status === "extracted").length;
    const skippedCount = manifest.length - extractedCount;
    log(`Zip ingest: ${a.fileName} → extracted=${extractedCount} skipped=${skippedCount}`);
    for (const e of entries) {
      zipDerived.push({ path: `${a.fileName}/${e.path}`, content: e.content });
    }
  }

  const derivedContextFiles: ContextFile[] = [
    ...textAttachments.map(({ path, content }) => ({ path, content })),
    ...xlsxDerived,
    ...pdfDerived,
    ...videoDerived,
    ...docxDerived,
    ...pptxDerived,
    ...htmlDerived,
    ...zipDerived,
  ];

  return {
    derivedContextFiles,
    pdfBuffers,
    videoKeyframes,
    videoBuffers,
    imageAttachments,
    textAttachments,
    xlsxAttachments,
    pdfAttachments,
    docxAttachments,
    pptxAttachments,
    htmlAttachments,
    videoAttachments,
  };
}
