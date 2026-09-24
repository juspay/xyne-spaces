/**
 * WhatsApp Business Cloud API as a messaging-channel plugin — the OFFICIAL
 * path, in contrast to the Baileys plugin next door.
 *
 * Meta POSTs inbound messages to us, so this is a `webhook` transport: no
 * socket, no QR, no session credentials, nothing to keep alive. The account
 * "runs" only so the outbox has an owner to send through.
 *
 * Two rules of the platform shape everything here:
 *  - One-to-one only. Business numbers cannot be in groups.
 *  - Free-form replies are allowed for 24 hours after the person's last
 *    message. Outside that window Meta rejects the send and only approved
 *    templates go through; the rejection is surfaced to the agent verbatim.
 */
import { createHmac, timingSafeEqual } from "node:crypto";
import { fetch as httpFetch, FormData } from "undici";
import { MAX_INBOUND_BYTES, TYPING_MAX_MS } from "../messaging/const.js";
import { createLogger } from "../../logger.js";
import { errMsg } from "../../lib/errors.js";
import type { ChannelPlugin, InboundAttachment, InteractiveCard, OutboundFile, AuthStateStore } from "../messaging/plugin.js";
import { formatForWhatsApp } from "../whatsapp-shared/format.js";
import { parseCloudWebhook, type CloudMediaRef } from "./messages.js";
import {
  GRAPH_ORIGIN,
  GRAPH_VERSION,
  SECRET_ACCESS_TOKEN,
  SECRET_APP_SECRET,
  SECRET_PHONE_NUMBER_ID,
  SECRET_VERIFY_TOKEN,
  waIdFromTarget,
  whatsappCloudConfigSchema,
  type WhatsAppCloudConfig,
} from "./schema.js";

const log = createLogger("whatsapp-cloud");

const MAX_TEXT_CHARS = 4096;
/** Meta dismisses the indicator after 25s, or when we reply. Refresh inside
 *  that window so a long run does not look like it stalled. */
const TYPING_REFRESH_MS = 20_000;
/** Meta's media caps: images are far smaller than documents. */
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const MAX_FILE_BYTES = 100 * 1024 * 1024;

export interface CloudHandle {
  phoneNumberId: string;
  accessToken: string;
}

interface GraphError {
  error?: { message?: string; code?: number; error_subcode?: number; error_data?: { details?: string } };
}

function messagesUrl(handle: CloudHandle): string {
  return `${GRAPH_ORIGIN}/${GRAPH_VERSION}/${handle.phoneNumberId}/messages`;
}

