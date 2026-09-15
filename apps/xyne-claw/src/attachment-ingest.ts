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
import { gcsDownloadObject } from "./storage.js";

/** Raw attachment as it arrives on the /run request body.
 *
 * Two shapes reach us and BOTH are accepted unconditionally:
 *   - `data`   — base64 inlined into the body (the original contract; still what
 *                recovery-replayed payloads and every non-Spaces caller send)
 *   - `gcsRef` — the bytes live in the shared object store and claw-auth sent
 *                only the object path (XYNE_RUN_ATTACHMENT_REFS=1)
 * `hydrateAttachmentRefs` collapses the second into the first before any
 * per-type pipeline runs, so nothing downstream has to know the difference. */
export interface AttachmentInput {
  fileName: string;
  mimeType: string;
  data?: string;
  gcsRef?: string;
  sizeBytes?: number;
}

/** An attachment whose bytes are in hand — what every pipeline below consumes. */
export interface ResolvedAttachment extends AttachmentInput {
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
  imageAttachments: ResolvedAttachment[];
  textAttachments: TextAttachmentFile[];
  xlsxAttachments: ResolvedAttachment[];
  pdfAttachments: ResolvedAttachment[];
  docxAttachments: ResolvedAttachment[];
  pptxAttachments: ResolvedAttachment[];
  htmlAttachments: ResolvedAttachment[];
  videoAttachments: ResolvedAttachment[];
}

export interface IngestAttachmentOptions {
  /** Keep videos raw for the sandbox-backed /record-skill analyzer instead of
   * running ffmpeg in the xyne-claw pod. Ordinary attachment behavior is
   * unchanged when false/omitted. */
  deferVideoProcessing?: boolean;
}

// The image media types every LLM provider (Anthropic/OpenAI/LiteLLM) accepts
// as an inline image block. Anything else — image/svg+xml, image/bmp,
// image/tiff, image/heic … — must NOT be sent as an image (see ingestAttachments).
const SUPPORTED_MODEL_IMAGE_MIME: ReadonlySet<string> = new Set([
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
]);

/** Decode an attachment's base64 payload to bytes (handles data-URI prefixes). */
function decode(a: ResolvedAttachment): Buffer {
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
  attachments: ResolvedAttachment[],
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
 */
/**
 * Resolve every `gcsRef` attachment to inline base64. Attachments that already
 * carry `data` pass through untouched, so a recovery-replayed payload built
 * before the ref path existed keeps working. A ref whose bytes can't be fetched
 * is DROPPED with a log rather than failing the run — same tolerance the
 * download path in claw-auth applies.
 */
export async function hydrateAttachmentRefs(
  attachments: AttachmentInput[],
  log: (message: string) => void,
): Promise<ResolvedAttachment[]> {
  const resolved: ResolvedAttachment[] = [];
  for (const a of attachments) {
    if (typeof a.data === "string") {
      resolved.push(a as ResolvedAttachment);
      continue;
    }
    if (!a.gcsRef) {
      log(`Attachment ${a.fileName} has neither data nor gcsRef — dropped.`);
      continue;
    }
    const buf = await gcsDownloadObject(a.gcsRef);
    if (!buf) {
      log(`Attachment ${a.fileName} (${a.gcsRef}) could not be fetched from object storage — dropped.`);
      continue;
    }
    resolved.push({ ...a, data: buf.toString("base64") });
  }
  return resolved;
}

export async function ingestAttachments(
  attachments: AttachmentInput[] | undefined,
  log: (message: string) => void,
  options: IngestAttachmentOptions = {},
): Promise<IngestedAttachments> {
  const all = await hydrateAttachmentRefs(attachments ?? [], log);

  // Only mime types every LLM provider accepts as an image block may be sent as
  // one. A single unsupported media_type (e.g. image/svg+xml) makes the provider
  // reject the WHOLE request with a 400 — and because the block is then baked
  // into the persisted conversation history, EVERY retry and EVERY fallback
  // provider re-sends it and 400s too, poisoning the thread permanently (prod
  // 2026-08-24: an attached .svg took xyne-spaces-architect down until the
  // session archive was purged). So classify strictly and route the rest away
  // from image content.
  const baseMime = (m: string): string => m.split(";")[0]!.trim().toLowerCase();
  const isModelImage = (a: AttachmentInput): boolean =>
    SUPPORTED_MODEL_IMAGE_MIME.has(baseMime(a.mimeType));
  const imageAttachments = all.filter(isModelImage);

  // image/* attachments the providers can't render. SVG is XML text, so surface
  // it as a readable text attachment (the agent reads the markup); any other
  // unsupported raster type is dropped with a warning rather than 400-ing the
  // run, since we can't rasterize it here.
  const unsupportedImages = all.filter(
    (a) => a.mimeType.startsWith("image/") && !isModelImage(a),
  );
  const svgAsText: TextAttachmentFile[] = unsupportedImages
    .filter((a) => baseMime(a.mimeType) === "image/svg+xml" || /\.svg$/i.test(a.fileName))
    .map((a) => ({
      path: a.fileName,
      content: decodeTextAttachment(a.data),
      fileName: a.fileName,
      mimeType: "text/plain",
    }));
  for (const a of unsupportedImages) {
    if (baseMime(a.mimeType) === "image/svg+xml" || /\.svg$/i.test(a.fileName)) {
      log(`Attachment ${a.fileName} (${a.mimeType}) not a model-supported image — surfaced as text (SVG markup).`);
    } else {
      log(`Attachment ${a.fileName} (${a.mimeType}) is an unsupported image type — dropped (providers accept only jpeg/png/gif/webp).`);
    }
  }

  const textAttachments: TextAttachmentFile[] = [
    ...all
      .filter((a) => isTextAttachment(a.fileName, a.mimeType))
      .map((a) => ({
        path: a.fileName,
        content: decodeTextAttachment(a.data),
        fileName: a.fileName,
        mimeType: a.mimeType,
      })),
    ...svgAsText,
  ];

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
      const { narrative, keyframes } = await videoBufferToContext(buf, a.fileName);
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
