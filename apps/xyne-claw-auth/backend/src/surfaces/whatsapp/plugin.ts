/**
 * WhatsApp over Baileys (the WhatsApp Web multi-device protocol) as a
 * messaging-channel plugin. QR login: the admin scans the code the socket
 * emits, and from then on this account is a "linked device" of that number.
 *
 * Unofficial protocol: WhatsApp may ban numbers that run it. Use a dedicated
 * number. All Baileys imports stay in this folder so version churn is local.
 *
 * Reconnects are handled here (backoff while the core still owns the
 * account); a `loggedOut` close is terminal and reported via ctx.onClosed
 * so the core marks the account and never reconnects.
 */
import {
  Browsers,
  DisconnectReason,
  fetchLatestBaileysVersion,
  jidNormalizedUser,
  makeCacheableSignalKeyStore,
  makeWASocket,
  downloadMediaMessage,
  type WAMessage,
  type WASocket,
} from "@whiskeysockets/baileys";
import pino from "pino";
import { errMsg } from "../../lib/errors.js";
import type {
  AccountRuntimeContext,
  InboundAttachment,
  ChannelPlugin,
  MessageRef,
  OutboundFile,
  StopReason,
} from "../messaging/plugin.js";
import { makeStoredAuthState } from "./auth-state.js";
import { formatForWhatsApp } from "../whatsapp-cloud/format.js";
import { toInbound, type MediaDescriptor, type SelfIdentity } from "./messages.js";
import { jidFromTarget, phoneFromJid, whatsappChannelConfigSchema, type WhatsAppChannelConfig } from "./schema.js";

const MAX_TEXT_CHARS = 4000;
const MAX_IMAGE_BYTES = 16 * 1024 * 1024;
/** Largest inbound file we will fetch. Beyond this the message still reaches
 *  the agent with its caption and a note, which is more useful than silence
 *  and cheaper than pulling a phone video through the run pipeline. */
const MAX_INBOUND_BYTES = 12 * 1024 * 1024;
const MAX_FILE_BYTES = 64 * 1024 * 1024;
const BACKOFF_MIN_MS = 1_000;
const BACKOFF_MAX_MS = 60_000;
/** WhatsApp clears "composing" after ~10s, so it has to be re-sent while a
 *  run is still working. */
const TYPING_REFRESH_MS = 7_000;
/** Safety net: never leave a chat typing forever if a result never arrives. */
const TYPING_MAX_MS = 5 * 60 * 1_000;

export interface WhatsAppHandle {
  ctx: AccountRuntimeContext;
  sock: WASocket | null;
  self: SelfIdentity | null;
  stopped: boolean;
  attempt: number;
  reconnectTimer: NodeJS.Timeout | null;
  /** Ids of messages we sent; bounded, insertion-ordered. */
  sentIds: Set<string>;
  /** Per-chat "keep showing typing" timers. */
  typingTimers: Map<string, NodeJS.Timeout>;
}

function clearTypingTimer(handle: WhatsAppHandle, chatId: string): void {
  const timer = handle.typingTimers.get(chatId);
  if (!timer) return;
  clearInterval(timer);
  handle.typingTimers.delete(chatId);
}

function clearAllTypingTimers(handle: WhatsAppHandle): void {
  for (const timer of handle.typingTimers.values()) clearInterval(timer);
  handle.typingTimers.clear();
}

const SENT_IDS_MAX = 1000;

function rememberSent(handle: WhatsAppHandle, id: string | null | undefined): void {
  if (!id) return;
  handle.sentIds.add(id);
  while (handle.sentIds.size > SENT_IDS_MAX) {
    const oldest = handle.sentIds.values().next().value as string | undefined;
    if (oldest === undefined) break;
    handle.sentIds.delete(oldest);
  }
}

const baileysLogger = pino({ level: process.env["WHATSAPP_BAILEYS_LOG_LEVEL"] ?? "silent" });

function disconnectCode(error: unknown): number | undefined {
  const boom = error as { output?: { statusCode?: unknown } } | undefined;
  const code = boom?.output?.statusCode;
  return typeof code === "number" ? code : undefined;
}

function channelConfigOf(ctx: AccountRuntimeContext): WhatsAppChannelConfig {
  const parsed = whatsappChannelConfigSchema.safeParse(ctx.account.channelConfig ?? {});
  return parsed.success ? parsed.data : whatsappChannelConfigSchema.parse({});
}

