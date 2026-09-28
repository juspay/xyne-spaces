/**
 * Baileys message → core InboundMessage. Pure so it is unit-testable without
 * a socket. Drops what the agent must never see (status broadcasts,
 * newsletters, protocol/reaction messages), unwraps ephemeral/view-once/edit
 * envelopes, and derives the group/mention/reply flags the policy engine
 * gates on.
 */
import {
  getContentType,
  isJidBroadcast,
  isJidGroup,
  isJidNewsletter,
  isJidStatusBroadcast,
  jidNormalizedUser,
  normalizeMessageContent,
  type WAMessage,
  type proto,
} from "@whiskeysockets/baileys";
import type { InboundMessage, MessageRef } from "../messaging/plugin.js";
import { phoneFromJid } from "./schema.js";

export interface SelfIdentity {
  /** Phone-number JID (…@s.whatsapp.net). */
  jid: string;
  /** Anonymous LID (…@lid), when known. */
  lid?: string;
}

function normalize(jid: string | null | undefined): string {
  if (!jid) return "";
  try {
    return jidNormalizedUser(jid);
  } catch {
    return jid;
  }
}

function sameUser(a: string | null | undefined, self: SelfIdentity): boolean {
  if (!a) return false;
  const n = normalize(a);
  return n === normalize(self.jid) || (self.lid !== undefined && n === normalize(self.lid));
}

/** The media node on a message, if it carries one. Audio and stickers are
 *  listed because they are common; whether we can do anything useful with them
 *  is the caller's problem, not this function's. */
export interface MediaDescriptor {
  kind: "image" | "video" | "document" | "audio" | "sticker";
  mimeType: string;
  fileName: string;
  sizeBytes: number;
}

/** An inbound message plus what the plugin needs to go and fetch its file.
 *  `media` is plugin-local: the core never reads it, it only sees the
 *  `attachments` the plugin produces from it. */
export interface InboundWithMedia extends InboundMessage {
  media?: MediaDescriptor;
}

function mediaOf(content: proto.IMessage | null | undefined): MediaDescriptor | null {
  if (!content) return null;
  const type = getContentType(content);
  const node = type ? ((content as Record<string, unknown>)[type] as Record<string, unknown> | undefined) : undefined;
  if (!node) return null;
  const mimeType = typeof node["mimetype"] === "string" ? node["mimetype"] : "";
  const sizeBytes = Number(node["fileLength"] ?? 0) || 0;
  switch (type) {
    case "imageMessage":
      return { kind: "image", mimeType: mimeType || "image/jpeg", fileName: "image.jpg", sizeBytes };
    case "videoMessage":
      return { kind: "video", mimeType: mimeType || "video/mp4", fileName: "video.mp4", sizeBytes };
    case "audioMessage":
      return { kind: "audio", mimeType: mimeType || "audio/ogg", fileName: "audio.ogg", sizeBytes };
    case "stickerMessage":
      return { kind: "sticker", mimeType: mimeType || "image/webp", fileName: "sticker.webp", sizeBytes };
    case "documentMessage": {
      const named = typeof node["fileName"] === "string" && node["fileName"] ? node["fileName"] : "document";
      return { kind: "document", mimeType: mimeType || "application/octet-stream", fileName: named, sizeBytes };
    }
    default:
      return null;
  }
}

/** Text of a message across the shapes WhatsApp uses for "someone typed". */
export function extractText(content: proto.IMessage | null | undefined): string {
  if (!content) return "";
  const type = getContentType(content);
  switch (type) {
    case "conversation":
      return content.conversation ?? "";
    case "extendedTextMessage":
      return content.extendedTextMessage?.text ?? "";
    case "imageMessage":
      return content.imageMessage?.caption ?? "";
    case "videoMessage":
      return content.videoMessage?.caption ?? "";
    case "documentMessage":
      return content.documentMessage?.caption ?? "";
    default:
      return "";
  }
}

function contextInfoOf(content: proto.IMessage | null | undefined): proto.IContextInfo | null {
  if (!content) return null;
  const type = getContentType(content);
  if (!type) return null;
  const inner = (content as Record<string, unknown>)[type];
  if (!inner || typeof inner !== "object") return null;
  const ctx = (inner as { contextInfo?: proto.IContextInfo | null }).contextInfo;
  return ctx ?? null;
}

