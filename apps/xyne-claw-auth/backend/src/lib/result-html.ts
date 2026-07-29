/**
 * Length-fallback renderer: markdown → standalone HTML attachment.
 *
 * Replaces the pdfkit-based `renderMarkdownToPdf` for the >10K-char Spaces
 * length cap case. We use `marked` to lex+render markdown to HTML, then
 * sanitize, then wrap in the same `buildHtmlDocument` template that the
 * `create-html-report` custom tool uses — so the length-fallback artifact
 * looks identical to a deliberate "make a report" artifact.
 *
 * Why HTML over PDF for this codepath:
 *   - The browser is the layout engine. Tables, code blocks, nested lists,
 *     blockquotes, links — all rendered correctly without per-token walkers.
 *   - No pdfkit page-break / column-cascade bugs.
 *   - Mobile-friendly, Ctrl+F works, links are clickable.
 *   - Same template as create-html-report → consistent look across surfaces.
 *
 * PDF attachment bundling (>10 attachments) still goes through pdfkit via
 * `renderAttachmentsToPdf` — that path bundles arbitrary binaries and doesn't
 * have the same walker concerns.
 */

import { marked } from "marked";
import { buildHtmlDocument, sanitizeHtmlBody } from "xyne-claw-shared";

export interface HtmlRenderOptions {
  title?: string;
  subtitle?: string;
}

/**
 * Render markdown to a UTF-8 HTML buffer suitable for uploading via Spaces'
 * multipart attachment endpoint. Returns a Buffer so the caller pipeline
 * (base64-encode → JSON payload) stays unchanged from the old PDF path.
 */
export async function renderMarkdownToHtml(
  markdown: string,
  opts: HtmlRenderOptions = {},
): Promise<Buffer> {
  // marked.parse is synchronous for string input but typed as Promise<string>
  // in newer versions — wrap in Promise.resolve to handle both.
  const rawHtml = await Promise.resolve(marked.parse(markdown));
  const safeBody = sanitizeHtmlBody(typeof rawHtml === "string" ? rawHtml : String(rawHtml));

  const fullHtml = buildHtmlDocument({
    title: opts.title ?? "Agent Response",
    ...(opts.subtitle ? { subtitle: opts.subtitle } : {}),
    body: safeBody,
  });

  return Buffer.from(fullHtml, "utf8");
}
