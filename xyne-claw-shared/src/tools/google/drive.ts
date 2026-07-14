/**
 * Google Drive API helpers — read/export files.
 */

import { PDFParse } from "pdf-parse";
import { googleFetch } from "./oauth.js";
import { type CitedText, inlineCitationToken, externalCitation, driveFileUrl } from "./citations.js";
import { xlsxToText } from "./office.js";
import type { Citation } from "../../types/citation.js";

const BASE = "https://www.googleapis.com/drive/v3";
const MAX_DRIVE_UPLOAD_BYTES = 1_000_000; // 1MB text payload guardrail
const MAX_DRIVE_SEARCH_RESULTS = 50;

interface DriveFile {
  id: string;
  name: string;
  mimeType: string;
  size?: string;
  modifiedTime?: string;
  webViewLink?: string;
  owners?: Array<{ displayName?: string; emailAddress?: string }>;
}

interface DriveListResponse {
  files?: DriveFile[];
}

const EXPORT_MAP: Record<string, { mime: string; ext: string }> = {
  "application/vnd.google-apps.spreadsheet": { mime: "text/csv", ext: "csv" },
  "application/vnd.google-apps.document": { mime: "text/plain", ext: "txt" },
  "application/vnd.google-apps.presentation": { mime: "text/plain", ext: "txt" },
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": { mime: "text/csv", ext: "csv" },
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": { mime: "text/plain", ext: "txt" },
};

function valuesToCsv(rows: string[][]): string {
  return rows.map((row) => row.map((cell) => cell.includes(",") || cell.includes("\n") ? `"${cell.replace(/"/g, '""')}"` : cell).join(",")).join("\n");
}

/** Extract a Google Drive/Sheets/Docs file ID from a URL. */
function extractFileId(urlOrId: string): string {
  if (/^[a-zA-Z0-9_-]{20,}$/.test(urlOrId)) return urlOrId;

  const match = urlOrId.match(/\/d\/([a-zA-Z0-9_-]+)/);
  if (match) return match[1]!;

  const urlMatch = urlOrId.match(/[?&]id=([a-zA-Z0-9_-]+)/);
  if (urlMatch) return urlMatch[1]!;

  return urlOrId;
}

