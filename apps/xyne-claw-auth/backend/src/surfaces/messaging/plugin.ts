/**
 * The messaging-channel plugin contract.
 *
 * A "channel" is a consumer messenger (WhatsApp, Telegram, Discord, Signal, …)
 * on which an org connects one or more ACCOUNTS (a phone number, a bot token)
 * and lets people talk to Claw agents by messaging that account. Everything
 * that is the same across messengers — account rows, pod placement, policy,
 * identity, agent routing, run dispatch, result delivery, the admin API — lives
 * ONCE in this folder. A plugin only knows how to talk to its messenger:
 * connect an account, turn native messages into `InboundMessage`, and send
 * text/media back.
 *
 * Two transport shapes are supported:
 *  - "connection": the plugin owns a long-lived connection (WhatsApp Web
 *    socket, Telegram long polling). The account manager leases each account
 *    to exactly one pod and calls startAccount/stopAccount there.
 *  - "webhook": the messenger POSTs to us. The core mounts
 *    POST /surfaces/:channel/webhook/:accountId and calls
 *    verifySignature/parseInbound; there is nothing to keep running.
 *
 * Adding a channel = one plugin module + one `surfaces` seed row + its key in
 * MESSAGING_CHANNEL_KEYS. No core edits.
 */
import type { IncomingHttpHeaders } from "node:http";
import type { ZodType } from "zod";
import type { Logger } from "../../logger.js";
import type { AccountConfig } from "./schema.js";

/** Every channel key the core may see. Keep in sync with the `surfaces` seed
 *  rows; the type keeps `triggerSource` unions closed and greppable. */
export const MESSAGING_CHANNEL_KEYS = ["whatsapp", "whatsapp-cloud"] as const;
export type MessagingChannelKey = (typeof MESSAGING_CHANNEL_KEYS)[number];

export function isMessagingChannelKey(value: unknown): value is MessagingChannelKey {
  return typeof value === "string" && (MESSAGING_CHANNEL_KEYS as readonly string[]).includes(value);
}

/**
 * Who an account on this channel belongs to.
 *
 *  - "org": one account serves the whole organisation. A business number that
 *    many people message, connected once by an admin, with each person's own
 *    number linked to their Claw user. WhatsApp Cloud API.
 *  - "user": one account belongs to one person — it IS their number, linked by
 *    scanning a QR with their own phone, and it is their personal assistant.
 *    Any org member may connect one for themselves without an admin, and only
 *    they (or an admin) can see or manage it. WhatsApp over Baileys.
 */
export type AccountScope = "org" | "user";

export type ConnState = "pending_login" | "connected" | "disconnected" | "logged_out";
export type LoginKind = "qr" | "token";
export type ChannelTransport = "connection" | "webhook";
export type StopReason = "shutdown" | "logout" | "rebind" | "lease_lost";

export interface ChannelCapabilities {
  groups: boolean;
  reactions: boolean;
  typing: boolean;
  media: boolean;
  /** Hard per-message text limit of the messenger; the core chunks to it. */
  maxTextChars: number;
  maxImageBytes?: number;
  maxFileBytes?: number;
  /** Present only when the messenger renders tappable cards natively. The
   *  numbers are the messenger's hard caps, not our preference: the core
   *  trims to them and falls back to numbered text when this is absent. */
  interactive?: InteractiveLimits;
}

/** What a messenger will accept in one interactive message. */
export interface InteractiveLimits {
  /** Reply buttons per card (WhatsApp: 3). */
  buttons: number;
  buttonTitleChars: number;
  /** Rows across ALL sections of a list (WhatsApp: 10). */
  listRows: number;
  rowTitleChars: number;
  rowDescriptionChars: number;
  bodyChars: number;
  headerChars: number;
  footerChars: number;
  /** A single button that opens a URL instead of replying. */
  cta: boolean;
}

/** One tappable option. The `id` comes back to us verbatim on the reply, so it
 *  is the correlation handle between what we offered and what was chosen. */
export interface CardButton {
  id: string;
  title: string;
}

export interface CardListRow extends CardButton {
  description?: string;
}

