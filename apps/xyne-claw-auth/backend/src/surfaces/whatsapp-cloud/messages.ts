/**
 * Meta's `messages` webhook payload → the core InboundMessage shape. Pure, so
 * the mapping is testable without a Meta app.
 *
 * Shape (trimmed): entry[].changes[].value.{ metadata, contacts[], messages[] }
 * Delivery receipts arrive as value.statuses[] and are ignored here.
 */
import type { InboundMessage } from "../messaging/plugin.js";

interface CloudContact {
  wa_id?: string;
  profile?: { name?: string };
}

/** Every media node Meta sends shares this shape; only `document` names the
 *  file, and only `audio` flags a voice note. The id is a handle, not a URL —
 *  the bytes take two authenticated Graph calls to fetch. */
interface CloudMedia {
  id?: string;
  mime_type?: string;
  caption?: string;
  filename?: string;
  voice?: boolean;
}

interface CloudMessage {
  from?: string;
  id?: string;
  timestamp?: string;
  type?: string;
  text?: { body?: string };
  image?: CloudMedia;
  video?: CloudMedia;
  audio?: CloudMedia;
  sticker?: CloudMedia;
  document?: CloudMedia;
  button?: { text?: string; payload?: string };
  interactive?: {
    type?: string;
    button_reply?: { id?: string; title?: string };
    list_reply?: { id?: string; title?: string };
    /** A submitted WhatsApp Flow. `response_json` is a JSON STRING holding
     *  the flow_token we sent plus the form's `complete` payload. */
    nfm_reply?: { name?: string; body?: string; response_json?: string };
  };
  /** Present when the user replied to one of our messages. */
  context?: { id?: string; from?: string };
}

/** What the plugin needs to go and fetch a message's file. Mirrors the
 *  Baileys plugin's MediaDescriptor: the core never sees it, only the
 *  `attachments` the plugin produces from it. */
export interface CloudMediaRef {
  mediaId: string;
  kind: "image" | "video" | "document" | "audio" | "sticker";
  mimeType: string;
  fileName: string;
}

export interface CloudInbound extends InboundMessage {
  media?: CloudMediaRef;
}

const MEDIA_DEFAULTS: Record<string, { mimeType: string; fileName: string }> = {
  image: { mimeType: "image/jpeg", fileName: "image.jpg" },
  video: { mimeType: "video/mp4", fileName: "video.mp4" },
  audio: { mimeType: "audio/ogg", fileName: "audio.ogg" },
  sticker: { mimeType: "image/webp", fileName: "sticker.webp" },
  document: { mimeType: "application/octet-stream", fileName: "document" },
};

function mediaOf(message: CloudMessage): CloudMediaRef | null {
  const kind = message.type ?? "";
  if (!(kind in MEDIA_DEFAULTS)) return null;
  const node = (message as unknown as Record<string, CloudMedia | undefined>)[kind];
  if (!node?.id) return null;
  const fallback = MEDIA_DEFAULTS[kind]!;
  return {
    mediaId: node.id,
    kind: kind as CloudMediaRef["kind"],
    mimeType: node.mime_type || fallback.mimeType,
    fileName: node.filename || fallback.fileName,
  };
}

function asObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

/** The words a person typed, across the shapes Meta uses. */
export function extractText(message: CloudMessage): string {
  switch (message.type) {
    case "text":
      return message.text?.body ?? "";
    case "image":
      return message.image?.caption ?? "";
    case "video":
      return message.video?.caption ?? "";
    case "document":
      return message.document?.caption ?? message.document?.filename ?? "";
    case "button":
      return message.button?.text ?? "";
    case "interactive":
      return message.interactive?.button_reply?.title ?? message.interactive?.list_reply?.title ?? "";
    default:
      return "";
  }
}

/** The option id of a tapped button or list row, if this is one. That id is
 *  ours — we minted it when we sent the card — and is what correlates the tap
 *  back to the action it stands for. */
function extractCardReplyId(message: CloudMessage): string | undefined {
  if (message.type !== "interactive") return undefined;
  return message.interactive?.button_reply?.id ?? message.interactive?.list_reply?.id ?? undefined;
}

/** A submitted form, if this is one. Malformed JSON reads as no reply rather
 *  than an exception: the payload comes off someone's phone. */
function extractFormReply(message: CloudMessage): InboundMessage["formReply"] {
  if (message.type !== "interactive" || message.interactive?.type !== "nfm_reply") return undefined;
  const raw = message.interactive.nfm_reply?.response_json;
  if (typeof raw !== "string") return undefined;
  try {
    const parsed = asObject(JSON.parse(raw));
    const token = parsed?.["flow_token"];
    if (!parsed || typeof token !== "string" || !token) return undefined;
    const { flow_token: _token, ...fields } = parsed;
    return { token, fields };
  } catch {
    return undefined;
  }
}

export function parseCloudWebhook(payload: unknown): CloudInbound[] {
  const root = asObject(payload);
  if (!root || root["object"] !== "whatsapp_business_account") return [];
  const out: CloudInbound[] = [];

  for (const entryRaw of asArray(root["entry"])) {
    const entry = asObject(entryRaw);
    for (const changeRaw of asArray(entry?.["changes"])) {
      const change = asObject(changeRaw);
      if (change?.["field"] !== "messages") continue;
      const value = asObject(change["value"]);
      if (!value) continue;

      const contacts = asArray(value["contacts"]) as CloudContact[];
      const names = new Map<string, string>();
      for (const contact of contacts) {
        if (contact?.wa_id && contact.profile?.name) names.set(contact.wa_id, contact.profile.name);
      }

      for (const messageRaw of asArray(value["messages"]) as CloudMessage[]) {
        const from = messageRaw?.from;
        const id = messageRaw?.id;
        if (!from || !id) continue;
        const text = extractText(messageRaw).trim();
        const cardReplyId = extractCardReplyId(messageRaw);
        const formReply = extractFormReply(messageRaw);
        const media = mediaOf(messageRaw);
        // A tap carries its own meaning even when the title is somehow empty,
        // and a photo sent without a caption is the whole message rather than
        // an empty one — dropping it here used to ignore it silently.
        if (!text && !cardReplyId && !formReply && !media) continue;
        const name = names.get(from);
        const timestamp = Number(messageRaw.timestamp);

        out.push({
          ...(media ? { media } : {}),
          messageId: id,
          // Cloud API is one-to-one only: the chat IS the person.
          chatId: from,
          senderId: from,
          ...(name ? { senderName: name } : {}),
          isGroup: false,
          text,
          mentionedSelf: false,
          // Any quoted message in a business chat is one we sent.
          replyToSelf: Boolean(messageRaw.context?.id),
          ...(messageRaw.context?.id ? { replyToMessageId: messageRaw.context.id } : {}),
          fromSelf: false,
          ref: { chatId: from, messageId: id },
          ...(cardReplyId ? { cardReplyId } : {}),
          ...(formReply ? { formReply } : {}),
          ...(Number.isFinite(timestamp) ? { timestamp } : {}),
        });
      }
    }
  }
  return out;
}
