/**
 * Microsoft Outlook Mail API helpers (via Microsoft Graph).
 */

import { microsoftFetch } from "./oauth.js";

const BASE = "https://graph.microsoft.com/v1.0/me";

/** Basic sanity check — Graph IDs are long alphanumeric+symbol strings, never empty. */
function validateId(id: string, label: string): void {
  if (!id || id.trim().length === 0) {
    throw new Error(`${label} must not be empty`);
  }
}

interface EmailAddress {
  name?: string;
  address: string;
}

interface Recipient {
  emailAddress: EmailAddress;
}

interface ItemBody {
  contentType: "text" | "html";
  content: string;
}

interface Attachment {
  id: string;
  name: string;
  contentType: string;
  size: number;
  isInline: boolean;
}

interface OutlookMessage {
  id: string;
  subject: string;
  bodyPreview: string;
  body?: ItemBody;
  from?: { emailAddress: EmailAddress };
  toRecipients?: Recipient[];
  ccRecipients?: Recipient[];
  receivedDateTime: string;
  isRead: boolean;
  hasAttachments: boolean;
  conversationId?: string;
  webLink?: string;
  importance?: string;
}

interface MessagesResponse {
  value: OutlookMessage[];
  "@odata.count"?: number;
  "@odata.nextLink"?: string;
}

function formatRecipients(recipients: Recipient[] | undefined): string {
  if (!recipients || recipients.length === 0) return "";
  return recipients.map((r) => {
    const name = r.emailAddress.name;
    const addr = r.emailAddress.address;
    return name ? `${name} <${addr}>` : addr;
  }).join(", ");
}

function formatFrom(from: { emailAddress: EmailAddress } | undefined): string {
  if (!from) return "(unknown)";
  const name = from.emailAddress.name;
  const addr = from.emailAddress.address;
  return name ? `${name} <${addr}>` : addr;
}

