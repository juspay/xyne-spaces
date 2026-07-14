/**
 * Gmail API helpers.
 */

import { PDFParse } from "pdf-parse";
import { googleFetch } from "./oauth.js";
import { xlsxToText, docxToText, pptxToText } from "./office.js";
import { type CitedText, inlineCitationToken, externalCitation, gmailUrl } from "./citations.js";
import type { Citation } from "../../types/citation.js";

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

/**
 * Decode the HTML entities that show up in real email bodies: the XML5 named set
 * plus `&nbsp;` and numeric (`&#39;` / `&#x27;`) references. Unknown named
 * entities are left literal rather than mangled.
 */
function decodeHtmlEntities(s: string): string {
  return s.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (m, ent: string) => {
    switch (ent) {
      case "amp":
        return "&";
      case "lt":
        return "<";
      case "gt":
        return ">";
      case "quot":
        return '"';
      case "apos":
        return "'";
      case "nbsp":
        return " ";
      default:
        if (ent[0] === "#") {
          const code = ent[1] === "x" || ent[1] === "X" ? parseInt(ent.slice(2), 16) : parseInt(ent.slice(1), 10);
          return Number.isFinite(code) ? String.fromCodePoint(code) : m;
        }
        return m; // leave unrecognised named entities untouched
    }
  });
}

/**
 * Convert an HTML email body to readable plain text WITHOUT dropping links or
 * structure. The previous one-liner (`replace(/<[^>]+>/g,"")…`) destroyed every
 * `<a href>` URL, leaked `<style>/<script>` CSS/JS as noise, flattened all
 * `<p>/<li>/<tr>` boundaries into one run-on line, and decoded only `&nbsp;`.
 */
function htmlToText(html: string): string {
  let text = html
    // (a) remove <style>/<script> ELEMENT CONTENT (not just the tags) so their
    //     CSS/JS never leaks into the extracted body.
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, "")
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "")
    // (b) keep the href target: <a href="URL">text</a> -> "text (URL)" so reset
    //     links, unsubscribe links, etc. survive tag stripping.
    .replace(/<a\b[^>]*\bhref\s*=\s*["']([^"']*)["'][^>]*>([\s\S]*?)<\/a>/gi, (_m, url: string, inner: string) => {
      const label = inner.replace(/<[^>]+>/g, "").trim();
      const href = url.trim();
      if (!href || href.startsWith("#")) return label; // in-page anchor: no URL worth keeping
      return label && label !== href ? `${label} (${href})` : href;
    })
    // (c) turn line/block boundaries into newlines BEFORE stripping other tags
    //     so paragraphs, list items, table rows and headings stay on their own
    //     lines instead of collapsing together.
    .replace(/<br\b[^>]*\/?>/gi, "\n")
    .replace(/<\/(?:p|div|li|tr|h[1-6])\s*>/gi, "\n");

  // Strip any remaining tags, THEN decode entities (decoding first could
  // reintroduce `<`/`>` that the tag stripper would then eat).
  text = text.replace(/<[^>]+>/g, "");
  text = decodeHtmlEntities(text);

  // (e) collapse runs of spaces/tabs but PRESERVE newlines; trim per-line
  //     whitespace and squeeze 3+ blank lines to a single blank line.
  return text
    .replace(/[ \t]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
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
  // Fallback to HTML if no plain text — preserve links, structure and entities.
  if (part.mimeType === "text/html" && part.body?.data) {
    return htmlToText(decodeBase64Url(part.body.data));
  }
  return "";
}