async function connect(handle: WhatsAppHandle): Promise<void> {
  const { ctx } = handle;
  if (handle.stopped) return;
  const cfg = channelConfigOf(ctx);
  const { state, saveCreds } = await makeStoredAuthState(ctx.authState);
  const { version } = await fetchLatestBaileysVersion().catch(() => ({ version: undefined as [number, number, number] | undefined }));

  const sock = makeWASocket({
    ...(version ? { version } : {}),
    auth: { creds: state.creds, keys: makeCacheableSignalKeyStore(state.keys, baileysLogger) },
    logger: baileysLogger,
    browser: Browsers.ubuntu(cfg.deviceLabel),
    printQRInTerminal: false,
    markOnlineOnConnect: cfg.markOnline,
    syncFullHistory: false,
    generateHighQualityLinkPreview: false,
  });
  handle.sock = sock;

  sock.ev.on("creds.update", () => {
    void saveCreds().catch((err) => ctx.logger.warn(`[whatsapp] saveCreds failed: ${errMsg(err)}`));
  });

  sock.ev.on("connection.update", (update) => {
    void (async () => {
      if (update.qr) {
        await ctx.setState({ connState: "pending_login", loginArtifact: update.qr });
      }
      if (update.connection === "open") {
        handle.attempt = 0;
        const me = sock.user;
        const jid = me?.id ? jidNormalizedUser(me.id) : "";
        const self: SelfIdentity = { jid, ...(me?.lid ? { lid: me.lid } : {}) };
        handle.self = self;
        const phone = phoneFromJid(jid);
        await ctx.setState({
          connState: "connected",
          loginArtifact: null,
          selfId: jid,
          ...(me?.lid ? { selfAltId: me.lid } : {}),
          ...(phone ? { displayId: `+${phone}` } : {}),
        });
        ctx.logger.info(`[whatsapp] connected account=${ctx.account.id} as ${jid}`);
      }
      if (update.connection === "close") {
        const code = disconnectCode(update.lastDisconnect?.error);
        const reason = update.lastDisconnect?.error ? errMsg(update.lastDisconnect.error) : "closed";
        handle.sock = null;
        if (handle.stopped) return;
        if (code === DisconnectReason.loggedOut || code === DisconnectReason.forbidden) {
          await ctx.authState.clear().catch(() => undefined);
          await ctx.setState({ connState: "logged_out", loginArtifact: null });
          ctx.onClosed({ loggedOut: true, ...(code !== undefined ? { code } : {}), reason });
          return;
        }
        await ctx.setState({
          connState: "disconnected",
          lastDisconnect: { ...(code !== undefined ? { code } : {}), reason: reason.slice(0, 200), at: new Date().toISOString() },
        });
        scheduleReconnect(handle, code === DisconnectReason.restartRequired ? 0 : undefined);
      }
    })().catch((err) => ctx.logger.warn(`[whatsapp] connection.update handler failed: ${errMsg(err)}`));
  });

  sock.ev.on("messages.upsert", ({ messages, type }) => {
    if (type !== "notify" || !handle.self) return;
    const selfChat = channelConfigOf(ctx).selfChat;
    for (const message of messages) {
      const inbound = toInbound(message, handle.self, { sentIds: handle.sentIds, selfChat });
      if (!inbound) continue;
      void (async () => {
        if (inbound.media) {
          const attachment = await fetchAttachment(handle, message, inbound.media);
          if (attachment) inbound.attachments = [attachment];
          else if (!inbound.text) {
            // Nothing readable at all: say so rather than dropping it, so the
            // person is not left staring at an unanswered message.
            inbound.text = `[sent a ${inbound.media.kind} that could not be read]`;
          }
        }
        await ctx.onInbound(inbound);
      })().catch((err) => ctx.logger.warn(`[whatsapp] inbound handling failed: ${errMsg(err)}`));
    }
  });
}

