/**
 * Inbound DOCX (MS Word) attachment ingest.
 *
 * Mammoth converts a DOCX buffer into markdown — headings, lists, tables,
 * inline formatting all preserved. Output is sibling-written to
 * `.context/<name>.docx.md` so the agent's Read tool sees it like every
 * other server-converted artefact (pdf.md, xlsx.md, video.md).
 *
 * Failures fall back to a short error stub rather than throwing — one bad
 * file shouldn't fail the whole /run.
 */
import mammoth from "mammoth";
import { matchesAttachmentType, DOCX_ATTACHMENT } from "xyne-claw-shared";

// Mammoth's bundled .d.ts only types `convertToHtml` / `extractRawText`,
// but the runtime exposes `convertToMarkdown` too (see node_modules/mammoth
// /lib/index.js — `exports.convertToMarkdown = convertToMarkdown`).
// We cast through `unknown` to call it without a type-system pretense
// that's it not there.
type MammothMarkdown = {
  convertToMarkdown: (input: { buffer: Buffer }) => Promise<{
    value: string;
    messages: Array<{ type: string; message: string }>;
  }>;
};
const mammothMd = mammoth as unknown as MammothMarkdown;

export const DOCX_EXTENSIONS = DOCX_ATTACHMENT.extensions;

export function isDocxAttachment(fileName: string, mimeType?: string | null): boolean {
  return matchesAttachmentType(fileName, mimeType, DOCX_ATTACHMENT.mimeTypes, DOCX_ATTACHMENT.extensions);
}

/** Cap on per-file markdown output so a 200-page contract doesn't drown
 *  the agent's context window. Truncated content gets a footer note. */
const MAX_MARKDOWN_CHARS = 200_000;

export async function docxBufferToMarkdown(buf: Buffer, fileName: string): Promise<string> {
  try {
    const { value, messages } = await mammothMd.convertToMarkdown({ buffer: buf });
    let md = value.trim();
    if (md.length === 0) {
      return `<!-- [docx-attachment] ${fileName} converted to empty markdown — likely image-only or unparseable -->\n`;
    }
    if (md.length > MAX_MARKDOWN_CHARS) {
      md =
        md.slice(0, MAX_MARKDOWN_CHARS) +
        `\n\n<!-- [docx-attachment] truncated at ${MAX_MARKDOWN_CHARS.toLocaleString()} chars (full was ${md.length.toLocaleString()}) for ${fileName} -->\n`;
    }
    // Mammoth emits non-fatal warnings (unsupported style, missing image, etc.)
    // Surface only the count so the agent knows the conversion was lossy
    // without flooding the context with style names.
    if (messages.length > 0) {
      md += `\n\n<!-- [docx-attachment] mammoth flagged ${messages.length} warning(s) during conversion -->\n`;
    }
    return md;
  } catch (err) {
    return `<!-- [docx-attachment] failed to convert ${fileName}: ${err instanceof Error ? err.message : String(err)} -->\n`;
  }
}
