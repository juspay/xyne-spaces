import type { GmailMessage, GmailPart } from "./gmail-api.js";

export interface Address {
  key: string;
  name: string | null;
}

export interface ParsedMessage {
  id: string;
  threadId: string;
  at: Date;
  from: Address | null;
  to: Address[];
  cc: Address[];
  subject: string | null;
  snippet: string;
  labels: string[];
  fromUser: boolean;
  important: boolean;
  noise: boolean;
  userRole: "to" | "cc" | "other";
}

const NOISE_LABELS = new Set(["SPAM", "TRASH", "DRAFT", "CATEGORY_PROMOTIONS", "CATEGORY_SOCIAL", "CATEGORY_FORUMS"]);
const NO_REPLY = /^(no-?reply|do-?not-?reply|notifications?|mailer-daemon|bounce|alerts?)([+.-]|@)/i;

export function header(part: GmailPart | undefined, name: string): string | null {
  const lower = name.toLowerCase();
  const found = part?.headers?.find((h) => h.name.toLowerCase() === lower);
  return found?.value?.trim() || null;
}

function splitAddressList(value: string): string[] {
  const out: string[] = [];
  let current = "";
  let quoted = false;
  let angle = 0;
  for (const ch of value) {
    if (ch === '"') quoted = !quoted;
    else if (!quoted && ch === "<") angle++;
    else if (!quoted && ch === ">") angle = Math.max(0, angle - 1);
    if (ch === "," && !quoted && angle === 0) {
      out.push(current);
      current = "";
    } else {
      current += ch;
    }
  }
  out.push(current);
  return out.map((s) => s.trim()).filter(Boolean);
}

export function parseAddress(raw: string): Address | null {
  const angle = raw.match(/^(.*)<([^>]+)>\s*$/);
  const email = (angle?.[2] ?? raw).trim().toLowerCase();
  if (!email.includes("@")) return null;
  const name = angle ? angle[1]!.trim().replace(/^"|"$/g, "").trim() : "";
  return { key: email, name: name || null };
}

export function parseAddressList(value: string | null): Address[] {
  if (!value) return [];
  return splitAddressList(value)
    .map(parseAddress)
    .filter((a): a is Address => a !== null);
}

export function isBulk(part: GmailPart | undefined): boolean {
  const precedence = header(part, "Precedence")?.toLowerCase() ?? null;
  const autoSubmitted = header(part, "Auto-Submitted")?.toLowerCase() ?? null;
  return (
    header(part, "List-Unsubscribe") !== null ||
    header(part, "List-Id") !== null ||
    precedence === "bulk" ||
    precedence === "list" ||
    precedence === "junk" ||
    (autoSubmitted !== null && autoSubmitted !== "no")
  );
}

export function parseGmailMessage(message: GmailMessage, userAddress: string): ParsedMessage {
  const labels = message.labelIds ?? [];
  const payload = message.payload;
  const from = parseAddress(header(payload, "From") ?? "");
  const to = parseAddressList(header(payload, "To"));
  const cc = parseAddressList(header(payload, "Cc"));
  const user = userAddress.toLowerCase();
  const fromUser = !labels.includes("DRAFT") && (labels.includes("SENT") || from?.key === user);
  const important = labels.includes("IMPORTANT");
  const userRole = to.some((a) => a.key === user) ? "to" : cc.some((a) => a.key === user) ? "cc" : "other";
  const internal = Number(message.internalDate);
  const noise =
    !fromUser &&
    (labels.some((l) => NOISE_LABELS.has(l)) ||
      (!important && labels.includes("CATEGORY_UPDATES")) ||
      (!important && isBulk(payload)) ||
      (from !== null && NO_REPLY.test(from.key)));
  return {
    id: message.id,
    threadId: message.threadId,
    at: Number.isFinite(internal) && internal > 0 ? new Date(internal) : new Date(),
    from,
    to,
    cc,
    subject: header(payload, "Subject"),
    snippet: decodeEntities(message.snippet ?? ""),
    labels,
    fromUser,
    important,
    noise,
    userRole,
  };
}

function decodeEntities(text: string): string {
  return text
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

function decodeBase64Url(data: string): string {
  return Buffer.from(data.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8");
}

function findPart(part: GmailPart | undefined, mime: string): GmailPart | null {
  if (!part) return null;
  if (part.mimeType === mime && part.body?.data) return part;
  for (const child of part.parts ?? []) {
    const found = findPart(child, mime);
    if (found) return found;
  }
  return null;
}

export function stripHtml(html: string): string {
  return decodeEntities(
    html
      .replace(/<(script|style)[\s\S]*?<\/\1>/gi, " ")
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/(p|div|li|tr|h[1-6])>/gi, "\n")
      .replace(/<[^>]+>/g, " ")
      .replace(/&nbsp;/g, " "),
  )
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s*\n+/g, "\n\n")
    .trim();
}

export function stripQuoted(text: string): string {
  const lines = text.split(/\r?\n/);
  const out: string[] = [];
  for (const line of lines) {
    if (/^On .+wrote:\s*$/.test(line.trim()) || /^-{2,}\s*Original Message\s*-{2,}/i.test(line.trim())) break;
    if (line.trimStart().startsWith(">")) continue;
    out.push(line);
  }
  return out.join("\n").trim();
}

export function messageBodyText(message: GmailMessage): string {
  const plain = findPart(message.payload, "text/plain");
  if (plain?.body?.data) return stripQuoted(decodeBase64Url(plain.body.data));
  const html = findPart(message.payload, "text/html");
  if (html?.body?.data) return stripQuoted(stripHtml(decodeBase64Url(html.body.data)));
  return decodeEntities(message.snippet ?? "");
}