export interface CardListSection {
  title?: string;
  rows: CardListRow[];
}

/**
 * A channel-neutral card. Plugins that declare `capabilities.interactive`
 * render it natively; everyone else gets `renderCardAsText` (cards.ts), which
 * is why every variant must be answerable in words alone.
 */
export type InteractiveCard =
  | { kind: "buttons"; body: string; header?: string; footer?: string; buttons: CardButton[] }
  | { kind: "list"; body: string; header?: string; footer?: string; button: string; sections: CardListSection[] }
  | { kind: "cta"; body: string; header?: string; footer?: string; label: string; url: string };

/** Opaque reference to a message on the messenger (for quoting / reacting). */
export interface MessageRef {
  chatId: string;
  messageId: string;
  /** Plugin residue needed to address the message again (e.g. Baileys key). */
  raw?: unknown;
}

/** A native message normalised by the plugin. Ids are messenger ids: for
 *  WhatsApp a JID, for Telegram a chat/user id as a string. */
export interface InboundMessage {
  messageId: string;
  chatId: string;
  senderId: string;
  senderName?: string;
  isGroup: boolean;
  text: string;
  /** The account itself was @mentioned (native mention), for group gating. */
  mentionedSelf: boolean;
  /** The message quotes/replies to one the account sent. */
  replyToSelf: boolean;
  /** Sent by the account itself (own echo) — always dropped by the core. */
  fromSelf: boolean;
  /** Typed by the person who owns this account, on the device they linked —
   *  in any chat, including groups. Distinct from `fromSelf`, which is the
   *  account's own outgoing message echoed back to us. Only a plugin whose
   *  transport sees the owner's own traffic (a linked device) sets this. */
  fromOwner?: boolean;
  /** The account owner talking to their own number (WhatsApp "You" chat).
   *  Runs as the owner, with no identity row to look up. Plugins set this only
   *  for messages they did NOT send themselves. */
  selfChat?: boolean;
  ref: MessageRef;
  /** Files attached to the message. Present only when the plugin could fetch
   *  them within the size cap — a message whose media was too large or failed
   *  to download still arrives, carrying its caption, so the agent answers
   *  about what it can see rather than silently ignoring the person. */
  attachments?: InboundAttachment[];
  /** Fetch the message's files on demand. Set instead of `attachments` by
   *  plugins whose media costs a network round trip and a decrypt: the core
   *  calls it only once the message has passed policy, so a chat the account
   *  ignores never pays to download the photos sent in it. */
  loadAttachments?: () => Promise<InboundAttachment[]>;
  /** What kind of file is waiting, so the core can say "a video that could
   *  not be read" without knowing anything about the channel's media model. */
  mediaKind?: string;
  /** Work out who really sent this, when the channel's cheap answer is not
   *  the one identities are keyed by (WhatsApp addresses group members by
   *  LID). Called by the core inside the per-chat queue and only for a chat
   *  the account might answer in, so ordering holds and an ignored group
   *  costs nothing. Returns null to keep the id the plugin already set. */
  resolveSenderId?: () => Promise<string | null>;
  /** The person tapped a button or list row on a card WE sent; this is that
   *  option's `id`. Set only by plugins with native cards — a text fallback
   *  comes back as ordinary text and is matched by cards.ts instead. */
  cardReplyId?: string;
  timestamp?: number;
  raw?: unknown;
}

/** A file someone sent us, already fetched and decrypted by the plugin. */
export interface InboundAttachment {
  fileName: string;
  mimeType: string;
  data: Buffer;
}

export interface OutboundFile {
  fileName: string;
  mimeType: string;
  data: Buffer;
}

/** The account as plugins see it. `config` is the core, channel-neutral part;
 *  `channelConfig` is the plugin's own residue (validated by its schema). */
export interface ChannelAccount {
  id: string;
  orgId: string;
  channel: MessagingChannelKey;
  /** `surfaces.id` of the channel row; also the identity key. */
  surfaceId: string;
  accountKey: string;
  config: AccountConfig;
  channelConfig: unknown;
}