function scheduleReconnect(handle: WhatsAppHandle, delayOverride?: number): void {
  if (handle.stopped) return;
  handle.attempt += 1;
  const base = Math.min(BACKOFF_MAX_MS, BACKOFF_MIN_MS * 2 ** Math.min(handle.attempt, 6));
  const delay = delayOverride ?? Math.round(base * (0.5 + Math.random()));
  handle.ctx.logger.info(`[whatsapp] reconnecting account=${handle.ctx.account.id} in ${delay}ms (attempt ${handle.attempt})`);
  handle.reconnectTimer = setTimeout(() => {
    handle.reconnectTimer = null;
    void connect(handle).catch((err) => {
      handle.ctx.logger.warn(`[whatsapp] reconnect failed: ${errMsg(err)}`);
      scheduleReconnect(handle);
    });
  }, delay);
  handle.reconnectTimer.unref();
}

/**
 * Fetch and decrypt one inbound file.
 *
 * WhatsApp media is encrypted on their CDN, so this is a real download plus a
 * decrypt, not a URL we could hand onward. Failure is deliberately not fatal:
 * the message still reaches the agent with its caption, because answering
 * "I can see your message but not the attachment" beats answering nothing.
 */
async function fetchAttachment(
  handle: WhatsAppHandle,
  message: WAMessage,
  media: MediaDescriptor,
): Promise<InboundAttachment | null> {
  if (media.sizeBytes > MAX_INBOUND_BYTES) {
    handle.ctx.logger.info(
      `[whatsapp] attachment too large (${media.sizeBytes} bytes) account=${handle.ctx.account.id}`,
    );
    return null;
  }
  try {
    const data = (await downloadMediaMessage(message, "buffer", {})) as Buffer;
    if (!Buffer.isBuffer(data) || data.length === 0) return null;
    if (data.length > MAX_INBOUND_BYTES) return null;
    return { fileName: media.fileName, mimeType: media.mimeType, data };
  } catch (err) {
    handle.ctx.logger.warn(`[whatsapp] attachment download failed: ${errMsg(err)}`);
    return null;
  }
}

function requireSock(handle: WhatsAppHandle): WASocket {
  if (!handle.sock) throw new Error("WhatsApp socket is not connected");
  return handle.sock;
}

function quotedOf(ref?: MessageRef) {
  const raw = ref?.raw as { key?: Record<string, unknown>; message?: Record<string, unknown> } | undefined;
  return raw?.key ? { quoted: raw as never } : {};
}

