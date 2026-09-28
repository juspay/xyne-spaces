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
import { MAX_INBOUND_BYTES, TYPING_MAX_MS } from "../messaging/const.js";
import { makeStoredAuthState } from "./auth-state.js";
import { formatForWhatsApp } from "../whatsapp-shared/format.js";
import { toInbound, type MediaDescriptor, type SelfIdentity } from "./messages.js";
import { jidFromTarget, phoneFromJid, whatsappChannelConfigSchema, type WhatsAppChannelConfig } from "./schema.js";

const MAX_TEXT_CHARS = 4000;
const MAX_IMAGE_BYTES = 16 * 1024 * 1024;
const MAX_FILE_BYTES = 64 * 1024 * 1024;
const BACKOFF_MIN_MS = 1_000;
const BACKOFF_MAX_MS = 60_000;
/** WhatsApp clears "composing" after ~10s, so it has to be re-sent while a
 *  run is still working. */
const TYPING_REFRESH_MS = 7_000;

export interface WhatsAppHandle {
  ctx: AccountRuntimeContext;
  sock: WASocket | null;
  stopped: boolean;
  attempt: number;
  reconnectTimer: NodeJS.Timeout | null;
  /** Ids of messages we sent; bounded, insertion-ordered. */
  sentIds: Set<string>;
  /** Per-chat "keep showing typing" timers. */
  typingTimers: Map<string, NodeJS.Timeout>;
  /** Last time this socket produced any sign of life. */
  lastSeenAt: number;
  watchdogTimer: NodeJS.Timeout | null;
  /** QR codes shown since the last successful login. Nobody scanning is a
   *  normal outcome, not an error to retry forever. */
  qrRounds: number;
  /** Per-group LID → phone-JID map, from the group's own participant list.
   *  Short-lived: membership changes, and a stale map would mis-attribute a
   *  message to the wrong person. */
  lidMaps: Map<string, { at: number; byLid: Map<string, string> }>;
}

const LID_MAP_TTL_MS = 10 * 60 * 1_000;
/** WhatsApp rotates the QR every ~20s. Ten of them is several minutes of
 *  nobody scanning, which means nobody is going to. */
const MAX_QR_ROUNDS = 10;
/** How often the watchdog looks. */
const WATCHDOG_INTERVAL_MS = 30_000;
/** Silence long enough to be worth probing. A real account can legitimately
 *  hear nothing for hours, so silence alone never triggers a reconnect — it
 *  only triggers a question. */
const WATCHDOG_PROBE_AFTER_MS = 10 * 60_000;

/**
 * Turn a group participant's LID into their phone JID.
 *
 * Groups on newer WhatsApp address participants by LID, and the key does not
 * always carry the phone-number twin. Every identity we store — linked
 * numbers, allowlists — is a phone number, so a LID-only sender matches
 * nothing and is told to register a number they have already registered. The
 * group's own participant list carries both forms, so ask it.
 */
async function phoneForGroupLid(handle: WhatsAppHandle, groupJid: string, lid: string): Promise<string | null> {
  const cached = handle.lidMaps.get(groupJid);
  // A fresh map that does not list this LID is an answer, not a miss.
  // Re-fetching for someone the group never names would call groupMetadata
  // once per message they send.
  if (cached && Date.now() - cached.at < LID_MAP_TTL_MS) return cached.byLid.get(lid) ?? null;
  return (await loadGroupLidMap(handle, groupJid))?.get(lid) ?? null;
}

/**
 * Our own LID, read off a group's participant list. A group @mention names
 * us by LID, and a login that came without one leaves `sameUser` nothing to
 * match it against — so every mention of the owner reads as "not mentioned".
 */
async function ownLidFromGroup(handle: WhatsAppHandle, groupJid: string, selfJid: string): Promise<string | null> {
  const cached = handle.lidMaps.get(groupJid);
  const byLid =
    cached && Date.now() - cached.at < LID_MAP_TTL_MS ? cached.byLid : await loadGroupLidMap(handle, groupJid);
  for (const [lid, phone] of byLid ?? []) if (phone === selfJid) return lid;
  return null;
}

