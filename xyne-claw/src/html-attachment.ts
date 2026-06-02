/**
 * Inbound HTML attachment ingest.
 *
 * Detects HTML files by MIME or extension, and writes the raw HTML to
 * `.context/<name>.html` so the agent's Read tool sees the markup as-is.
 * Models can interpret HTML inline (it's tag-structured text), so no
 * pre-processing layer is needed. If you ever want clean-text extraction,
 * swap `htmlBufferToMarkdown` to run linkedom + Readability — the call
 * site doesn't care.
 *
 * Sibling of pdf-attachment.ts, xlsx-attachment.ts, video-attachment.ts.
 */

const HTML_MIME_TYPES = new Set(["text/html", "application/xhtml+xml"]);
export const HTML_EXTENSIONS = new Set([".html", ".htm", ".xhtml"]);

export function isHtmlAttachment(fileName: string, mimeType: string): boolean {
  if (HTML_MIME_TYPES.has((mimeType ?? "").toLowerCase())) return true;
  const dot = fileName.lastIndexOf(".");
  if (dot < 0) return false;
  return HTML_EXTENSIONS.has(fileName.slice(dot).toLowerCase());
}

/** Cap total HTML size we write into context — anything bigger is truncated
 *  with a footer note so a runaway page doesn't poison the agent's context. */
const MAX_HTML_CHARS = 200_000;

/**
 * Render the raw HTML for `.context/<name>.html`. We strip the BOM and cap
 * size; otherwise the body is verbatim so the model can reason about
 * structure (tables, headings, links). Throws never — returns a short
 * placeholder on decode failure.
 */
export async function htmlBufferToMarkdown(buf: Buffer, fileName: string): Promise<string> {
  try {
    let text = buf.toString("utf8");
    if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);
    if (text.length <= MAX_HTML_CHARS) return text;
    const truncated = text.slice(0, MAX_HTML_CHARS);
    return (
      truncated +
      `\n\n<!-- [html-attachment] truncated from ${text.length.toLocaleString()} → ${MAX_HTML_CHARS.toLocaleString()} chars for ${fileName} -->\n`
    );
  } catch (err) {
    return `<!-- [html-attachment] failed to decode ${fileName}: ${err instanceof Error ? err.message : String(err)} -->\n`;
  }
}