export const whatsappPlugin: ChannelPlugin<WhatsAppHandle, WhatsAppChannelConfig> = {
  key: "whatsapp",
  displayName: "WhatsApp",
  transport: "connection",
  login: { kind: "qr" },
  // Scanning the QR links THIS phone as a device of that number, so the
  // account is inseparable from the person who scanned it.
  accountScope: "user",
  capabilities: {
    groups: true,
    threads: false,
    reactions: true,
    typing: true,
    media: true,
    maxTextChars: MAX_TEXT_CHARS,
    maxInboundBytes: MAX_INBOUND_BYTES,
    maxImageBytes: MAX_IMAGE_BYTES,
    maxFileBytes: MAX_FILE_BYTES,
  },
  channelConfigSchema: whatsappChannelConfigSchema,

  async startAccount(ctx) {
    const handle: WhatsAppHandle = {
      ctx,
      sock: null,
      self: null,
      stopped: false,
      attempt: 0,
      reconnectTimer: null,
      sentIds: new Set(),
      typingTimers: new Map(),
    };
    await connect(handle);
    return handle;
  },

  async stopAccount(handle, reason: StopReason) {
    handle.stopped = true;
    if (handle.reconnectTimer) clearTimeout(handle.reconnectTimer);
    handle.reconnectTimer = null;
    clearAllTypingTimers(handle);
    const sock = handle.sock;
    handle.sock = null;
    if (!sock) return;
    if (reason === "logout") {
      // Unlink the device on the phone and forget the creds: this account
      // must be re-scanned to come back.
      await sock.logout().catch((err) => handle.ctx.logger.warn(`[whatsapp] logout failed: ${errMsg(err)}`));
      await handle.ctx.authState.clear().catch(() => undefined);
      return;
    }
    // shutdown / rebind / lease_lost: close without unlinking so the next
    // owner resumes the same session from the stored creds.
    sock.end(undefined);
  },

  async sendText(handle, chatId, text, opts) {
    const sock = requireSock(handle);
    const mentions = (opts?.mentions ?? []).map((m) => jidFromTarget(m)).filter((j): j is string => !!j);
    const sent = await sock.sendMessage(chatId, { text, ...(mentions.length ? { mentions } : {}) }, quotedOf(opts?.quoted));
    rememberSent(handle, sent?.key?.id);
    return { chatId, messageId: sent?.key?.id ?? "", raw: sent?.key ?? null };
  },

  async sendMedia(handle, chatId, file: OutboundFile, opts) {
    const sock = requireSock(handle);
    const isImage = file.mimeType.startsWith("image/") && file.data.length <= MAX_IMAGE_BYTES;
    const content = isImage
      ? { image: file.data, mimetype: file.mimeType, ...(opts?.caption ? { caption: opts.caption } : {}) }
      : { document: file.data, mimetype: file.mimeType, fileName: file.fileName, ...(opts?.caption ? { caption: opts.caption } : {}) };
    const sent = await sock.sendMessage(chatId, content);
    rememberSent(handle, sent?.key?.id);
    return { chatId, messageId: sent?.key?.id ?? "", raw: sent?.key ?? null };
  },

  /**
   * WhatsApp only relays a chat state from a device that is ONLINE, and it
   * clears "composing" after about ten seconds. Baileys sends `unavailable`
   * on connect unless markOnlineOnConnect is set, so a plain composing update
   * from a default account is never shown. Go available first, then refresh
   * the state on a timer until the run finishes.
   */
  async setTyping(handle, chatId, on) {
    const sock = handle.sock;
    if (!sock) return;
    clearTypingTimer(handle, chatId);
    const keepOnline = channelConfigOf(handle.ctx).markOnline;

    if (!on) {
      await sock.sendPresenceUpdate("paused", chatId).catch(() => undefined);
      // Back to invisible unless the admin asked for a permanently online number.
      if (!keepOnline) await sock.sendPresenceUpdate("unavailable").catch(() => undefined);
      return;
    }

    await sock.sendPresenceUpdate("available").catch(() => undefined);
    await sock.sendPresenceUpdate("composing", chatId);
    const startedAt = Date.now();
    const timer = setInterval(() => {
      const live = handle.sock;
      if (!live || handle.stopped || Date.now() - startedAt > TYPING_MAX_MS) {
        clearTypingTimer(handle, chatId);
        return;
      }
      void live.sendPresenceUpdate("composing", chatId).catch(() => undefined);
    }, TYPING_REFRESH_MS);
    timer.unref();
    handle.typingTimers.set(chatId, timer);
  },

  async react(handle, ref, emoji) {
    const sock = requireSock(handle);
    const raw = ref.raw as { key?: { remoteJid?: string; id?: string; fromMe?: boolean; participant?: string } } | undefined;
    if (!raw?.key?.id) return;
    const sent = await sock.sendMessage(ref.chatId, { react: { text: emoji, key: raw.key } });
    rememberSent(handle, sent?.key?.id);
  },

  formatText: formatForWhatsApp,

  async resolveTarget(handle, target) {
    const direct = jidFromTarget(target);
    if (direct) {
      // A phone number must actually be on WhatsApp, else sendMessage silently fails.
      if (direct.endsWith("@s.whatsapp.net")) {
        const sock = requireSock(handle);
        const results = await sock.onWhatsApp(direct).catch(() => undefined);
        const hit = results?.[0];
        return hit?.exists ? hit.jid : null;
      }
      return direct;
    }
    // Otherwise treat it as a group name.
    const groups = await listGroups(handle);
    const wanted = target.trim().toLowerCase();
    const hit = groups.find((g) => g.name.toLowerCase() === wanted) ?? groups.find((g) => g.name.toLowerCase().includes(wanted));
    return hit?.id ?? null;
  },

  listGroups,

  senderIdFromPhone(phone) {
    const jid = jidFromTarget(phone);
    // Only a real phone number can be linked — a group id is not a person.
    return jid?.endsWith("@s.whatsapp.net") ? jid : null;
  },
};

async function listGroups(handle: WhatsAppHandle): Promise<Array<{ id: string; name: string; participants: number }>> {
  const sock = requireSock(handle);
  const all = await sock.groupFetchAllParticipating();
  return Object.values(all)
    .map((g) => ({ id: g.id, name: g.subject ?? "", participants: g.participants?.length ?? 0 }))
    .sort((a, b) => a.name.localeCompare(b.name));
}
