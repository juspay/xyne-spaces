/**
 * Gmail API helpers.
 */

import { PDFParse } from "pdf-parse";
import { googleFetch } from "./oauth.js";

const BASE = "https://gmail.googleapis.com/gmail/v1/users/me";

interface GmailHeader {
  name: string;
  value: string;
}

interface GmailPart {
  mimeType: string;
  filename?: string;
  headers?: GmailHeader[];
  body?: { data?: string; size?: number; attachmentId?: string };
  parts?: GmailPart[];
}

interface AttachmentInfo {
  filename: string;
  mimeType: string;
  size: number;
  attachmentId: string;
}

interface GmailMessage {
  id: string;
  threadId: string;
  labelIds?: string[];
  snippet: string;
  payload?: {
    headers?: GmailHeader[];
    mimeType: string;
    body?: { data?: string; size?: number };
    parts?: GmailPart[];
  };
  internalDate?: string;
}

interface GmailListResponse {
  messages?: Array<{ id: string; threadId: string }>;
  resultSizeEstimate?: number;
  nextPageToken?: string;
}

function getHeader(headers: GmailHeader[] | undefined, name: string): string {
  return headers?.find((h) => h.name.toLowerCase() === name.toLowerCase())?.value ?? "";
}

function decodeBase64Url(data: string): string {
  return Buffer.from(data, "base64url").toString("utf-8");
}