/** Extract the tab/sheet gid from a Google Sheets URL (#gid=, ?gid=, &gid=). */
function extractGid(urlOrId: string): string | undefined {
  const m = urlOrId.match(/[#?&]gid=(\d+)/);
  return m ? m[1] : undefined;
}

export interface ReadDriveOptions {
  /** Target a specific tab by its gid (from the sheet URL's #gid=). */
  gid?: string | undefined;
  /** Target a specific tab by its title (case-insensitive). */
  tab?: string | undefined;
  /** A1 range within the targeted tab, e.g. "A1:Z" or "A500:Z1000". */
  range?: string | undefined;
  /** Max rows to return per tab before windowing (default 5000). */
  maxRows?: number | undefined;
}

const DEFAULT_MAX_SHEET_ROWS = 5000;
const MAX_SHEET_OUTPUT_CHARS = 100000;

/**
 * Coerce a raw Sheets API values row (numbers/booleans → strings) AND pad every
 * row to the widest row's column count. The values API omits trailing empty
 * cells, so rows arrive ragged; without padding, columns misalign down the sheet
 * and a "column E of the Acme row" question is answered from the wrong cell.
 */
function coerceRows(rows: unknown[][]): string[][] {
  const coerced = rows.map((row) => row.map((cell) => (cell == null ? "" : String(cell))));
  const width = coerced.reduce((max, row) => Math.max(max, row.length), 0);
  for (const row of coerced) {
    while (row.length < width) row.push("");
  }
  return coerced;
}

/**
 * Read a Google Sheets spreadsheet via the Sheets values API.
 * Honors a target tab (gid or title) and an A1 range, and windows large tabs
 * by row count instead of blindly slicing the top of the concatenated text.
 */
async function readSpreadsheet(
  token: string,
  fileId: string,
  meta: DriveFile,
  opts: ReadDriveOptions,
): Promise<{ text: string; mime: string }> {
  // 1) List tabs.
  const sheetsData = (await googleFetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${fileId}?includeGridData=false`,
    token,
  )) as { sheets?: Array<{ properties: { sheetId: number; title: string } }> };
  const allSheets = sheetsData.sheets ?? [];
  if (allSheets.length === 0) throw new Error("No sheets returned by Sheets API");

  // 2) Resolve the target tab. gid wins over tab name; otherwise read every tab.
  let targets = allSheets;
  let targetNote = "";
  if (opts.gid != null) {
    const match = allSheets.find((s) => String(s.properties.sheetId) === String(opts.gid));
    if (match) {
      targets = [match];
    } else {
      targetNote = `\n(Note: no tab with gid=${opts.gid} found; reading all tabs. Available: ${allSheets
        .map((s) => `${s.properties.title} [gid=${s.properties.sheetId}]`)
        .join(", ")})`;
    }
  } else if (opts.tab) {
    const match = allSheets.find((s) => s.properties.title.toLowerCase() === opts.tab!.toLowerCase());
    if (match) {
      targets = [match];
    } else {
      targetNote = `\n(Note: no tab named "${opts.tab}" found; reading all tabs. Available: ${allSheets
        .map((s) => s.properties.title)
        .join(", ")})`;
    }
  }

  const maxRows = opts.maxRows && opts.maxRows > 0 ? opts.maxRows : DEFAULT_MAX_SHEET_ROWS;
  const parts: string[] = [];

  for (const sheet of targets) {
    const title = sheet.properties.title;
    const a1 = opts.range && opts.range.trim() ? `'${title}'!${opts.range.trim()}` : `'${title}'`;
    const valuesData = (await googleFetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${fileId}/values/${encodeURIComponent(a1)}?majorDimension=ROWS`,
      token,
    )) as { values?: unknown[][] };
    let rows = coerceRows(valuesData.values ?? []);
    const total = rows.length;
    let footer = "";
    if (rows.length > maxRows) {
      rows = rows.slice(0, maxRows);
      footer = `\n... (showing first ${maxRows} of ${total} rows; pass range like "A${maxRows + 1}:Z" or a larger maxRows to read more)`;
    }
    const body = rows.length > 0 ? valuesToCsv(rows) : "(empty)";
    parts.push(`--- Sheet: ${title} (gid=${sheet.properties.sheetId}, ${total} row(s)) ---\n${body}${footer}`);
  }

  let content = parts.join("\n\n") + targetNote;
  if (content.length > MAX_SHEET_OUTPUT_CHARS) {
    content = content.slice(0, MAX_SHEET_OUTPUT_CHARS) + "\n\n... (output truncated; narrow the range or tab)";
  }
  return { text: `File: ${meta.name} (read via Sheets API)\n\n${content}`, mime: "text/csv" };
}

async function getFileMetadata(token: string, fileId: string): Promise<DriveFile> {
  return (await googleFetch(
    `${BASE}/files/${encodeURIComponent(fileId)}?fields=id,name,mimeType,size`,
    token,
  )) as DriveFile;
}

function detectWorkspaceType(url: string): string | undefined {
  if (url.includes("spreadsheets/d/")) return "application/vnd.google-apps.spreadsheet";
  if (url.includes("document/d/")) return "application/vnd.google-apps.document";
  if (url.includes("presentation/d/")) return "application/vnd.google-apps.presentation";
  return undefined;
}

