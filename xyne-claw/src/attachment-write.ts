/**
 * Shared inbound-attachment write logic.
 *
 * Two paths flow into `.context/`:
 *   1. Webhook-bound (run.ts) — attachments shipped with the triggering @mention.
 *   2. Tool-bound (mcp.ts marker decoder) — files the agent pulls mid-run via
 *      `spaces-fetch-attachment` (the `[SPACES_ATTACHMENT:name:mime]\n<b64>`
 *      marker emitted by claw-auth's MCP tool).
 *
 * Both must apply the SAME mime/extension allowlist and the SAME write rules
 * (xlsx → multi-sheet markdown sibling, pdf → unpdf-extracted markdown sibling,
 * text → utf-8 file, image/other → raw buffer). Without a shared helper the
 * two paths drift — e.g. the webhook auto-extracts a PDF while the tool path
 * dumps raw bytes the agent can't read.
 *
 * The webhook keeps its existing batched flow (it builds `derivedContextFiles`
 * for the systemPrompt index). Only the helpers it composes from are exported
 * here; the marker decoder calls the higher-level `writeAttachmentToContext`.
 */
import { mkdir, writeFile } from "node:fs/promises";
import { join as joinPath, extname } from "node:path";
import { isXlsxAttachment, xlsxBufferToMarkdown } from "./xlsx-attachment.js";
import { isPdfAttachment, pdfBufferToMarkdown } from "./pdf-attachment.js";

export const TEXT_ATTACHMENT_MIME_TYPES = new Set([
  "text/plain",
  "text/markdown",
  "application/json",
  "text/csv",
  "application/yaml",
  "text/yaml",
  "application/xml",
  "text/xml",
]);

export const TEXT_ATTACHMENT_EXTENSIONS = new Set([
  ".txt", ".md", ".json", ".csv", ".yml", ".yaml", ".xml", ".log",
]);

export function isTextAttachment(fileName: string, mimeType: string): boolean {
  if (TEXT_ATTACHMENT_MIME_TYPES.has(mimeType.toLowerCase())) return true;
  const ext = extname(fileName).toLowerCase();
  return TEXT_ATTACHMENT_EXTENSIONS.has(ext);
}

export function isImageAttachment(_fileName: string, mimeType: string): boolean {
  return mimeType.toLowerCase().startsWith("image/");
}

/**
 * Strip a leading data: URI and any whitespace from a base64 payload so
 * `Buffer.from(..., "base64")` doesn't choke. The webhook path historically
 * pre-strips via `normalizeAttachmentBase64`; doing it here too is safe.
 */
export function normalizeAttachmentBase64(data: string): string {
  return data.replace(/^data:[^;]+;base64,/, "").replace(/\s+/g, "");
}

export interface PersistResult {
  /** Relative path inside the workspace (e.g. `.context/foo.pdf.md`). */
  relPath: string;
  /** Human-readable shape descriptor — `text`, `xlsx → md`, `pdf → md`,
   *  `image`, or the raw mime if we wrote it as a binary blob. */
  kind: string;
  /** Bytes written to disk after any extraction. Useful for the LLM-visible
   *  status line so the agent knows whether the file is empty. */
  byteSize: number;
}

/**
 * Sanitise a filename so it can't escape `.context/` — strip directory
 * separators and leading dots. Returned name is always safe to join.
 */
function sanitiseFileName(name: string): string {
  return name.replace(/[/\\]/g, "_").replace(/^\.+/, "") || "attachment";
}

/**
 * Write one attachment into the workspace's `.context/` directory, applying
 * the same type-dispatch the webhook flow uses.
 *
 *   xlsx → `.context/<name>.md` (multi-sheet markdown)
 *   pdf  → `.context/<name>.md` (unpdf-extracted)
 *   text → `.context/<name>` decoded as utf-8
 *   image / other → `.context/<name>` raw buffer
 *
 * Returns the relative path + kind so the caller can compose a status line
 * for the LLM (e.g. "Saved `.context/foo.pdf.md` (pdf → md, 12.3KB)").
 */
export async function writeAttachmentToContext(
  workspaceDir: string,
  fileName: string,
  mimeType: string,
  buffer: Buffer,
): Promise<PersistResult> {
  const safeName = sanitiseFileName(fileName);
  const contextDir = joinPath(workspaceDir, ".context");
  await mkdir(contextDir, { recursive: true });

  if (isXlsxAttachment(safeName, mimeType)) {
    const md = await xlsxBufferToMarkdown(buffer, safeName);
    const out = `${safeName}.md`;
    await writeFile(joinPath(contextDir, out), md, "utf8");
    return { relPath: `.context/${out}`, kind: "xlsx → md", byteSize: Buffer.byteLength(md, "utf8") };
  }

  if (isPdfAttachment(safeName, mimeType)) {
    const md = await pdfBufferToMarkdown(buffer, safeName);
    const out = `${safeName}.md`;
    await writeFile(joinPath(contextDir, out), md, "utf8");
    return { relPath: `.context/${out}`, kind: "pdf → md", byteSize: Buffer.byteLength(md, "utf8") };
  }

  if (isTextAttachment(safeName, mimeType)) {
    const text = buffer.toString("utf8");
    await writeFile(joinPath(contextDir, safeName), text, "utf8");
    return { relPath: `.context/${safeName}`, kind: "text", byteSize: Buffer.byteLength(text, "utf8") };
  }

  if (isImageAttachment(safeName, mimeType)) {
    await writeFile(joinPath(contextDir, safeName), buffer);
    return { relPath: `.context/${safeName}`, kind: "image", byteSize: buffer.length };
  }

  // Fallback: write raw buffer. Agent's `read` may or may not be useful for
  // binary types, but at least the file is delivered. Caller can decide
  // whether to surface a warning to the user.
  await writeFile(joinPath(contextDir, safeName), buffer);
  return { relPath: `.context/${safeName}`, kind: mimeType || "binary", byteSize: buffer.length };
}