export async function searchEmails(
  token: string,
  query: string,
  maxResults: number,
): Promise<CitedText> {
  const params = new URLSearchParams({ q: query, maxResults: String(maxResults) });
  const list = (await googleFetch(`${BASE}/messages?${params}`, token)) as GmailListResponse;

  if (!list.messages || list.messages.length === 0) {
    return { text: "No emails found matching the query." };
  }

  const results: string[] = [];
  const citations: Citation[] = [];
  let idx = 0;
  for (const msg of list.messages.slice(0, maxResults)) {
    const full = (await googleFetch(
      `${BASE}/messages/${msg.id}?format=metadata&metadataHeaders=Subject&metadataHeaders=From&metadataHeaders=To&metadataHeaders=Date&metadataHeaders=Content-Type`,
      token,
    )) as GmailMessage;

    const subject = getHeader(full.payload?.headers, "Subject") || "(no subject)";
    const from = getHeader(full.payload?.headers, "From");
    const to = getHeader(full.payload?.headers, "To");
    const date = getHeader(full.payload?.headers, "Date");
    const snippet = full.snippet;
    // There is no "ATTACHMENT" label in Gmail; the only metadata-level signal is
    // a multipart/mixed payload (mixed => at least one non-inline attachment).
    const hasAttachment = full.payload?.mimeType?.startsWith("multipart/mixed") ?? false;
    // UNREAD / STARRED live on the message resource's top-level labelIds — surface
    // them so the agent can answer "any unread mail from X?".
    const isUnread = full.labelIds?.includes("UNREAD") ?? false;
    const isStarred = full.labelIds?.includes("STARRED") ?? false;
    const flagTag =
      [isUnread ? "UNREAD" : "", isStarred ? "⭐" : "", hasAttachment ? "📎" : ""].filter(Boolean).join(" ");

    idx++;
    results.push(
      `${inlineCitationToken(idx)} [${msg.id}] ${date}${flagTag ? ` ${flagTag}` : ""}\n  From: ${from}\n  To: ${to}\n  Subject: ${subject}\n  ${snippet}`,
    );
    const c = externalCitation({ app: "gmail", url: gmailUrl(msg.id), chunkIndex: idx, label: `Gmail: ${subject}` });
    if (c) citations.push(c);
  }

  // Honest counts: `resultSizeEstimate` is Gmail's *estimate* of total matches,
  // not the number returned here. Report the returned set plainly and only note
  // the estimate/pagination when there is more than we're showing.
  const estimate = list.resultSizeEstimate;
  const more = list.nextPageToken ? "; refine the query to see the rest" : "";
  const header =
    estimate != null && estimate > results.length
      ? `Showing ${results.length} email(s) (~${estimate} match the query${more}):`
      : `Showing ${results.length} email(s):`;

  return {
    text: `${header}\n\n${results.join("\n\n")}`,
    citations,
  };
}