/** Collect attachment info from the MIME tree. */
function collectAttachments(part: GmailPart): AttachmentInfo[] {
  const results: AttachmentInfo[] = [];
  if (part.filename && part.body?.attachmentId) {
    results.push({
      filename: part.filename,
      mimeType: part.mimeType,
      size: part.body.size ?? 0,
      attachmentId: part.body.attachmentId,
    });
  }
  if (part.parts) {
    for (const p of part.parts) {
      results.push(...collectAttachments(p));
    }
  }
  return results;
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** Extract plain text body from a message, walking multipart structure. */
function extractBody(part: GmailPart): string {
  if (part.mimeType === "text/plain" && part.body?.data) {
    return decodeBase64Url(part.body.data);
  }
  if (part.parts) {
    for (const p of part.parts) {
      const text = extractBody(p);
      if (text) return text;
    }
  }
  // Fallback to HTML if no plain text
  if (part.mimeType === "text/html" && part.body?.data) {
    const html = decodeBase64Url(part.body.data);
    return html.replace(/<[^>]+>/g, "").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim();
  }
  return "";
}

export async function searchEmails(
  token: string,
  query: string,
  maxResults: number,
): Promise<string> {
  const params = new URLSearchParams({ q: query, maxResults: String(maxResults) });
  const list = (await googleFetch(`${BASE}/messages?${params}`, token)) as GmailListResponse;

  if (!list.messages || list.messages.length === 0) {
    return "No emails found matching the query.";
  }

  const results: string[] = [];
  for (const msg of list.messages.slice(0, maxResults)) {
    const full = (await googleFetch(
      `${BASE}/messages/${msg.id}?format=metadata&metadataHeaders=Subject&metadataHeaders=From&metadataHeaders=To&metadataHeaders=Date&metadataHeaders=Content-Type`,
      token,
    )) as GmailMessage;

    const subject = getHeader(full.payload?.headers, "Subject") || "(no subject)";
    const from = getHeader(full.payload?.headers, "From");
    const date = getHeader(full.payload?.headers, "Date");
    const snippet = full.snippet;
    const hasAttachment = full.labelIds?.includes("ATTACHMENT") || full.payload?.mimeType?.startsWith("multipart/mixed");
    const attachTag = hasAttachment ? " 📎" : "";

    results.push(`[${msg.id}] ${date}${attachTag}\n  From: ${from}\n  Subject: ${subject}\n  ${snippet}`);
  }

  return `Found ${list.resultSizeEstimate ?? list.messages.length} emails (showing ${results.length}):\n\n${results.join("\n\n")}`;
}

export async function readEmail(token: string, messageId: string): Promise<string> {
  const msg = (await googleFetch(
    `${BASE}/messages/${messageId}?format=full`,
    token,
  )) as GmailMessage;

  const headers = msg.payload?.headers;
  const subject = getHeader(headers, "Subject") || "(no subject)";
  const from = getHeader(headers, "From");
  const to = getHeader(headers, "To");
  const cc = getHeader(headers, "Cc");
  const date = getHeader(headers, "Date");
  const labels = msg.labelIds?.join(", ") ?? "";

  let body = "";
  const attachments: AttachmentInfo[] = [];
  if (msg.payload) {
    body = extractBody(msg.payload as GmailPart);
    attachments.push(...collectAttachments(msg.payload as GmailPart));
  }

  if (body.length > 8000) {
    body = body.slice(0, 8000) + "\n\n... (truncated)";
  }

  const parts = [
    `ID: ${msg.id}`,
    `Thread: ${msg.threadId}`,
    `Date: ${date}`,
    `From: ${from}`,
    `To: ${to}`,
    ...(cc ? [`Cc: ${cc}`] : []),
    `Subject: ${subject}`,
    ...(labels ? [`Labels: ${labels}`] : []),
    ...(attachments.length > 0 ? [
      `\nAttachments (${attachments.length}):`,
      ...attachments.map((a) => `  - ${a.filename} (${a.mimeType}, ${formatSize(a.size)}) [attachmentId: ${a.attachmentId}]`),
    ] : []),
    `\n${body}`,
  ];

  return parts.join("\n");
}

const TEXT_EXTENSIONS = new Set([
  ".txt", ".csv", ".json", ".xml", ".html", ".htm", ".md",
  ".yml", ".yaml", ".toml", ".ini", ".cfg", ".log",
  ".js", ".ts", ".py", ".rb", ".go", ".java", ".c", ".h",
  ".css", ".scss", ".sql", ".sh", ".bash", ".env",
  ".ics", ".vcf", ".eml", ".svg",
]);

const IMAGE_MIMES = new Set([
  "image/png", "image/jpeg", "image/gif", "image/webp",
]);

/** Download an attachment. Returns text content for text files, data URL for visual files. */
export async function getAttachment(
  token: string,
  messageId: string,
  attachmentId: string,
  filename: string,
  mimeType: string,
): Promise<{ text: string; dataUrl?: string; mime: string }> {
  const data = (await googleFetch(
    `${BASE}/messages/${messageId}/attachments/${attachmentId}`,
    token,
  )) as { data: string; size: number };

  const ext = filename.includes(".") ? `.${filename.split(".").pop()!.toLowerCase()}` : "";
  const buffer = Buffer.from(data.data, "base64url");

  // Text-based files
  if (TEXT_EXTENSIONS.has(ext) || mimeType.startsWith("text/")) {
    let content = buffer.toString("utf-8");
    if (content.length > 15000) {
      content = content.slice(0, 15000) + "\n\n... (truncated)";
    }
    return {
      text: `File: ${filename} (${mimeType}, ${formatSize(data.size)})\n\n${content}`,
      mime: mimeType,
    };
  }

  // PDFs — extract text with pdf-parse
  if (mimeType === "application/pdf") {
    const parser = new PDFParse({ data: new Uint8Array(buffer) });
    try {
      const result = await parser.getText();
      let content = result.text.trim();
      if (content.length > 15000) {
        content = content.slice(0, 15000) + "\n\n... (truncated)";
      }
      return {
        text: `File: ${filename} (PDF, ${formatSize(data.size)}, ${result.total} pages)\n\n${content}`,
        mime: mimeType,
      };
    } catch {
      return {
        text: `File: ${filename} (PDF, ${formatSize(data.size)})\nFailed to extract text from PDF. The user can open this PDF directly.`,
        mime: mimeType,
      };
    } finally {
      await parser.destroy().catch(() => {});
    }
  }

  // Images: return data URL as attachment for multimodal models
  if (IMAGE_MIMES.has(mimeType)) {
    const base64 = data.data.replace(/-/g, "+").replace(/_/g, "/");
    return {
      text: `Attachment: ${filename} (${mimeType}, ${formatSize(data.size)})`,
      dataUrl: `data:${mimeType};base64,${base64}`,
      mime: mimeType,
    };
  }

  // Other binary files
  return {
    text: `File: ${filename} (${mimeType}, ${formatSize(data.size)})\nBinary file — cannot be displayed as text.`,
    mime: mimeType,
  };
}

export async function createDraft(
  token: string,
  to: string,
  subject: string,
  body: string,
  cc?: string,
  inReplyTo?: string,
  threadId?: string,
): Promise<string> {
  const lines = [
    `To: ${to}`,
    ...(cc ? [`Cc: ${cc}`] : []),
    `Subject: ${subject}`,
    ...(inReplyTo ? [`In-Reply-To: ${inReplyTo}`, `References: ${inReplyTo}`] : []),
    "Content-Type: text/plain; charset=utf-8",
    "",
    body,
  ];
  const raw = Buffer.from(lines.join("\r\n")).toString("base64url");

  const result = (await googleFetch(`${BASE}/drafts`, token, {
    method: "POST",
    body: JSON.stringify({
      message: {
        raw,
        ...(threadId ? { threadId } : {}),
      },
    }),
  })) as { id: string; message: { id: string; threadId: string } };

  return `Draft created successfully.\nDraft ID: ${result.id}\nMessage ID: ${result.message.id}\nThread ID: ${result.message.threadId}`;
}

export async function trashEmail(
  token: string,
  messageId: string,
): Promise<string> {
  await googleFetch(`${BASE}/messages/${messageId}/trash`, token, {
    method: "POST",
  });

  return `Email ${messageId} moved to trash.`;
}