/** Search Outlook messages using $search or $filter. */
export async function searchMessages(
  token: string,
  query: string,
  maxResults: number,
): Promise<string> {
  // Microsoft Graph: $search and $orderby cannot be used together
  // Empty query: list recent messages using $orderby
  // Non-empty query: use $search (KQL) without $orderby
  const trimmedQuery = query.trim();
  const isSearch = trimmedQuery.length > 0;

  let url: string;
  if (!isSearch) {
    // List recent messages (no search)
    const params = new URLSearchParams({
      $top: String(maxResults),
      $select: "id,subject,bodyPreview,from,toRecipients,receivedDateTime,isRead,hasAttachments,importance",
      $orderby: "receivedDateTime desc",
    });
    url = `${BASE}/messages?${params}`;
  } else {
    // Search with KQL (no $orderby allowed with $search)
    // Escape double quotes in query to prevent KQL injection
    const safeQuery = trimmedQuery.replace(/"/g, '\\"');
    const params = new URLSearchParams({
      $search: `"${safeQuery}"`,
      $top: String(maxResults),
      $select: "id,subject,bodyPreview,from,toRecipients,receivedDateTime,isRead,hasAttachments,importance",
    });
    url = `${BASE}/messages?${params}`;
  }

  const result = (await microsoftFetch(url, token)) as MessagesResponse;

  if (!result.value || result.value.length === 0) {
    return isSearch ? "No emails found matching the query." : "No emails found.";
  }

  // Only sort for search results (non-search path already uses $orderby)
  const messages = isSearch
    ? [...result.value].sort((a, b) =>
        new Date(b.receivedDateTime).getTime() - new Date(a.receivedDateTime).getTime()
      )
    : result.value;

  const lines = messages.map((msg) => {
    const read = msg.isRead ? "" : " [UNREAD]";
    const attach = msg.hasAttachments ? " 📎" : "";
    return [
      `[${msg.id}] ${msg.receivedDateTime}${read}${attach}`,
      `  From: ${formatFrom(msg.from)}`,
      `  Subject: ${msg.subject || "(no subject)"}`,
      `  ${msg.bodyPreview}`,
    ].join("\n");
  });

  return `Found ${messages.length} emails:\n\n${lines.join("\n\n")}`;
}

/** Read a specific Outlook message by ID. */
export async function readMessage(token: string, messageId: string): Promise<string> {
  validateId(messageId, "messageId");
  const msg = (await microsoftFetch(
    `${BASE}/messages/${messageId}?$select=id,subject,body,from,toRecipients,ccRecipients,receivedDateTime,isRead,hasAttachments,conversationId,webLink,importance`,
    token,
  )) as OutlookMessage;

  let body = msg.body?.content ?? "";
  // Strip HTML tags if HTML content
  if (msg.body?.contentType === "html") {
    body = body.replace(/<[^>]+>/g, "").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim();
  }
  // Full body — claw's promoteIfOversized() spills oversized output to a file
  // behind a preview (microsoft-outlook-read is on the retrieval allowlist),
  // so we no longer hard-truncate and silently drop the tail here.

  // Fetch attachments list if present
  let attachmentInfo = "";
  if (msg.hasAttachments) {
    const attachments = (await microsoftFetch(
      `${BASE}/messages/${messageId}/attachments?$select=id,name,contentType,size,isInline`,
      token,
    )) as { value: Attachment[] };
    if (attachments.value.length > 0) {
      const attLines = attachments.value
        .filter((a) => !a.isInline)
        .map((a) => `  - ${a.name} (${a.contentType}, ${formatSize(a.size)}) [attachmentId: ${a.id}]`);
      if (attLines.length > 0) {
        attachmentInfo = `\nAttachments (${attLines.length}):\n${attLines.join("\n")}`;
      }
    }
  }

  const parts = [
    `ID: ${msg.id}`,
    `Date: ${msg.receivedDateTime}`,
    `From: ${formatFrom(msg.from)}`,
    `To: ${formatRecipients(msg.toRecipients)}`,
    ...(msg.ccRecipients && msg.ccRecipients.length > 0 ? [`Cc: ${formatRecipients(msg.ccRecipients)}`] : []),
    `Subject: ${msg.subject || "(no subject)"}`,
    ...(msg.importance && msg.importance !== "normal" ? [`Importance: ${msg.importance}`] : []),
    `Read: ${msg.isRead ? "yes" : "no"}`,
    ...(msg.conversationId ? [`Conversation: ${msg.conversationId}`] : []),
    ...(msg.webLink ? [`Link: ${msg.webLink}`] : []),
    ...(attachmentInfo ? [attachmentInfo] : []),
    `\n${body}`,
  ];

  return parts.join("\n");
}

/** Create a draft email in Outlook. */
export async function createDraft(
  token: string,
  to: string,
  subject: string,
  body: string,
  cc?: string,
  replyToMessageId?: string,
): Promise<string> {
  // Build the message object
  const toRecipients = to.split(",").map((addr) => ({
    emailAddress: { address: addr.trim() },
  }));

  const message: Record<string, unknown> = {
    subject,
    body: { contentType: "text", content: body },
    toRecipients,
  };

  if (cc) {
    message["ccRecipients"] = cc.split(",").map((addr) => ({
      emailAddress: { address: addr.trim() },
    }));
  }

  let url = `${BASE}/messages`;

  // If replying, create reply draft on the original message
  if (replyToMessageId) {
    const reply = (await microsoftFetch(
      `${BASE}/messages/${replyToMessageId}/createReply`,
      token,
      { method: "POST", body: JSON.stringify({ message }) },
    )) as OutlookMessage;

    return [
      "Reply draft created successfully.",
      `Draft ID: ${reply.id}`,
      `Subject: ${reply.subject}`,
      "Open Outlook to review and send.",
    ].join("\n");
  }

  // Standard draft
  const draft = (await microsoftFetch(url, token, {
    method: "POST",
    body: JSON.stringify(message),
  })) as OutlookMessage;

  return [
    "Draft created successfully.",
    `Draft ID: ${draft.id}`,
    `Subject: ${draft.subject}`,
    "Open Outlook to review and send.",
  ].join("\n");
}

/** Move a message to the Deleted Items folder. */
export async function trashMessage(token: string, messageId: string): Promise<string> {
  validateId(messageId, "messageId");
  // Graph API: move to deletedItems well-known folder
  await microsoftFetch(`${BASE}/messages/${messageId}/move`, token, {
    method: "POST",
    body: JSON.stringify({ destinationId: "deleteditems" }),
  });

  return `Message ${messageId} moved to Deleted Items.`;
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}