/** One place to talk to Graph, so every error reads the same to the agent. */
async function graphPost(handle: CloudHandle, body: Record<string, unknown>): Promise<{ messageId: string }> {
  const response = await httpFetch(messagesUrl(handle), {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${handle.accessToken}` },
    body: JSON.stringify(body),
  });
  const payload = (await response.json().catch(() => null)) as
    | (GraphError & { messages?: Array<{ id?: string }> })
    | null;
  if (!response.ok) {
    const detail = payload?.error?.error_data?.details ?? payload?.error?.message ?? `HTTP ${response.status}`;
    throw new Error(`WhatsApp Cloud API: ${detail}`);
  }
  return { messageId: payload?.messages?.[0]?.id ?? "" };
}

/** Upload bytes, then send by media id. A link would have to be publicly
 *  reachable, which our attachments are not. */
async function uploadMedia(handle: CloudHandle, file: OutboundFile): Promise<string> {
  const form = new FormData();
  form.append("messaging_product", "whatsapp");
  form.append("type", file.mimeType);
  form.append("file", new Blob([new Uint8Array(file.data)], { type: file.mimeType }), file.fileName);
  const response = await httpFetch(`${GRAPH_ORIGIN}/${GRAPH_VERSION}/${handle.phoneNumberId}/media`, {
    method: "POST",
    headers: { authorization: `Bearer ${handle.accessToken}` },
    body: form,
  });
  const payload = (await response.json().catch(() => null)) as (GraphError & { id?: string }) | null;
  if (!response.ok || !payload?.id) {
    throw new Error(`WhatsApp Cloud API upload: ${payload?.error?.message ?? `HTTP ${response.status}`}`);
  }
  return payload.id;
}

async function requiredSecret(store: AuthStateStore, key: string, label: string): Promise<string> {
  const value = await store.get(key, "");
  if (!value) throw new Error(`${label} is not configured for this account`);
  return value;
}

/**
 * Two authenticated calls, because Meta hands out a media id rather than a
 * URL: GET /<id> answers with a short-lived signed `url` plus the size, and
 * that url needs the same bearer token to read. The size comes back before
 * the bytes do, which is what lets an oversized file be refused without ever
 * downloading it.
 */
async function fetchCloudMedia(
  authState: AuthStateStore,
  media: CloudMediaRef,
): Promise<InboundAttachment | null> {
  const token = await authState.get(SECRET_ACCESS_TOKEN, "");
  if (!token) {
    log.warn(`[whatsapp-cloud] no access token stored; cannot fetch media ${media.mediaId}`);
    return null;
  }
  const auth = { Authorization: `Bearer ${token}` };
  try {
    const metaRes = await httpFetch(`${GRAPH_ORIGIN}/${GRAPH_VERSION}/${media.mediaId}`, { headers: auth });
    if (!metaRes.ok) {
      log.warn(`[whatsapp-cloud] media lookup failed ${media.mediaId}: HTTP ${metaRes.status}`);
      return null;
    }
    const info = (await metaRes.json()) as { url?: string; mime_type?: string; file_size?: number };
    if (!info.url) return null;
    if (typeof info.file_size === "number" && info.file_size > MAX_INBOUND_BYTES) {
      log.info(`[whatsapp-cloud] media too large (${info.file_size} bytes) id=${media.mediaId}`);
      return null;
    }
    const fileRes = await httpFetch(info.url, { headers: auth });
    if (!fileRes.ok) {
      log.warn(`[whatsapp-cloud] media download failed ${media.mediaId}: HTTP ${fileRes.status}`);
      return null;
    }
    const data = Buffer.from(await fileRes.arrayBuffer());
    // file_size is absent often enough that the cap has to hold here too.
    if (data.length === 0 || data.length > MAX_INBOUND_BYTES) return null;
    return { fileName: media.fileName, mimeType: info.mime_type || media.mimeType, data };
  } catch (err) {
    log.warn(`[whatsapp-cloud] media fetch threw ${media.mediaId}: ${errMsg(err)}`);
    return null;
  }
}

export const whatsappCloudPlugin: ChannelPlugin<CloudHandle, WhatsAppCloudConfig> = {
  key: "whatsapp-cloud",
  displayName: "WhatsApp (Business API)",
  transport: "webhook",
  login: { kind: "token" },
  // One business number for the whole org; people link their own numbers to it.
  accountScope: "org",
  loginFields: [
    {
      key: SECRET_PHONE_NUMBER_ID,
      label: "Phone Number ID",
      type: "text",
      placeholder: "123456789012345",
      hint: "WhatsApp, API Setup in your Meta app.",
    },
    {
      key: SECRET_ACCESS_TOKEN,
      label: "System user access token",
      type: "password",
      hint: "Business Settings, System Users, Generate token with the whatsapp_business_messaging scope. Set it to never expire.",
    },
    {
      key: SECRET_APP_SECRET,
      label: "App secret",
      type: "password",
      hint: "App settings, Basic. Signs Meta's webhooks.",
    },
    {
      key: SECRET_VERIFY_TOKEN,
      label: "Verify token",
      type: "password",
      hint: "Any random string you invent. Paste the same value into Meta's webhook configuration.",
    },
  ],
  capabilities: {
    // Business numbers cannot join groups — this is a platform limit, not a
    // missing feature.
    groups: false,
    reactions: true,
    typing: true,
    media: true,
    maxTextChars: MAX_TEXT_CHARS,
    maxImageBytes: MAX_IMAGE_BYTES,
    maxFileBytes: MAX_FILE_BYTES,
    // Meta's published caps for interactive messages. They are rejections,
    // not truncations: one over-long row fails the whole send, so the core
    // trims to these before calling sendInteractive.
    interactive: {
      buttons: 3,
      buttonTitleChars: 20,
      listRows: 10,
      rowTitleChars: 24,
      rowDescriptionChars: 72,
      bodyChars: 1024,
      headerChars: 60,
      footerChars: 60,
      cta: true,
    },
  },
  channelConfigSchema: whatsappCloudConfigSchema,

  async openHandle(_account, authState) {
    return {
      phoneNumberId: await requiredSecret(authState, SECRET_PHONE_NUMBER_ID, "Phone Number ID"),
      accessToken: await requiredSecret(authState, SECRET_ACCESS_TOKEN, "Access token"),
    };
  },

  /** Graph knows the number behind the phone-number id; nothing else does,
   *  and `display_phone_number` is what a person has to message. */
  async describeHandle(handle) {
    const url = `${GRAPH_ORIGIN}/${GRAPH_VERSION}/${handle.phoneNumberId}?fields=display_phone_number,verified_name`;
    const response = await httpFetch(url, { headers: { authorization: `Bearer ${handle.accessToken}` } });
    const payload = (await response.json().catch(() => null)) as
      | ({ display_phone_number?: string; verified_name?: string } & GraphError)
      | null;
    if (!response.ok || !payload?.display_phone_number) {
      throw new Error(payload?.error?.message ?? `HTTP ${response.status}`);
    }
    return { selfId: handle.phoneNumberId, displayId: payload.display_phone_number };
  },

  async verifyChallenge(_account, authState, token) {
    const expected = await authState.get(SECRET_VERIFY_TOKEN, "");
    if (!expected) return false;
    const a = Buffer.from(token);
    const b = Buffer.from(expected);
    return a.length === b.length && timingSafeEqual(a, b);
  },

  async verifySignature(rawBody, headers, _account, authState) {
    const header = headers["x-hub-signature-256"];
    const provided = typeof header === "string" ? header : Array.isArray(header) ? header[0] : undefined;
    if (!provided?.startsWith("sha256=")) return false;
    const appSecret = await authState.get(SECRET_APP_SECRET, "");
    if (!appSecret) return false;
    const expected = `sha256=${createHmac("sha256", appSecret).update(rawBody).digest("hex")}`;
    const a = Buffer.from(provided);
    const b = Buffer.from(expected);
    return a.length === b.length && timingSafeEqual(a, b);
  },

  parseInbound(_payload, _account, authState) {
    const messages = parseCloudWebhook(_payload);
    for (const message of messages) {
      const media = message.media;
      if (!media) continue;
      // The core calls this only once the message has passed policy, so a
      // chat the account ignores never costs two Graph round trips.
      message.mediaKind = media.kind;
      message.loadAttachments = async () => {
        const file = await fetchCloudMedia(authState, media);
        return file ? [file] : [];
      };
    }
    return messages;
  },

  async sendText(handle, chatId, text, opts) {
    const quotedId = opts?.quoted?.messageId;
    const { messageId } = await graphPost(handle, {
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to: chatId,
      type: "text",
      text: { body: text, preview_url: false },
      ...(quotedId ? { context: { message_id: quotedId } } : {}),
    });
    return { chatId, messageId };
  },

  /**
   * WhatsApp has no "start/stop typing" call. The indicator is a side effect
   * of marking ONE inbound message read, lasts at most 25 seconds, and is
   * dismissed the moment we reply — so `on` starts a refresh loop keyed to
   * that message and `off` just cancels it, since the reply itself clears the
   * indicator. Marking read also turns on the blue ticks, which is Meta's
   * design here, not a side effect we can opt out of.
   */
  async setTyping(handle, chatId, on, opts) {
    const key = `${handle.phoneNumberId}:${chatId}`;
    const existing = typingTimers.get(key);
    if (existing) {
      clearInterval(existing);
      typingTimers.delete(key);
    }
    if (!on) return;
    const messageId = opts?.messageId;
    // Without the inbound message there is nothing to attach the indicator
    // to; silently doing nothing beats a Graph error on every message.
    if (!messageId) return;

    await postTyping(handle, messageId);
    const startedAt = Date.now();
    const timer = setInterval(() => {
      if (Date.now() - startedAt > TYPING_MAX_MS) {
        clearInterval(timer);
        typingTimers.delete(key);
        return;
      }
      void postTyping(handle, messageId).catch(() => undefined);
    }, TYPING_REFRESH_MS);
    // Never hold the process open for a typing animation.
    timer.unref?.();
    typingTimers.set(key, timer);
  },

  /** Free-form interactive messages are allowed only inside the 24-hour
   *  customer-service window. Every card we send answers a message the person
   *  just sent, so we are always inside it; outside, Graph rejects the send
   *  and the error is surfaced like any other. */
  async sendInteractive(handle, chatId, card, opts) {
    const quotedId = opts?.quoted?.messageId;
    const { messageId } = await graphPost(handle, {
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to: chatId,
      type: "interactive",
      interactive: buildInteractive(card),
      ...(quotedId ? { context: { message_id: quotedId } } : {}),
    });
    return { chatId, messageId };
  },

  async sendMedia(handle, chatId, file, opts) {
    const mediaId = await uploadMedia(handle, file);
    const isImage = file.mimeType.startsWith("image/");
    const caption = opts?.caption;
    const { messageId } = await graphPost(handle, {
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to: chatId,
      type: isImage ? "image" : "document",
      ...(isImage
        ? { image: { id: mediaId, ...(caption ? { caption } : {}) } }
        : { document: { id: mediaId, filename: file.fileName, ...(caption ? { caption } : {}) } }),
    });
    return { chatId, messageId };
  },

  async react(handle, ref, emoji) {
    if (!ref.messageId) return;
    await graphPost(handle, {
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to: ref.chatId,
      type: "reaction",
      reaction: { message_id: ref.messageId, emoji },
    });
  },

  /** No directory to query: Meta has no "is this number on WhatsApp" lookup,
   *  so a well-formed number is accepted and a bad one fails at send time. */
  async resolveTarget(_handle, target) {
    return waIdFromTarget(target);
  },

  formatText: formatForWhatsApp,

  // The Cloud API reports `from` as bare digits in full international form,
  // which is exactly what waIdFromTarget produces, so an identity row keys on
  // the same value the agent's send tool resolves to.
  senderIdFromPhone: waIdFromTarget,
};

/** One refresh loop per (number, chat). Module-level because the webhook
 *  transport's handle is a plain credential bag, not a live client. */
const typingTimers = new Map<string, NodeJS.Timeout>();

/** Marks the message read AND shows "typing…" — one call does both. */
async function postTyping(handle: CloudHandle, messageId: string): Promise<void> {
  await graphPost(handle, {
    messaging_product: "whatsapp",
    status: "read",
    message_id: messageId,
    typing_indicator: { type: "text" },
  });
}

/** The core's card → Meta's `interactive` object. Assumes the card has
 *  already been trimmed to `capabilities.interactive` by fitCard. */
function buildInteractive(card: InteractiveCard): Record<string, unknown> {
  const frame = {
    ...(card.header ? { header: { type: "text", text: card.header } } : {}),
    body: { text: card.body },
    ...(card.footer ? { footer: { text: card.footer } } : {}),
  };
  switch (card.kind) {
    case "buttons":
      return {
        ...frame,
        type: "button",
        action: {
          buttons: card.buttons.map((b) => ({ type: "reply", reply: { id: b.id, title: b.title } })),
        },
      };
    case "list":
      return {
        ...frame,
        type: "list",
        action: {
          button: card.button,
          sections: card.sections.map((section) => ({
            ...(section.title ? { title: section.title } : {}),
            rows: section.rows.map((row) => ({
              id: row.id,
              title: row.title,
              ...(row.description ? { description: row.description } : {}),
            })),
          })),
        },
      };
    case "cta":
      return {
        ...frame,
        type: "cta_url",
        action: { name: "cta_url", parameters: { display_text: card.label, url: card.url } },
      };
  }
}
