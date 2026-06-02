/**
 * Google Drive API helpers — read/export files.
 */

import { inflateRawSync } from "zlib";
import { PDFParse } from "pdf-parse";
import { googleFetch } from "./oauth.js";

const BASE = "https://www.googleapis.com/drive/v3";
const MAX_DRIVE_UPLOAD_BYTES = 1_000_000; // 1MB text payload guardrail
const MAX_DRIVE_SEARCH_RESULTS = 50;

// ── Minimal ZIP + XLSX parser ────────────────────────────────────────

/** Extract a file from a ZIP buffer by filename. */
function zipExtract(zip: Buffer, target: string): Buffer | undefined {
  let offset = 0;
  while (offset < zip.length - 4) {
    if (zip[offset] !== 0x50 || zip[offset + 1] !== 0x4b || zip[offset + 2] !== 0x03 || zip[offset + 3] !== 0x04) break;

    const method = zip.readUInt16LE(offset + 8);
    const compressedSize = zip.readUInt32LE(offset + 18);
    const nameLen = zip.readUInt16LE(offset + 26);
    const extraLen = zip.readUInt16LE(offset + 28);
    const name = zip.subarray(offset + 30, offset + 30 + nameLen).toString("utf-8");
    const dataStart = offset + 30 + nameLen + extraLen;

    if (name === target) {
      const data = zip.subarray(dataStart, dataStart + compressedSize);
      if (method === 0) return data; // stored
      if (method === 8) return inflateRawSync(data); // deflate
      return undefined;
    }

    offset = dataStart + compressedSize;
  }
  return undefined;
}

/** Parse an xlsx buffer and return CSV-like text. */
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
        if (type === "s") {
          const idx = parseInt(value, 10);
          cells.push(sharedStrings[idx] ?? value);
        } else {
          cells.push(value);
        }
      }
      if (cells.length > 0) rows.push(cells);
    }
  }

  if (rows.length === 0) return undefined;
  return rows.map((r) => r.join(",")).join("\n");
}

interface DriveFile {
  id: string;
  name: string;
  mimeType: string;
  size?: string;
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
): Promise<{ text: string; dataUrl?: string; mime: string }> {
  const fileId = extractFileId(urlOrId);
  const meta = await getFileMetadata(token, fileId);

  const detectedType = detectWorkspaceType(urlOrId);
  const effectiveMime = detectedType ?? meta.mimeType;
  const exportInfo = EXPORT_MAP[effectiveMime];

  if (exportInfo) {
    // Google Sheets / xlsx: try multiple strategies
    if (detectedType === "application/vnd.google-apps.spreadsheet" || effectiveMime.includes("spreadsheet")) {
      // Strategy 1: Get sheet metadata + CSV export per sheet
      try {
        const sheetsApiUrl = `https://sheets.googleapis.com/v4/spreadsheets/${fileId}?includeGridData=false`;
        const sheetsData = (await googleFetch(sheetsApiUrl, token)) as {
          sheets?: Array<{ properties: { sheetId: number; title: string } }>;
        };
        const sheets = sheetsData.sheets ?? [];
        const parts: string[] = [];

        for (const sheet of sheets) {
          const sheetName = sheet.properties.title;
          const exportUrl = `https://docs.google.com/spreadsheets/d/${fileId}/export?format=csv&gid=${sheet.properties.sheetId}`;
          const response = await fetch(exportUrl, {
            headers: { Authorization: `Bearer ${token}` },
            redirect: "follow",
          });
          if (response.ok) {
            parts.push(`--- Sheet: ${sheetName} ---\n${await response.text()}`);
          } else {
            const valuesData = (await googleFetch(
              `https://sheets.googleapis.com/v4/spreadsheets/${fileId}/values/${encodeURIComponent(`'${sheetName}'`)}`,
              token,
            )) as { values?: string[][] };
            const rows = valuesData.values ?? [];
            parts.push(`--- Sheet: ${sheetName} ---\n${rows.length > 0 ? valuesToCsv(rows) : "(empty)"}`);
          }
        }

        let content = parts.join("\n\n");
        if (content.length > 20000) content = content.slice(0, 20000) + "\n\n... (truncated)";
        return { text: `File: ${meta.name} (exported as csv)\n\n${content}`, mime: "text/csv" };
      } catch {
        // Strategy 1 failed
      }

      // Strategy 2: Direct Sheets API values
      try {
        const valuesData = (await googleFetch(
          `https://sheets.googleapis.com/v4/spreadsheets/${fileId}/values/A1:ZZ10000`,
          token,
        )) as { values?: string[][] };
        const rows = valuesData.values ?? [];
        if (rows.length > 0) {
          let content = valuesToCsv(rows);
          if (content.length > 20000) content = content.slice(0, 20000) + "\n\n... (truncated)";
          return { text: `File: ${meta.name} (read via Sheets API)\n\n${content}`, mime: "text/csv" };
        }
      } catch {
        // Strategy 2 failed
      }

      // Strategy 3: Download raw xlsx and parse
      try {
        const dlUrl = `${BASE}/files/${encodeURIComponent(fileId)}?alt=media`;
        const dlResponse = await fetch(dlUrl, { headers: { Authorization: `Bearer ${token}` } });
        if (dlResponse.ok) {
          const buffer = Buffer.from(await dlResponse.arrayBuffer());
          const content = parseXlsxBuffer(buffer);
          if (content) {
            const truncated = content.length > 20000 ? content.slice(0, 20000) + "\n\n... (truncated)" : content;
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
    let content = await response.text();
    if (content.length > 20000) {
      content = content.slice(0, 20000) + "\n\n... (truncated)";
    }
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
    let content = buffer.toString("utf-8");
    if (content.length > 20000) {
      content = content.slice(0, 20000) + "\n\n... (truncated)";
    }
    return { text: `File: ${meta.name}\n\n${content}`, mime: meta.mimeType };
  }

  // PDFs — extract text with pdf-parse
  if (meta.mimeType === "application/pdf") {
    const parser = new PDFParse({ data: new Uint8Array(buffer) });
    try {
      const result = await parser.getText();
      let content = result.text.trim();
      if (content.length > 20000) {
        content = content.slice(0, 20000) + "\n\n... (truncated)";
      }
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
): Promise<string> {
  const cappedResults = Math.min(Math.max(maxResults, 1), MAX_DRIVE_SEARCH_RESULTS);
  const looksLikeRawQuery =
    /\b(name|fullText|mimeType|modifiedTime|parents|trashed)\b/.test(query) ||
    query.includes(" and ") ||
    query.includes(" or ");
  const escaped = query.replace(/'/g, "\\'");
  const q = looksLikeRawQuery ? query : `name contains '${escaped}' or fullText contains '${escaped}'`;
  const url = new URL(`${BASE}/files`);
  url.searchParams.set("q", `${q} and trashed = false`);
  url.searchParams.set("fields", "files(id,name,mimeType,size)");
  url.searchParams.set("pageSize", String(cappedResults));
  url.searchParams.set("orderBy", "modifiedTime desc");

  const data = (await googleFetch(url.toString(), token)) as DriveListResponse;
  const files = data.files ?? [];

  if (files.length === 0) return `No files found for "${query}".`;

  const lines = files.map((f) => {
    const size = f.size ? ` (${(Number(f.size) / 1024).toFixed(1)} KB)` : "";
    return `- ${f.name}${size}\n  Type: ${f.mimeType}\n  ID: ${f.id}`;
  });
  return `Found ${files.length} file(s):\n\n${lines.join("\n\n")}`;
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