async function loadGroupLidMap(handle: WhatsAppHandle, groupJid: string): Promise<Map<string, string> | null> {
  const sock = handle.sock;
  if (!sock) return null;
  try {
    const meta = await sock.groupMetadata(groupJid);
    const byLid = new Map<string, string>();
    for (const participant of meta.participants ?? []) {
      const phone = participant.jid ?? (participant.id.endsWith("@s.whatsapp.net") ? participant.id : undefined);
      const participantLid = participant.lid ?? (participant.id.endsWith("@lid") ? participant.id : undefined);
      if (phone && participantLid) byLid.set(jidNormalizedUser(participantLid), jidNormalizedUser(phone));
    }
    handle.lidMaps.set(groupJid, { at: Date.now(), byLid });
    return byLid;
  } catch (err) {
    handle.ctx.logger.warn(`[whatsapp] group metadata lookup failed for ${groupJid}: ${errMsg(err)}`);
    return null;
  }
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

/**
 * Belt and braces over Baileys' own keepalive.
 *
 * Baileys pings every 30s and ends the connection after ~35s of silence — but
 * that only helps when the ending reaches us. If its timer dies, or the close
 * never surfaces as a connection.update, the account sits in `connected` with
 * a socket nobody is listening to: no error, no reconnect, and every message
 * sent to that number is simply never answered. Nothing else notices, which
 * is what makes it worth a separate check.
 *
 * Two signals, deliberately different in kind:
 *  - the WebSocket is not open while we still believe we are connected. That
 *    is a contradiction, not a judgement call, so it reconnects at once.
 *  - nothing has been heard for a long time. A quiet number is normal, so
 *    this never reconnects on its own — it asks the server a question, and
 *    only a failed answer counts as evidence.
 */
function startWatchdog(handle: WhatsAppHandle): void {
  stopWatchdog(handle);
  const timer = setInterval(() => {
    void (async () => {
      const sock = handle.sock;
      if (handle.stopped || !sock) return;
      const account = handle.ctx.account.id;

      if (!sock.ws.isOpen) {
        handle.ctx.logger.warn(`[whatsapp] watchdog: socket closed without notice account=${account}; reconnecting`);
        forceReconnect(handle);
        return;
      }

      if (Date.now() - handle.lastSeenAt < WATCHDOG_PROBE_AFTER_MS) return;
      try {
        await sock.query({ tag: "iq", attrs: { to: "s.whatsapp.net", type: "get", xmlns: "w:p" }, content: [{ tag: "ping", attrs: {} }] });
        handle.lastSeenAt = Date.now();
      } catch (err) {
        handle.ctx.logger.warn(`[whatsapp] watchdog: ping failed account=${account}: ${errMsg(err)}; reconnecting`);
        forceReconnect(handle);
      }
    })().catch(() => undefined);
  }, WATCHDOG_INTERVAL_MS);
  timer.unref();
  handle.watchdogTimer = timer;
}

function stopWatchdog(handle: WhatsAppHandle): void {
  if (handle.watchdogTimer) clearInterval(handle.watchdogTimer);
  handle.watchdogTimer = null;
}

/** Drop the socket ourselves and come back. `end` makes Baileys emit the
 *  close we never got, which is what the normal reconnect path listens for;
 *  scheduling directly as well would race it into two sockets. */
function forceReconnect(handle: WhatsAppHandle): void {
  const sock = handle.sock;
  handle.sock = null;
  stopWatchdog(handle);
  try {
    sock?.end(new Error("watchdog: connection appears dead"));
  } catch {
    // An end() that throws has already lost the socket, which is the point.
  }
  scheduleReconnect(handle);
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

/**
 * Who this connection is: read from the socket every time, and never allowed
 * to forget the LID once it is known.
 *
 * Two traps here, both of which end with the owner's own chat looking like a
 * stranger's DM (WhatsApp addresses it as `<ownLid>@lid`, so without the LID
 * `sameUser` fails and dmPolicy refuses it).
 *
 * `sock.user` IS `authState.creds.me`, so a snapshot taken on connection-open
 * cannot see a later change — hence reading it per message.
 *
 * And Baileys rewrites the whole `me` object on every login:
 *   ev.emit('creds.update', { me: { ...creds.me, lid: node.attrs.lid } })
 * so a success node that omits `lid` overwrites a known LID with undefined,
 * which saveCreds then persists. The account's stored selfAltId is therefore
 * the durable copy, and it wins whenever the socket has nothing to offer.
 */
export function selfOf(handle: WhatsAppHandle): SelfIdentity | null {
  const me = handle.sock?.user;
  if (!me?.id) return null;
  const lid = me.lid ?? handle.ctx.account.config.selfAltId;
  return { jid: jidNormalizedUser(me.id), ...(lid ? { lid } : {}) };
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

  // Anything arriving at all resets the watchdog's silence clock.
  const alive = () => {
    handle.lastSeenAt = Date.now();
  };

  sock.ev.on("creds.update", () => {
    alive();
    void saveCreds().catch((err) => ctx.logger.warn(`[whatsapp] saveCreds failed: ${errMsg(err)}`));
    // Keep the durable copy current. Only ever writes a real value, so a login
    // that arrives without a LID leaves the last known one in place.
    const lid = sock.user?.lid;
    if (lid && lid !== ctx.account.config.selfAltId) void ctx.setState({ selfAltId: lid });
  });

  sock.ev.on("connection.update", (update) => {
    alive();
    void (async () => {
      if (update.qr) {
        handle.qrRounds += 1;
        await ctx.setState({ connState: "pending_login", loginArtifact: update.qr });
      }
      if (update.connection === "open") {
        handle.attempt = 0;
        handle.qrRounds = 0;
        startWatchdog(handle);
        const me = sock.user;
        const jid = me?.id ? jidNormalizedUser(me.id) : "";
        const phone = phoneFromJid(jid);
        await ctx.setState({
          connState: "connected",
          loginArtifact: null,
          selfId: jid,
          ...(me?.lid ? { selfAltId: me.lid } : {}),
          ...(phone ? { displayId: `+${phone}` } : {}),
        });
        ctx.logger.info(`[whatsapp] connected account=${ctx.account.id} as ${jid} lid=${me?.lid ?? "(none yet)"}`);
      }
      if (update.connection === "close") {
        const code = disconnectCode(update.lastDisconnect?.error);
        const reason = update.lastDisconnect?.error ? errMsg(update.lastDisconnect.error) : "closed";
        handle.sock = null;
        stopWatchdog(handle);
        if (handle.stopped) return;
        if (code === DisconnectReason.loggedOut || code === DisconnectReason.forbidden) {
          await ctx.authState.clear().catch(() => undefined);
          await ctx.setState({ connState: "logged_out", loginArtifact: null });
          ctx.onClosed({ loggedOut: true, ...(code !== undefined ? { code } : {}), reason });
          return;
        }
        // Nobody has scanned the QR. Baileys times out, we show another, and
        // that repeats for as long as the pod lives — each round writing a
        // lastDisconnect nobody reads. Stop and let the admin start again.
        if (handle.qrRounds >= MAX_QR_ROUNDS) {
          ctx.logger.warn(`[whatsapp] QR not scanned after ${handle.qrRounds} codes account=${ctx.account.id}; giving up`);
          await ctx.setState({ connState: "disconnected", loginArtifact: null });
          ctx.onClosed({ loggedOut: false, stop: true, reason: "QR was not scanned" });
          return;
        }
        // While a QR is on screen the account is not "disconnected", it is
        // waiting to be scanned — and a row written per rotation is churn.
        if (handle.qrRounds === 0) {
          await ctx.setState({
            connState: "disconnected",
            lastDisconnect: { ...(code !== undefined ? { code } : {}), reason: reason.slice(0, 200), at: new Date().toISOString() },
          });
        }
        // Credentials the server rejects do not heal by being retried: every
        // reconnect re-presents the same broken session.
        if (code === DisconnectReason.badSession) {
          ctx.logger.warn(`[whatsapp] bad session account=${ctx.account.id}; not reconnecting — re-link the number`);
          ctx.onClosed({ loggedOut: false, stop: true, ...(code !== undefined ? { code } : {}), reason });
          return;
        }
        // 440 means WhatsApp accepted another session for this number —
        // almost always the pod that has just taken the lease from us.
        // Reconnecting would replace it right back, and the two pods spend
        // the rest of their lives kicking each other off. Hand the account
        // to the core instead: it releases the lease and the sweep re-owns
        // it only if it really is ours.
        if (code === DisconnectReason.connectionReplaced) {
          ctx.logger.warn(`[whatsapp] session replaced elsewhere account=${ctx.account.id}; not reconnecting`);
          ctx.onClosed({ loggedOut: false, ...(code !== undefined ? { code } : {}), reason });
          return;
        }
        scheduleReconnect(handle, code === DisconnectReason.restartRequired ? 0 : undefined);
      }
    })().catch((err) => ctx.logger.warn(`[whatsapp] connection.update handler failed: ${errMsg(err)}`));
  });

  sock.ev.on("messages.upsert", ({ messages, type }) => {
    alive();
    const self = selfOf(handle);
    if (type !== "notify" || !self) return;
    const selfChat = channelConfigOf(ctx).selfChat;
    for (const message of messages) {
      const first = toInbound(message, self, { sentIds: handle.sentIds });
      if (!first) continue;
      // "My own chat: off" means silence, not "fall through to the DM rules" —
      // otherwise a number that answers other people's DMs would answer the
      // owner's notes to self as well, which is not what the switch says.
      if (first.selfChat && !selfChat) {
        ctx.logger.info(`[whatsapp] own-chat message ignored ("My own chat" is off) account=${ctx.account.id}`);
        continue;
      }
      void (async () => {
        let inbound = first;
        if (inbound.isGroup && !self.lid) {
          const lid = await ownLidFromGroup(handle, inbound.chatId, self.jid);
          if (lid) {
            await ctx.setState({ selfAltId: lid });
            inbound = toInbound(message, { ...self, lid }, { sentIds: handle.sentIds }) ?? inbound;
          }
        }
        // Deliberately not fetched here. Downloading and decrypting every photo
        // in every group before policy has had a say is the account's largest
        // pointless cost — with DMs off, none of it is ever used.
        const media = inbound.media;
        if (media) {
          inbound.mediaKind = media.kind;
          inbound.loadAttachments = async () => {
            const attachment = await fetchAttachment(handle, message, media);
            return attachment ? [attachment] : [];
          };
        }
        // A LID-only group sender resolves to nothing in our identity tables,
        // so trade it for the phone number the group itself knows.
        if (inbound.isGroup && inbound.senderId.endsWith("@lid")) {
          const phone = await phoneForGroupLid(handle, inbound.chatId, inbound.senderId);
          if (phone) inbound.senderId = phone;
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
    reactions: true,
    typing: true,
    media: true,
    maxTextChars: MAX_TEXT_CHARS,
    maxImageBytes: MAX_IMAGE_BYTES,
    maxFileBytes: MAX_FILE_BYTES,
  },
  channelConfigSchema: whatsappChannelConfigSchema,

  async startAccount(ctx) {
    const handle: WhatsAppHandle = {
      ctx,
      sock: null,
      stopped: false,
      attempt: 0,
      reconnectTimer: null,
      sentIds: new Set(),
      typingTimers: new Map(),
      lidMaps: new Map(),
      qrRounds: 0,
      lastSeenAt: Date.now(),
      watchdogTimer: null,
    };
    await connect(handle);
    return handle;
  },

  async stopAccount(handle, reason: StopReason) {
    handle.stopped = true;
    if (handle.reconnectTimer) clearTimeout(handle.reconnectTimer);
    handle.reconnectTimer = null;
    stopWatchdog(handle);
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
      // "unavailable" is account-wide, not per chat: sending it while another
      // run is still typing somewhere else would stop that chat's indicator
      // too. Only go invisible once this was the last one.
      if (!keepOnline && handle.typingTimers.size === 0) {
        await sock.sendPresenceUpdate("unavailable").catch(() => undefined);
      }
      return;
    }

    const announce = async (sock: WASocket): Promise<void> => {
      // Both, every time. WhatsApp only relays a chat state from a device it
      // believes is ONLINE, and that belief expires server-side — so sending
      // "available" once at the start means the refreshes are silently
      // ignored from then on. The indicator drops mid-run and only returns
      // when the next run happens to announce presence again.
      await sock.sendPresenceUpdate("available").catch(() => undefined);
      await sock.sendPresenceUpdate("composing", chatId).catch(() => undefined);
    };

    await announce(sock);
    const startedAt = Date.now();
    const timer = setInterval(() => {
      const live = handle.sock;
      if (!live || handle.stopped || Date.now() - startedAt > TYPING_MAX_MS) {
        clearTypingTimer(handle, chatId);
        return;
      }
      void announce(live);
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
    const exact = groups.find((g) => g.name.toLowerCase() === wanted);
    if (exact) return exact.id;
    // A substring only counts when it names exactly one group. "dev" matching
    // both "dev" and "dev-ops-oncall" must not quietly pick one and send
    // somebody's message to the wrong room.
    const partial = groups.filter((g) => g.name.toLowerCase().includes(wanted));
    if (partial.length === 1) return partial[0]!.id;
    if (partial.length > 1) {
      handle.ctx.logger.info(
        `[whatsapp] "${target}" matches ${partial.length} groups account=${handle.ctx.account.id}; refusing to guess`,
      );
    }
    return null;
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