/** Read/export a Google Drive file and return its text content. */
export async function readDriveFile(
  token: string,
  urlOrId: string,
  opts: ReadDriveOptions = {},
): Promise<{ text: string; dataUrl?: string; mime: string }> {
  const fileId = extractFileId(urlOrId);
  const gid = opts.gid ?? extractGid(urlOrId);
  const meta = await getFileMetadata(token, fileId);

  const detectedType = detectWorkspaceType(urlOrId);
  const effectiveMime = detectedType ?? meta.mimeType;
  const exportInfo = EXPORT_MAP[effectiveMime];

  if (exportInfo) {
    // Google Sheets / xlsx: try multiple strategies
    if (detectedType === "application/vnd.google-apps.spreadsheet" || effectiveMime.includes("spreadsheet")) {
      // Preferred: read via the Sheets values API, honoring the target tab (gid/name) and range.
      try {
        return await readSpreadsheet(token, fileId, meta, { ...opts, gid });
      } catch {
        // Sheets API path failed (e.g. an .xlsx blob that is not a native Google Sheet).
      }

      // Fallback: download the raw xlsx and parse it locally.
      try {
        const dlUrl = `${BASE}/files/${encodeURIComponent(fileId)}?alt=media`;
        const dlResponse = await fetch(dlUrl, { headers: { Authorization: `Bearer ${token}` } });
        if (dlResponse.ok) {
          const buffer = Buffer.from(await dlResponse.arrayBuffer());
          const content = xlsxToText(buffer);
          if (content) {
            const truncated = content.length > MAX_SHEET_OUTPUT_CHARS ? content.slice(0, MAX_SHEET_OUTPUT_CHARS) + "\n\n... (truncated)" : content;
            return { text: `File: ${meta.name} (xlsx)\n\n${truncated}`, mime: "text/csv" };
          }
        }
      } catch {
        // All strategies failed
      }

      return { text: `File: ${meta.name} — could not read this spreadsheet. It may need to be converted to Google Sheets format.`, mime: "text/plain" };
    }

    // Docs / other exportable Workspace files
    let exportUrl: string;
    if (detectedType === "application/vnd.google-apps.document" || effectiveMime.includes("wordprocessing")) {
      exportUrl = `https://docs.google.com/document/d/${fileId}/export?format=txt`;
    } else {
      exportUrl = `${BASE}/files/${encodeURIComponent(fileId)}/export?mimeType=${encodeURIComponent(exportInfo.mime)}`;
    }

    const response = await fetch(exportUrl, {
      headers: { Authorization: `Bearer ${token}` },
      redirect: "follow",
    });
    if (!response.ok) {
      const err = await response.text();
      throw new Error(`Drive export failed: ${response.status} ${err}`);
    }
    const content = await response.text();
    return {
      text: `File: ${meta.name} (exported as ${exportInfo.ext})\n\n${content}`,
      mime: exportInfo.mime,
    };
  }

  // Regular file — download content
  const url = `${BASE}/files/${encodeURIComponent(fileId)}?alt=media`;
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Drive download failed: ${response.status} ${err}`);
  }

  const buffer = Buffer.from(await response.arrayBuffer());

  // Text-based files
  if (meta.mimeType.startsWith("text/") || meta.mimeType === "application/json") {
    const content = buffer.toString("utf-8");
    return { text: `File: ${meta.name}\n\n${content}`, mime: meta.mimeType };
  }

  // PDFs — extract text with pdf-parse
  if (meta.mimeType === "application/pdf") {
    const parser = new PDFParse({ data: new Uint8Array(buffer) });
    try {
      const result = await parser.getText();
      const content = result.text.trim();
      return {
        text: `File: ${meta.name} (PDF, ${result.total} pages)\n\n${content}`,
        mime: "application/pdf",
      };
    } catch {
      return {
        text: `File: ${meta.name} (PDF)\nFailed to extract text from PDF. The user can open this PDF directly.`,
        mime: "application/pdf",
      };
    } finally {
      await parser.destroy().catch(() => {});
    }
  }

  // Images — attach for multimodal
  if (meta.mimeType.startsWith("image/")) {
    const base64 = buffer.toString("base64");
    return {
      text: `File: ${meta.name} (${meta.mimeType})`,
      dataUrl: `data:${meta.mimeType};base64,${base64}`,
      mime: meta.mimeType,
    };
  }

  // Other binary
  const sizeStr = meta.size ? `${(Number(meta.size) / 1024).toFixed(1)} KB` : "unknown size";
  return {
    text: `File: ${meta.name} (${meta.mimeType}, ${sizeStr})\nBinary file — cannot be displayed as text.`,
    mime: meta.mimeType,
  };
}

/** Search files in Google Drive. */
export async function searchDriveFiles(
  token: string,
  query: string,
  maxResults: number,
): Promise<CitedText> {
  const cappedResults = Math.min(Math.max(maxResults, 1), MAX_DRIVE_SEARCH_RESULTS);
  const looksLikeRawQuery =
    /\b(name|fullText|mimeType|modifiedTime|parents|trashed)\b/.test(query) ||
    query.includes(" and ") ||
    query.includes(" or ");
  const escaped = query.replace(/'/g, "\\'");
  const q = looksLikeRawQuery ? query : `name contains '${escaped}' or fullText contains '${escaped}'`;
  const url = new URL(`${BASE}/files`);
  url.searchParams.set("q", `${q} and trashed = false`);
  url.searchParams.set("fields", "files(id,name,mimeType,size,modifiedTime,webViewLink,owners(displayName,emailAddress))");
  url.searchParams.set("pageSize", String(cappedResults));
  url.searchParams.set("orderBy", "modifiedTime desc");

  const data = (await googleFetch(url.toString(), token)) as DriveListResponse;
  const files = data.files ?? [];

  if (files.length === 0) return { text: `No files found for "${query}".` };

  const citations: Citation[] = [];
  const lines = files.map((f, i) => {
    const idx = i + 1;
    const size = f.size ? ` (${(Number(f.size) / 1024).toFixed(1)} KB)` : "";
    const c = externalCitation({ app: "gdrive", url: driveFileUrl(f.id, f.mimeType), chunkIndex: idx, label: f.name });
    if (c) citations.push(c);
    const detail: string[] = [`  Type: ${f.mimeType}`, `  ID: ${f.id}`];
    if (f.modifiedTime) detail.push(`  Modified: ${f.modifiedTime.slice(0, 10)}`);
    const owner = f.owners?.[0];
    if (owner?.displayName || owner?.emailAddress) {
      detail.push(`  Owner: ${owner.displayName ?? owner.emailAddress}${owner.emailAddress && owner.displayName ? ` <${owner.emailAddress}>` : ""}`);
    }
    return `${inlineCitationToken(idx)} - ${f.name}${size}\n${detail.join("\n")}`;
  });
  return { text: `Found ${files.length} file(s):\n\n${lines.join("\n\n")}`, citations };
}

// ── Drive write helpers ──────────────────────────────────────────────

/** Create a folder in Drive (optionally inside a parent folder). */
export async function createDriveFolder(
  token: string,
  name: string,
  parentId?: string,
): Promise<string> {
  if (!name.trim()) throw new Error("Folder name cannot be empty");
  const body: Record<string, unknown> = { name, mimeType: "application/vnd.google-apps.folder" };
  if (parentId) body.parents = [parentId];
  const created = (await googleFetch(`${BASE}/files?fields=id,name,webViewLink`, token, {
    method: "POST",
    body: JSON.stringify(body),
  })) as { id: string; name: string; webViewLink?: string };
  return [
    `Folder created: ${created.name}`,
    `Folder ID: ${created.id}`,
    `URL: ${created.webViewLink ?? `https://drive.google.com/drive/folders/${created.id}`}`,
  ].join("\n");
}

/** Upload a text/utf-8 file to Drive (optionally into a parent folder). */
export async function uploadDriveFile(
  token: string,
  name: string,
  content: string,
  mimeType: string,
  parentId?: string,
): Promise<string> {
  if (!name.trim()) throw new Error("File name cannot be empty");
  if (!mimeType.trim()) throw new Error("mimeType is required");
  if (Buffer.byteLength(content, "utf8") > MAX_DRIVE_UPLOAD_BYTES) {
    throw new Error(`File content too large. Max ${MAX_DRIVE_UPLOAD_BYTES} bytes.`);
  }
  const metadata: Record<string, unknown> = { name, mimeType };
  if (parentId) metadata.parents = [parentId];

  const boundary = `boundary_${Date.now().toString(16)}`;
  const multipart =
    `--${boundary}\r\n` +
    `Content-Type: application/json; charset=UTF-8\r\n\r\n` +
    `${JSON.stringify(metadata)}\r\n` +
    `--${boundary}\r\n` +
    `Content-Type: ${mimeType}\r\n\r\n` +
    `${content}\r\n` +
    `--${boundary}--`;

  const res = await fetch(
    `https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,webViewLink`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": `multipart/related; boundary=${boundary}`,
      },
      body: multipart,
    },
  );
  if (!res.ok) throw new Error(`Drive upload ${res.status}: ${await res.text()}`);
  const created = (await res.json()) as { id: string; name: string; webViewLink?: string };
  return [
    `File uploaded: ${created.name}`,
    `File ID: ${created.id}`,
    `URL: ${created.webViewLink ?? `https://drive.google.com/file/d/${created.id}/view`}`,
  ].join("\n");
}

/** Share a Drive file. role: reader|commenter|writer; type: user|group|domain|anyone. */
export async function shareDriveFile(
  token: string,
  fileId: string,
  role: "reader" | "commenter" | "writer",
  type: "user" | "group" | "domain" | "anyone",
  emailAddress?: string,
): Promise<string> {
  const body: Record<string, unknown> = { role, type };
  if (emailAddress) body.emailAddress = emailAddress;
  await googleFetch(`${BASE}/files/${encodeURIComponent(fileId)}/permissions?sendNotificationEmail=false`, token, {
    method: "POST",
    body: JSON.stringify(body),
  });
  const target = emailAddress ?? type;
  return `Granted ${role} access on ${fileId} to ${target}`;
}
