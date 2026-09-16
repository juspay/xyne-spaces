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

interface CloudMessage {
  from?: string;
  id?: string;
  timestamp?: string;
  type?: string;
  text?: { body?: string };
  image?: { caption?: string };
  video?: { caption?: string };
  document?: { caption?: string; filename?: string };
  button?: { text?: string; payload?: string };
  interactive?: {
    type?: string;
    button_reply?: { id?: string; title?: string };
    list_reply?: { id?: string; title?: string };
  };
  /** Present when the user replied to one of our messages. */
  context?: { id?: string; from?: string };
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
export function extractCardReplyId(message: CloudMessage): string | undefined {
  if (message.type !== "interactive") return undefined;
  return message.interactive?.button_reply?.id ?? message.interactive?.list_reply?.id ?? undefined;
}

export function parseCloudWebhook(payload: unknown): InboundMessage[] {
  const root = asObject(payload);
  if (!root || root["object"] !== "whatsapp_business_account") return [];
  const out: InboundMessage[] = [];

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
        // A tap carries its own meaning even when the title is somehow empty.
        if (!text && !cardReplyId) continue;
        const name = names.get(from);
        const timestamp = Number(messageRaw.timestamp);

        out.push({
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
          fromSelf: false,
          ref: { chatId: from, messageId: id },
          ...(cardReplyId ? { cardReplyId } : {}),
          ...(Number.isFinite(timestamp) ? { timestamp } : {}),
        });
      }
    }
  }
  return out;
}