/** Encrypted per-account key/value persistence handed to a plugin: everything
 *  it needs to authenticate as this account, from a bot token to a full Signal
 *  key store. One row per key. */
export interface AuthStateStore {
  get(category: string, keyId?: string): Promise<string | null>;
  getMany(category: string, keyIds: string[]): Promise<Map<string, string>>;
  set(category: string, keyId: string, value: string): Promise<void>;
  /** Batched write; a null value deletes. Atomic. */
  setMany(entries: Array<{ category: string; keyId: string; value: string | null }>): Promise<void>;
  delete(category: string, keyId?: string): Promise<void>;
  clear(): Promise<void>;
}

export interface AccountStatePatch {
  connState?: ConnState;
  /** What the admin must act on to finish login: a QR string, a device code.
   *  Kept in Redis (short TTL), never in Postgres. `null` clears it. */
  loginArtifact?: string | null;
  /** The account's own id on the messenger (WhatsApp JID, bot user id). */
  selfId?: string;
  /** A second self id some messengers use (WhatsApp LID). */
  selfAltId?: string;
  /** Human-readable identity (phone number, @botname). */
  displayId?: string;
  lastDisconnect?: { code?: number; reason?: string; at: string };
}

export interface ClosedInfo {
  loggedOut: boolean;
  /** Retrying cannot help (QR never scanned, broken session): park the
   *  account until the admin logs in again, rather than letting the next
   *  sweep restart it. */
  stop?: boolean;
  reason?: string;
  code?: number;
}

/** What the core hands a connection plugin when it starts an account. */
export interface AccountRuntimeContext {
  /** Live, not a snapshot: re-read it per message so a config change lands
   *  without waiting for a reconnect. */
  readonly account: ChannelAccount;
  onInbound(msg: InboundMessage): Promise<void>;
  setState(patch: AccountStatePatch): Promise<void>;
  /** The plugin's transport ended for good (logged out / unrecoverable). The
   *  core stops the account; the plugin must NOT reconnect after this. Normal
   *  reconnects are the plugin's own business while it is running. */
  onClosed(info: ClosedInfo): void;
  authState: AuthStateStore;
  logger: Logger;
}

export interface ChannelPlugin<Handle = unknown, ChannelConfig = unknown> {
  readonly key: MessagingChannelKey;
  readonly displayName: string;
  readonly capabilities: ChannelCapabilities;
  readonly login: { kind: LoginKind };
  /** Whether one account serves the org or one person. Drives who may create
   *  and manage accounts here, who may see them, and whether the account may
   *  answer strangers at all. */
  readonly accountScope: AccountScope;
  /** Values an admin must supply for a `token` login (tokens, ids, secrets).
   *  Each is stored encrypted under its `key` in the account's auth state. */
  readonly loginFields?: ReadonlyArray<{
    key: string;
    label: string;
    type: "text" | "password";
    placeholder?: string;
    hint?: string;
  }>;
  readonly transport: ChannelTransport;
  /** Validates `ConnectedSurface.config.channel`. Optional: no residue. */
  readonly channelConfigSchema?: ZodType<ChannelConfig>;

  // ── "connection" transport ──
  startAccount?(ctx: AccountRuntimeContext): Promise<Handle>;
  stopAccount?(handle: Handle, reason: StopReason): Promise<void>;

  // ── "webhook" transport ──
  verifySignature?(
    rawBody: Buffer,
    headers: IncomingHttpHeaders,
    account: ChannelAccount,
    authState: AuthStateStore,
  ): Promise<boolean> | boolean;
  /** `authState` is handed over because a webhook payload names its media by
   *  id, not by URL: fetching the bytes needs the account's own credentials,
   *  and the webhook can land on any pod, including one holding no handle. */
  parseInbound?(payload: unknown, account: ChannelAccount, authState: AuthStateStore): InboundMessage[];
  /** Provider handshake that proves we own the endpoint (Meta's GET with
   *  hub.verify_token). Return true to echo the challenge back. */
  verifyChallenge?(account: ChannelAccount, authState: AuthStateStore, token: string): Promise<boolean>;
  /** Webhook plugins have no running handle; they open a client per send. */
  openHandle?(account: ChannelAccount, authState: AuthStateStore): Promise<Handle>;
  /** Who this account is on the messenger, asked once when it comes up. A
   *  connection plugin reports this through ctx.setState as it connects; a
   *  webhook plugin has no such moment, and without it  account never
   *  learns its own number — which is what the "message this number" half of
   *  number linking needs. Failure is not fatal: the account still runs. */
  describeHandle?(handle: Handle): Promise<{ selfId?: string; displayId?: string }>;