export async function readEmail(token: string, messageId: string): Promise<CitedText> {
  const msg = (await googleFetch(
    `${BASE}/messages/${messageId}?format=full`,
    token,
  )) as GmailMessage;

  const headers = msg.payload?.headers;
  const subject = getHeader(headers, "Subject") || "(no subject)";
  const from = getHeader(headers, "From");
  const to = getHeader(headers, "To");
  const cc = getHeader(headers, "Cc");
  // Reply-To is in format=full and decides where a reply actually goes (often a
  // different address for no-reply/list senders) — previously dropped.
  const replyTo = getHeader(headers, "Reply-To");
  const date = getHeader(headers, "Date");
  const labels = msg.labelIds?.join(", ") ?? "";

  let body = "";
  const attachments: AttachmentInfo[] = [];
  if (msg.payload) {
    body = extractBody(msg.payload as GmailPart);
    attachments.push(...collectAttachments(msg.payload as GmailPart));
  }

  // Full body — claw's promoteIfOversized() spills oversized output to a file
  // behind a preview (google-gmail-read is on the retrieval allowlist), so we
  // no longer hard-truncate and silently drop the tail here.
  const parts = [
    `ID: ${msg.id}`,
    `Thread: ${msg.threadId}`,
    `Date: ${date}`,
    `From: ${from}`,
    `To: ${to}`,
    ...(cc ? [`Cc: ${cc}`] : []),
    ...(replyTo ? [`Reply-To: ${replyTo}`] : []),
    `Subject: ${subject}`,
    ...(labels ? [`Labels: ${labels}`] : []),
    ...(attachments.length > 0 ? [
      `\nAttachments (${attachments.length}):`,
      ...attachments.map((a) => `  - ${a.filename} (${a.mimeType}, ${formatSize(a.size)}) [attachmentId: ${a.attachmentId}]`),
    ] : []),
    `\n${body}`,
  ];

  const citation = externalCitation({ app: "gmail", url: gmailUrl(msg.id), chunkIndex: 1, label: `Gmail: ${subject}` });
  return {
    text: `${inlineCitationToken(1)}\n${parts.join("\n")}`,
    ...(citation ? { citations: [citation] } : {}),
  };
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

// Office Open XML mime types Gmail reports for .xlsx/.docx/.pptx attachments.
const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const PPTX_MIME = "application/vnd.openxmlformats-officedocument.presentationml.presentation";

/**
 * Extract readable text from an Office Open XML attachment (.xlsx/.docx/.pptx),
 * matched by extension OR mime type. Returns undefined when the attachment isn't
 * an Office doc, or when the buffer can't be parsed (caller falls back).
 */
function extractOfficeText(buffer: Buffer, ext: string, mimeType: string): string | undefined {
  if (ext === ".xlsx" || mimeType === XLSX_MIME) return xlsxToText(buffer); // sheet cells (dates converted)
  if (ext === ".docx" || mimeType === DOCX_MIME) return docxToText(buffer); // paragraphs + tables
  if (ext === ".pptx" || mimeType === PPTX_MIME) return pptxToText(buffer); // slide text + notes
  return undefined;
}

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

  // Text-based files. NOTE: charsets other than UTF-8 (ISO-8859-1, Windows-1252,
  // CJK) are out of scope here and would need the part's `charset` to decode.
  if (TEXT_EXTENSIONS.has(ext) || mimeType.startsWith("text/")) {
    const content = buffer.toString("utf-8");
    return {
      text: `File: ${filename} (${mimeType}, ${formatSize(data.size)})\n\n${content}`,
      mime: mimeType,
    };
  }

  // Office Open XML docs (.xlsx/.docx/.pptx): extract text so the model sees the
  // sheet/paragraph/slide content instead of "binary file — cannot be displayed".
  const officeText = extractOfficeText(buffer, ext, mimeType);
  if (officeText != null) {
    return {
      text: `File: ${filename} (${mimeType}, ${formatSize(data.size)})\n\n${officeText}`,
      mime: mimeType,
    };
  }

  // PDFs — extract text with pdf-parse
  if (mimeType === "application/pdf") {
    const parser = new PDFParse({ data: new Uint8Array(buffer) });
    try {
      const result = await parser.getText();
      const content = result.text.trim();
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

export async function trashEmails(
  token: string,
  messageIds: string[],
): Promise<string> {
  if (messageIds.length === 0) return "No message IDs provided.";
  await Promise.all(
    messageIds.map((id) => googleFetch(`${BASE}/messages/${id}/trash`, token, { method: "POST" })),
  );
  return `${messageIds.length} email(s) moved to trash.`;
}

interface LabelModification {
  addLabelIds?: string[];
  removeLabelIds?: string[];
}

/** Add/remove labels on a single message. */
async function modifyMessage(
  token: string,
  messageId: string,
  mod: LabelModification,
): Promise<void> {
  await googleFetch(`${BASE}/messages/${messageId}/modify`, token, {
    method: "POST",
    body: JSON.stringify(mod),
  });
}

/** Add/remove labels on up to 1000 messages in a single request. */
async function batchModifyMessages(
  token: string,
  messageIds: string[],
  mod: LabelModification,
): Promise<void> {
  await googleFetch(`${BASE}/messages/batchModify`, token, {
    method: "POST",
    body: JSON.stringify({ ids: messageIds, ...mod }),
  });
}

export async function batchMarkEmailsRead(
  token: string,
  messageIds: string[],
  read: boolean,
): Promise<string> {
  if (messageIds.length === 0) return "No message IDs provided.";
  await batchModifyMessages(token, messageIds, read ? { removeLabelIds: ["UNREAD"] } : { addLabelIds: ["UNREAD"] });
  return `${messageIds.length} email(s) marked as ${read ? "read" : "unread"}.`;
}

export async function archiveEmails(
  token: string,
  messageIds: string[],
): Promise<string> {
  if (messageIds.length === 0) return "No message IDs provided.";
  await batchModifyMessages(token, messageIds, { removeLabelIds: ["INBOX"] });
  return `${messageIds.length} email(s) archived (removed from inbox).`;
}

export async function starEmails(
  token: string,
  messageIds: string[],
  starred: boolean,
): Promise<string> {
  if (messageIds.length === 0) return "No message IDs provided.";
  const mod = starred ? { addLabelIds: ["STARRED"] } : { removeLabelIds: ["STARRED"] };
  if (messageIds.length === 1) {
    await modifyMessage(token, messageIds[0]!, mod);
  } else {
    await batchModifyMessages(token, messageIds, mod);
  }
  return `${messageIds.length} email(s) ${starred ? "starred" : "unstarred"}.`;
}

export async function markEmailsSpam(
  token: string,
  messageIds: string[],
  spam: boolean,
): Promise<string> {
  if (messageIds.length === 0) return "No message IDs provided.";
  const mod = spam
    ? { addLabelIds: ["SPAM"], removeLabelIds: ["INBOX"] }
    : { removeLabelIds: ["SPAM"], addLabelIds: ["INBOX"] };
  await batchModifyMessages(token, messageIds, mod);
  return `${messageIds.length} email(s) marked as ${spam ? "spam" : "not spam"}.`;
}

export async function untrashEmails(
  token: string,
  messageIds: string[],
): Promise<string> {
  if (messageIds.length === 0) return "No message IDs provided.";
  await Promise.all(
    messageIds.map((id) => googleFetch(`${BASE}/messages/${id}/untrash`, token, { method: "POST" })),
  );
  return `${messageIds.length} email(s) restored from trash.`;
}

export async function modifyEmailLabels(
  token: string,
  messageIds: string[],
  addLabelIds: string[],
  removeLabelIds: string[],
): Promise<string> {
  if (messageIds.length === 0) return "No message IDs provided.";
  if (addLabelIds.length === 0 && removeLabelIds.length === 0) return "No labels to add or remove.";
  await batchModifyMessages(token, messageIds, {
    ...(addLabelIds.length ? { addLabelIds } : {}),
    ...(removeLabelIds.length ? { removeLabelIds } : {}),
  });
  const parts: string[] = [];
  if (addLabelIds.length) parts.push(`added [${addLabelIds.join(", ")}]`);
  if (removeLabelIds.length) parts.push(`removed [${removeLabelIds.join(", ")}]`);
  return `${messageIds.length} email(s) labels updated: ${parts.join("; ")}.`;
}

interface GmailLabel {
  id: string;
  name: string;
  type?: string;
}

/** List all labels (system + user) so the agent can resolve label names to IDs. */
export async function listLabels(token: string): Promise<string> {
  const res = (await googleFetch(`${BASE}/labels`, token)) as { labels?: GmailLabel[] };
  if (!res.labels || res.labels.length === 0) return "No labels found.";

  const system = res.labels.filter((l) => l.type === "system");
  const user = res.labels.filter((l) => l.type !== "system");

  const fmt = (l: GmailLabel) => `  ${l.name} [${l.id}]`;
  const sections: string[] = [];
  if (user.length) sections.push(`User labels:\n${user.map(fmt).join("\n")}`);
  if (system.length) sections.push(`System labels:\n${system.map(fmt).join("\n")}`);

  return sections.join("\n\n");
}
