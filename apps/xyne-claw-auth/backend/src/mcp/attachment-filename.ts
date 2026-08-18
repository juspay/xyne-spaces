/**
 * Filename derivation for binary files forwarded out of MCP tool results.
 *
 * Extracted from mcp/runner.ts so the logic is pure and unit-testable without
 * pulling in the runner's session/DB/MCP-SDK import graph.
 */

/**
 * Map a MIME type to a file extension. Best-effort substring matching over a
 * curated set; falls back to "bin" for anything unrecognised. Used both for
 * image/audio content (which carries no uri) and as the extension fallback
 * when a forwarded resource's uri has no usable name.
 */
export function extForMime(mime: string): string {
  const m = mime.toLowerCase();
  if (m.includes("pdf")) return "pdf";
  if (m.includes("png")) return "png";
  if (m.includes("jpeg") || m.includes("jpg")) return "jpg";
  if (m.includes("gif")) return "gif";
  if (m.includes("webp")) return "webp";
  if (m.includes("svg")) return "svg";
  if (m.includes("csv")) return "csv";
  // Office documents (OOXML + legacy). Match the specific OOXML tokens before
  // the generic spreadsheet/excel fallbacks below so .docx/.pptx win.
  if (m.includes("wordprocessingml")) return "docx";
  if (m.includes("presentationml")) return "pptx";
  if (m.includes("msword")) return "doc";
  if (m.includes("ms-powerpoint") || m.includes("powerpoint")) return "ppt";
  if (m.includes("spreadsheet") || m.includes("excel") || m.includes("xlsx")) return "xlsx";
  if (m.includes("mp4")) return "mp4";
  if (m.startsWith("audio") && m.includes("mpeg")) return "mp3";
  if (m.includes("wav")) return "wav";
  if (m.includes("json")) return "json";
  if (m.includes("zip")) return "zip";
  if (m.includes("html")) return "html";
  if (m.includes("xml")) return "xml";
  if (m === "text/plain" || m.includes("plain")) return "txt";
  return "bin";
}

/**
 * Reduce a resource `uri` to a safe download basename.
 *
 * SECURITY: `uri` is tool-controlled and untrusted. We take the basename only,
 * strip path separators, control chars and leading dots, and cap length — so a
 * hostile name can never traverse or overwrite paths if the filename is later
 * used as a filesystem path. Returns "" when nothing usable remains.
 */
export function sanitizeResourceFileName(raw: string): string {
  const BSLASH = String.fromCharCode(92); // a single backslash
  // Drop any query/fragment, then take the basename (last path segment,
  // handling both forward-slash and backslash separators).
  let name = (raw.split("?")[0] ?? "").split("#")[0] ?? "";
  const cut = Math.max(name.lastIndexOf("/"), name.lastIndexOf(BSLASH));
  if (cut >= 0) name = name.slice(cut + 1);
  try {
    name = decodeURIComponent(name);
  } catch {
    /* keep raw basename on malformed %-encoding */
  }
  // Re-take the basename after decoding, in case %2F / %5C decoded to a
  // separator, then remove control chars (0x00-0x1f, 0x7f) and any residual
  // separators.
  const cut2 = Math.max(name.lastIndexOf("/"), name.lastIndexOf(BSLASH));
  if (cut2 >= 0) name = name.slice(cut2 + 1);
  name = Array.from(name)
    .filter((ch) => {
      const code = ch.charCodeAt(0);
      if (code < 0x20 || code === 0x7f) return false;
      return ch !== "/" && ch !== BSLASH;
    })
    .join("");
  // Strip leading dots (".", "..", ".hidden" traversal attempts).
  let i = 0;
  while (i < name.length && name.charAt(i) === ".") i++;
  name = name.slice(i).trim();
  if (name === "") return "";
  return name.slice(0, 200);
}

/**
 * Choose the download filename for a forwarded EmbeddedResource.
 *
 * MCP resource contents always carry a `uri` (e.g.
 * "npci-doc://.../product_note_v1.docx"); the producing tool has already
 * encoded the real name there, so we honor it — keeping BOTH the human-
 * meaningful basename and a correct extension for any type. We fall back to the
 * type-only "tool-idx.ext" form when the uri has no usable name (or for
 * image/audio content, which carries no uri at all). The idx disambiguator on
 * the fallback keeps multiple files from one tool from colliding.
 */
export function fileNameFromResource(
  uri: unknown,
  mime: string,
  tool: string,
  idx: number,
): string {
  const base = typeof uri === "string" ? sanitizeResourceFileName(uri) : "";
  if (base) {
    // Keep the name's own extension when it already has a short one; otherwise
    // append the mime-derived extension so the file still opens correctly.
    const dot = base.lastIndexOf(".");
    const hasExt = dot > 0 && dot < base.length - 1 && base.length - dot <= 9;
    return hasExt ? base : `${base}.${extForMime(mime)}`;
  }
  return `${tool}-${idx}.${extForMime(mime)}`;
}
