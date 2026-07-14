/**
 * Microsoft OneDrive API helpers (via Microsoft Graph).
 */

import { inflateRawSync } from "zlib";
import { PDFParse } from "pdf-parse";
import { microsoftFetch } from "./oauth.js";

import { createLogger } from "../../logger.js";
const log = createLogger("onedrive");

const BASE = "https://graph.microsoft.com/v1.0/me/drive";

interface DriveItem {
  id: string;
  name: string;
  size?: number;
  webUrl?: string;
  file?: { mimeType: string };
  folder?: { childCount: number };
  lastModifiedDateTime?: string;
  createdBy?: { user?: { displayName?: string } };
}

interface SearchResponse {
  value: DriveItem[];
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// ── Minimal ZIP + DOCX parser ────────────────────────────────────────

/** Extract a file from a ZIP buffer by filename (uses Central Directory for robustness). */
function zipExtract(zip: Buffer, target: string): Buffer | undefined {
  // Find End of Central Directory record (search backwards from end)
  let eocdOffset = -1;
  for (let i = zip.length - 22; i >= 0 && i >= zip.length - 65557; i--) {
    if (zip.readUInt32LE(i) === 0x06054b50) {
      eocdOffset = i;
      break;
    }
  }
  if (eocdOffset < 0) return undefined;

  const cdOffset = zip.readUInt32LE(eocdOffset + 16);
  const cdEntries = zip.readUInt16LE(eocdOffset + 10);

  let offset = cdOffset;
  for (let i = 0; i < cdEntries && offset < zip.length; i++) {
    if (zip.readUInt32LE(offset) !== 0x02014b50) break;

    const method = zip.readUInt16LE(offset + 10);
    const compressedSize = zip.readUInt32LE(offset + 20);
    const nameLen = zip.readUInt16LE(offset + 28);
    const extraLen = zip.readUInt16LE(offset + 30);
    const commentLen = zip.readUInt16LE(offset + 32);
    const localHeaderOffset = zip.readUInt32LE(offset + 42);
    const name = zip.subarray(offset + 46, offset + 46 + nameLen).toString("utf-8");

    if (name === target) {
      // Read local file header to get actual data start
      const localNameLen = zip.readUInt16LE(localHeaderOffset + 26);
      const localExtraLen = zip.readUInt16LE(localHeaderOffset + 28);
      const dataStart = localHeaderOffset + 30 + localNameLen + localExtraLen;

      const data = zip.subarray(dataStart, dataStart + compressedSize);
      if (method === 0) return data; // stored
      if (method === 8) return inflateRawSync(data); // deflate
      return undefined;
    }

    offset += 46 + nameLen + extraLen + commentLen;
  }
  return undefined;
}

/** Parse a .docx buffer and return plain text. */
function parseDocxBuffer(buffer: Buffer): string | undefined {
  const docXml = zipExtract(buffer, "word/document.xml");
  if (!docXml) return undefined;
  const xml = docXml.toString("utf-8");
  // Extract text from <w:t> tags, join paragraphs with newlines
  const paragraphs: string[] = [];
  for (const pMatch of xml.matchAll(/<w:p[\s>][\s\S]*?<\/w:p>/g)) {
    const texts: string[] = [];
    for (const tMatch of pMatch[0].matchAll(/<w:t[^>]*>([^<]*)<\/w:t>/g)) {
      texts.push(tMatch[1] ?? "");
    }
    if (texts.length > 0) paragraphs.push(texts.join(""));
  }
  return paragraphs.length > 0 ? paragraphs.join("\n") : undefined;
}

/** Parse an .xlsx buffer and return CSV-like text. */
function parseXlsxBuffer(buffer: Buffer): string | undefined {
  const ssXml = zipExtract(buffer, "xl/sharedStrings.xml");
  const sharedStrings: string[] = [];
  if (ssXml) {
    const ssText = ssXml.toString("utf-8");
    for (const m of ssText.matchAll(/<t[^>]*>([^<]*)<\/t>/g)) {
      sharedStrings.push(m[1] ?? "");
    }
  }
  const rows: string[][] = [];
  for (let i = 1; i <= 20; i++) {
    const sheetXml = zipExtract(buffer, `xl/worksheets/sheet${i}.xml`);
    if (!sheetXml) break;
    if (i > 1) rows.push([`--- Sheet ${i} ---`]);
    const sheetText = sheetXml.toString("utf-8");
    for (const rowMatch of sheetText.matchAll(/<row[^>]*>([\s\S]*?)<\/row>/g)) {
      const cells: string[] = [];
      for (const cellMatch of rowMatch[1]!.matchAll(/<c[^>]*?(?: t="([^"]*)")?[^>]*>(?:[\s\S]*?<v>([^<]*)<\/v>)?[\s\S]*?<\/c>/g)) {
        const type = cellMatch[1];
        const value = cellMatch[2] ?? "";
        cells.push(type === "s" ? (sharedStrings[parseInt(value, 10)] ?? value) : value);
      }
      if (cells.length > 0) rows.push(cells);
    }
  }
  if (rows.length === 0) return undefined;
  return rows.map((r) => r.join(",")).join("\n");
}

function formatDriveItem(item: DriveItem): string {
  const type = item.folder ? `📁 Folder (${item.folder.childCount} items)` : `📄 ${item.file?.mimeType ?? "file"}`;
  const size = item.size ? ` — ${formatSize(item.size)}` : "";
  return [
    `[${item.id}] ${item.name}`,
    `  Type: ${type}${size}`,
    ...(item.lastModifiedDateTime ? [`  Modified: ${item.lastModifiedDateTime}`] : []),
    ...(item.webUrl ? [`  URL: ${item.webUrl}`] : []),
  ].join("\n");
}

/** Extract a OneDrive/SharePoint item ID from a URL or accept a raw ID. */
function extractItemId(urlOrId: string): { type: "id" | "path" | "url"; value: string } {
  // Raw ID (no slashes, no dots in front)
  if (/^[A-Za-z0-9!_-]+$/.test(urlOrId) && urlOrId.length > 10) {
    return { type: "id", value: urlOrId };
  }
  // Path-like: /Documents/file.docx
  if (urlOrId.startsWith("/")) {
    return { type: "path", value: urlOrId };
  }
  // URL
  return { type: "url", value: urlOrId };
}

/** Search files in OneDrive by name or content. */
export async function searchFiles(
  token: string,
  query: string,
  maxResults: number,
): Promise<string> {
  if (!query || query.trim().length === 0) {
    throw new Error("search constraint 'query' must not be empty");
  }
  let url: string;
  if (query === "*") {
    // The Graph API blocks '*' in search queries, so we list the root directory instead
    url = `${BASE}/root/children?$top=${maxResults}&$select=id,name,size,webUrl,file,folder,lastModifiedDateTime,createdBy`;
  } else {
    url = `${BASE}/root/search(q='${encodeURIComponent(query)}')?$top=${maxResults}&$select=id,name,size,webUrl,file,folder,lastModifiedDateTime,createdBy`;
  }

  const result = (await microsoftFetch(url, token)) as SearchResponse;

  if (!result.value || result.value.length === 0) {
    return `No files found for "${query}".`;
  }

  const lines = result.value.map(formatDriveItem);
  return `Found ${result.value.length} item(s):\n\n${lines.join("\n\n")}`;
}

/** Read/download a OneDrive file. Returns text content for known text types. */
export async function readFile(
  token: string,
  fileUrlOrId: string,
): Promise<{ text: string; dataUrl?: string; mime: string }> {
  const ref = extractItemId(fileUrlOrId);

  let itemUrl: string;
  if (ref.type === "id") {
    itemUrl = `${BASE}/items/${encodeURIComponent(ref.value)}`;
  } else if (ref.type === "path") {
    itemUrl = `${BASE}/root:${encodeURI(ref.value)}`;
  } else {
    // For share links, use the shares API
    const encodedUrl = Buffer.from(ref.value).toString("base64")
      .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    itemUrl = `https://graph.microsoft.com/v1.0/shares/u!${encodedUrl}/driveItem`;
  }

  // Get metadata (without $select to include @microsoft.graph.downloadUrl)
  const meta = (await microsoftFetch(itemUrl, token)) as DriveItem & {
    "@microsoft.graph.downloadUrl"?: string;
  };

  if (meta.folder) {
    return { text: `"${meta.name}" is a folder, not a file. Use microsoft-onedrive-search to browse its contents.`, mime: "text/plain" };
  }

  const mimeType = meta.file?.mimeType ?? "application/octet-stream";
  const name = meta.name;
  const downloadUrl = meta["@microsoft.graph.downloadUrl"];

  // Helper to download the file content as a Buffer
  async function downloadContent(): Promise<Buffer | null> {
    // Prefer the pre-authenticated downloadUrl (no auth header needed)
    if (downloadUrl) {
      const response = await fetch(downloadUrl);
      if (response.ok) return Buffer.from(await response.arrayBuffer());
      log.error(`[onedrive] downloadUrl fetch failed: ${response.status}`);
    }
    // Fallback to /content endpoint
    const response = await fetch(`${itemUrl}/content`, {
      headers: { Authorization: `Bearer ${token}` },
      redirect: "follow",
    });
    if (response.ok) return Buffer.from(await response.arrayBuffer());
    log.error(`[onedrive] /content fetch failed: ${response.status}`);
    return null;
  }

  // Text files: download and decode
  const TEXT_MIMES = new Set(["text/plain", "text/csv", "text/html", "text/markdown", "application/json", "application/xml", "text/xml"]);
  const ext = name.includes(".") ? name.slice(name.lastIndexOf(".")).toLowerCase() : "";
  const TEXT_EXTS = new Set([".txt", ".csv", ".json", ".xml", ".html", ".md", ".yml", ".yaml", ".js", ".ts", ".py", ".sql", ".sh", ".log"]);

  if (TEXT_MIMES.has(mimeType) || TEXT_EXTS.has(ext)) {
    const buffer = await downloadContent();
    if (buffer) {
      const text = buffer.toString("utf-8");
      return { text: `File: ${name}\n\n${text}`, mime: mimeType };
    }
  }

  // Images
  const IMAGE_MIMES = new Set(["image/png", "image/jpeg", "image/gif", "image/webp"]);
  if (IMAGE_MIMES.has(mimeType)) {
    const buffer = await downloadContent();
    if (buffer) {
      return {
        text: `Image: ${name} (${mimeType}, ${formatSize(buffer.length)})`,
        dataUrl: `data:${mimeType};base64,${buffer.toString("base64")}`,
        mime: mimeType,
      };
    }
  }

  // PDFs — extract text with pdf-parse
  if (mimeType === "application/pdf") {
    const buffer = await downloadContent();
    if (buffer) {
      const parser = new PDFParse({ data: new Uint8Array(buffer) });
      try {
        const result = await parser.getText();
        const content = result.text.trim();
        return { text: `File: ${name} (PDF, ${result.total} pages)\n\n${content}`, mime: "application/pdf" };
      } catch (e) {
        log.error(`[onedrive] PDF parse failed for ${name}:`, e);
        return { text: `File: ${name} (PDF)\nFailed to extract text. Use the URL to open in browser.\nURL: ${meta.webUrl}`, mime: "application/pdf" };
      } finally {
        await parser.destroy().catch(() => {});
      }
    }
  }

  // Word documents (.docx) — extract text via ZIP/XML parsing
  const OFFICE_WORD_MIMES = new Set([
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "application/msword",
  ]);
  if (OFFICE_WORD_MIMES.has(mimeType) || ext === ".docx") {
    const buffer = await downloadContent();
    if (buffer) {
      const content = parseDocxBuffer(buffer);
      if (content) {
        return { text: `File: ${name} (Word document)\n\n${content}`, mime: "text/plain" };
      }
      log.error(`[onedrive] docx parse returned empty for ${name} (${buffer.length} bytes)`);
    }
  }

  // Excel documents (.xlsx) — extract as CSV via ZIP/XML parsing
  const OFFICE_EXCEL_MIMES = new Set([
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "application/vnd.ms-excel",
  ]);
  if (OFFICE_EXCEL_MIMES.has(mimeType) || ext === ".xlsx") {
    const buffer = await downloadContent();
    if (buffer) {
      const content = parseXlsxBuffer(buffer);
      if (content) {
        return { text: `File: ${name} (Excel spreadsheet)\n\n${content}`, mime: "text/csv" };
      }
      log.error(`[onedrive] xlsx parse returned empty for ${name} (${buffer.length} bytes)`);
    }
  }

  return { text: `File: ${name} (${mimeType}, ${formatSize(meta.size ?? 0)})\nURL: ${meta.webUrl}\n\nBinary file — cannot display content. Use the URL to open in browser.`, mime: mimeType };
}
