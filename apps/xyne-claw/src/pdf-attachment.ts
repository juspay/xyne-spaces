/**
 * PDF attachment decoder.
 *
 * Same shape as xlsx-attachment.ts: converts a user-uploaded .pdf into a
 * markdown text blob that flows through the same `.context/<name>.pdf.md`
 * workspace-file path that .csv / .md / .txt / .xlsx already use. The agent
 * reads it via its file-read tool — we do NOT pass binary bytes to the LLM
 * (pimono only exposes `ImageContent`) and we do NOT keep the binary on disk.
 *
 * Caps prevent a 500-page brochure from blowing the agent's token budget:
 * MAX_PAGES, MAX_CHARS_PER_PAGE, MAX_TOTAL_CHARS — when any cap fires we
 * append a one-line footer so the agent knows extraction was truncated.
 *
 * Bad/encrypted/corrupt PDF → returns a single-line error blob (same as
 * xlsx) so the agent sees the filename and skips cleanly instead of the
 * whole run aborting.
 */
import { extractText } from "unpdf";
import { matchesAttachmentType, PDF_ATTACHMENT } from "xyne-claw-shared";

const MAX_PAGES = 100;
const MAX_CHARS_PER_PAGE = 10_000;
const MAX_TOTAL_CHARS = 200_000;

export const PDF_MIME_TYPES = PDF_ATTACHMENT.mimeTypes;
export const PDF_EXTENSIONS = PDF_ATTACHMENT.extensions;

export function isPdfAttachment(fileName: string, mimeType?: string | null): boolean {
  return matchesAttachmentType(fileName, mimeType, PDF_ATTACHMENT.mimeTypes, PDF_ATTACHMENT.extensions);
}

function clampText(s: string, cap: number): { out: string; truncated: boolean } {
  // Collapse runs of internal whitespace — PDF.js often emits text with
  // extra newlines/spaces between layout-positioned glyphs that the model
  // doesn't need.
  const normalized = s.replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
  if (normalized.length <= cap) return { out: normalized, truncated: false };
  return { out: normalized.slice(0, cap), truncated: true };
}

/**
 * Extract text from a PDF buffer and return markdown with per-page sections.
 * Always resolves — encrypted/corrupt PDFs produce an error stub instead of
 * throwing, so a single bad attachment doesn't abort the whole agent run.
 */
export async function pdfBufferToMarkdown(buf: Buffer, fileName: string): Promise<string> {
  try {
    // unpdf accepts the raw bytes directly via a Uint8Array. We pass a fresh
    // Uint8Array view so the underlying ArrayBuffer isn't shared with anything
    // unpdf might mutate.
    const bytes = new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength).slice();
    const { totalPages, text } = await extractText(bytes, { mergePages: false });

    const lines: string[] = [];
    lines.push(`# ${fileName}`);
    lines.push("");
    lines.push(`_Extracted PDF text. ${totalPages} page${totalPages === 1 ? "" : "s"} total._`);
    lines.push("");

    const pagesToInclude = Math.min(totalPages, text.length, MAX_PAGES);
    let totalChars = 0;
    let truncatedDueToTotal = false;
    let truncatedAnyPage = false;

    for (let i = 0; i < pagesToInclude; i++) {
      const pageText = text[i] ?? "";
      const remainingBudget = MAX_TOTAL_CHARS - totalChars;
      if (remainingBudget <= 0) {
        truncatedDueToTotal = true;
        break;
      }
      const perPageCap = Math.min(MAX_CHARS_PER_PAGE, remainingBudget);
      const { out, truncated } = clampText(pageText, perPageCap);
      if (truncated) truncatedAnyPage = true;
      lines.push(`## Page ${i + 1}`);
      lines.push("");
      lines.push(out.length > 0 ? out : "_(no extractable text on this page)_");
      lines.push("");
      totalChars += out.length;
    }

    const footers: string[] = [];
    if (totalPages > pagesToInclude) {
      footers.push(`_Truncated: ${totalPages - pagesToInclude} more page(s) not shown (cap: ${MAX_PAGES})._`);
    }
    if (truncatedDueToTotal) {
      footers.push(`_Truncated: total extracted text exceeded ${MAX_TOTAL_CHARS} chars._`);
    }
    if (truncatedAnyPage) {
      footers.push(`_One or more pages were clipped at ${MAX_CHARS_PER_PAGE} chars._`);
    }
    if (footers.length > 0) {
      lines.push("---");
      lines.push(...footers);
    }

    return lines.join("\n");
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return `# ${fileName}\n\n_Failed to extract PDF text: ${msg}_`;
  }
}
