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
export function stripSelfMention(text: string, self: SelfIdentity): string {
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
  /** Treat the owner's messages to their own number as input. */
  selfChat?: boolean;
}

export function toInbound(msg: WAMessage, self: SelfIdentity, opts: ToInboundOptions = {}): InboundMessage | null {
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

  const isGroup = isJidGroup(remoteJid) === true;
  const chatId = normalize(remoteJid);
  const fromMe = key?.fromMe === true;
  // The owner's own messages in the "You" chat are input; anything we sent
  // (tracked by id) or sent elsewhere from the phone is an echo.
  const selfChat = fromMe && !isGroup && sameUser(remoteJid, self) && opts.selfChat !== false && !(opts.sentIds?.has(messageId) ?? false);
  const rawSender = selfChat ? self.jid : isGroup ? (key?.participant ?? "") : remoteJid;
  // Newer WhatsApp servers add the phone-number twin of a LID sender on the
  // key; prefer it so allowlists written as phone numbers keep matching.
  const altSender = (key as { senderPn?: string | null; participantPn?: string | null } | null | undefined);
  const senderId = normalize(altSender?.senderPn || altSender?.participantPn || rawSender);

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
    fromSelf: fromMe && !selfChat,
    ...(selfChat ? { selfChat: true } : {}),
    ref,
    ...(timestamp !== undefined ? { timestamp } : {}),
  };
}