  // ── outbound ──
  sendText(handle: Handle, chatId: string, text: string, opts?: { quoted?: MessageRef; mentions?: string[] }): Promise<MessageRef>;
  sendMedia?(handle: Handle, chatId: string, file: OutboundFile, opts?: { caption?: string }): Promise<MessageRef>;
  /** Send a card natively. Only called when `capabilities.interactive` is set;
   *  the core has already trimmed the card to those limits. */
  sendInteractive?(handle: Handle, chatId: string, card: InteractiveCard, opts?: { quoted?: MessageRef }): Promise<MessageRef>;
  /** `messageId` is the inbound message being answered. Some messengers tie
   *  the indicator to marking that message read (WhatsApp Cloud) rather than
   *  to the chat, so the core passes it through whenever it has one. */
  setTyping?(handle: Handle, chatId: string, on: boolean, opts?: { messageId?: string }): Promise<void>;
  react?(handle: Handle, ref: MessageRef, emoji: string): Promise<void>;
  /** Markdown → the messenger's dialect. Default: text passes through. */
  formatText?(markdown: string): string;

  // ── agent actions (optional; used by the channel tool set) ──
  /** Turn a human target ("+91 98765…", "…@g.us", a group name) into a chat id.
   *  Returns null when it cannot be resolved. */
  resolveTarget?(handle: Handle, target: string): Promise<string | null>;
  /** Groups the account is a member of. */
  listGroups?(handle: Handle): Promise<Array<{ id: string; name: string; participants: number }>>;

  /** A phone number a person typed → the sender id this channel will report
   *  when they message from it. WhatsApp Cloud reports bare digits, Baileys a
   *  JID, so only the plugin can bridge the two. Null when the input is not a
   *  number this channel could ever see. Channels with no phone-number
   *  identity (a bot platform) simply omit it, and number linking is then not
   *  offered for them. */
  senderIdFromPhone?(phone: string): string | null;
}

/** Where a run's reply goes. Rides in the SessionContext; channel-neutral. */
export interface ChannelDeliveryTarget {
  channel: MessagingChannelKey;
  connectedSurfaceId: string;
  accountKey: string;
  chatId: string;
  senderId: string;
  isGroup: boolean;
  quoted?: MessageRef;
  /** Replace the ack reaction on the triggering message when the run ends.
   *  Carried on the target because the result comes back on a pod that has
   *  no idea what this account's reaction settings are. */
  statusReactions?: boolean;
}

// ── registry ──

export type AnyChannelPlugin = ChannelPlugin<unknown, unknown>;

const plugins = new Map<MessagingChannelKey, AnyChannelPlugin>();

export function registerChannel<H, C>(plugin: ChannelPlugin<H, C>): void {
  if (plugin.transport === "connection" && (!plugin.startAccount || !plugin.stopAccount)) {
    throw new Error(`channel "${plugin.key}": connection transport requires startAccount/stopAccount`);
  }
  if (plugin.transport === "webhook" && (!plugin.verifySignature || !plugin.parseInbound || !plugin.openHandle)) {
    throw new Error(`channel "${plugin.key}": webhook transport requires verifySignature/parseInbound/openHandle`);
  }
  plugins.set(plugin.key, plugin as unknown as AnyChannelPlugin);
}

export function getChannel(key: string): AnyChannelPlugin | undefined {
  return isMessagingChannelKey(key) ? plugins.get(key) : undefined;
}

export function listChannels(): AnyChannelPlugin[] {
  return [...plugins.values()];
}