/** Strip "@<selfphone>" mention tokens WhatsApp inlines into the text. */
function stripSelfMention(text: string, self: SelfIdentity): string {
  const phone = phoneFromJid(self.jid);
  let out = text;
  if (phone) out = out.replace(new RegExp(`@${phone}\\b`, "g"), " ");
  const lidUser = self.lid ? self.lid.split("@")[0] : undefined;
  if (lidUser) out = out.replace(new RegExp(`@${lidUser}\\b`, "g"), " ");
  return out.replace(/\s+/g, " ").trim();
}

export interface ToInboundOptions {
  /** Ids of messages this account sent itself (so its own replies in the
   *  self chat are echoes, not new input). */
  sentIds?: ReadonlySet<string>;
}

export function toInbound(msg: WAMessage, self: SelfIdentity, opts: ToInboundOptions = {}): InboundWithMedia | null {
  const key = msg.key;
  const remoteJid = key?.remoteJid ?? "";
  const messageId = key?.id ?? "";
  if (!remoteJid || !messageId) return null;
  if (isJidStatusBroadcast(remoteJid) || isJidBroadcast(remoteJid) || isJidNewsletter(remoteJid)) return null;

  const content = normalizeMessageContent(msg.message ?? undefined);
  if (!content) return null;
  const type = getContentType(content);
  if (!type || type === "protocolMessage" || type === "reactionMessage" || type === "senderKeyDistributionMessage") {
    return null;
  }
  // A media message with no caption has no text, but it is still something the
  // person sent and must not be dropped as empty.
  const media = mediaOf(content);

  const isGroup = isJidGroup(remoteJid) === true;
  const chatId = normalize(remoteJid);
  const fromMe = key?.fromMe === true;
  // Everything this account sends comes back to us, and so does everything the
  // owner types on their own phone — both arrive as fromMe. The only thing
  // separating them is whether WE sent it, which is what sentIds records.
  // Without that split the owner cannot talk to their own agent in a group,
  // because their message looks identical to the agent's own echo.
  const fromOwner = fromMe && !(opts.sentIds?.has(messageId) ?? false);
  // A fact about the message, not a setting: whether the account answers here
  // is the plugin's call (see plugin.ts), and policy still applies either way.
  const selfChat = fromOwner && !isGroup && sameUser(remoteJid, self);
  // In a one-to-one chat remoteJid is the OTHER party, so it is only the
  // sender when they were the one who wrote. A message the owner typed is
  // from the owner wherever it was sent — their own chat or a contact's —
  // and attributing it to the contact would run it with that person's Xyne
  // access and answer them as if they had asked.
  const ownDm = fromOwner && !isGroup;
  // Newer WhatsApp servers add the phone-number twin of a LID sender on the
  // key; prefer it so allowlists written as phone numbers keep matching. It
  // describes the other party, so it has no say over a message we know the
  // owner wrote.
  const altSender = (key as { senderPn?: string | null; participantPn?: string | null } | null | undefined);
  const senderId = ownDm
    ? normalize(self.jid)
    : normalize(altSender?.senderPn || altSender?.participantPn || (isGroup ? (key?.participant ?? "") : remoteJid));

  const ctx = contextInfoOf(content);
  const mentionedSelf = (ctx?.mentionedJid ?? []).some((jid) => sameUser(jid, self));
  const replyToSelf = !!ctx?.stanzaId && sameUser(ctx.participant, self);

  const text = stripSelfMention(extractText(content), self);
  const ref: MessageRef = {
    chatId,
    messageId,
    raw: { key: { remoteJid, id: messageId, fromMe: key?.fromMe ?? false, ...(key?.participant ? { participant: key.participant } : {}) }, message: { conversation: text.slice(0, 200) } },
  };

  const ts = msg.messageTimestamp;
  const timestamp = typeof ts === "number" ? ts : ts && typeof ts === "object" && "toNumber" in ts ? Number(ts.toNumber()) : undefined;

  return {
    messageId,
    chatId,
    senderId,
    ...(msg.pushName ? { senderName: msg.pushName } : {}),
    isGroup,
    text,
    mentionedSelf,
    replyToSelf,
    ...(media ? { media } : {}),
    fromSelf: fromMe && !fromOwner,
    ...(fromOwner ? { fromOwner: true } : {}),
    ...(selfChat ? { selfChat: true } : {}),
    ref,
    ...(timestamp !== undefined ? { timestamp } : {}),
  };
}
