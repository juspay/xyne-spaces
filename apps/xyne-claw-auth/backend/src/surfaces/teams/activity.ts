/**
 * A Bot Framework activity from Teams → the core InboundMessage shape. Pure,
 * so the mapping is testable without a tenant.
 *
 * Conversation model, and how it maps onto claw conversations:
 *  - personal  a 1:1 chat with the bot. `conversation.id` ("a:…") is stable
 *              for that person and bot, so the chat is one conversation.
 *  - groupChat a group chat ("19:…@thread.v2"). One conversation per chat.
 *  - channel   a channel post. Teams addresses the post's reply thread as
 *              "19:…@thread.tacv2;messageid=<root>", so every thread is its
 *              own conversation, and sending to that id replies in the thread.
 *
 * The chat id handed to the core is that conversation id, unchanged except for
 * a top-level channel post that arrives without its ";messageid=" suffix, which
 * gets it — otherwise the reply would open a new post instead of threading.
 */
import type { InboundMessage } from "../messaging/plugin.js";
import { TEAMS_CHANNEL_ID } from "./schema.js";

export type TeamsConversationType = "personal" | "groupChat" | "channel";

interface ChannelAccountRef {
  id?: string;
  name?: string;
  aadObjectId?: string;
}

interface MentionEntity {
  type?: string;
  text?: string;
  mentioned?: { id?: string; name?: string };
}

/** The fields of an activity this plugin reads. */
export interface TeamsActivity {
  type?: string;
  id?: string;
  timestamp?: string;
  serviceUrl?: string;
  channelId?: string;
  from?: ChannelAccountRef;
  recipient?: ChannelAccountRef;
  conversation?: { id?: string; conversationType?: string; tenantId?: string; isGroup?: boolean };
  text?: string;
  replyToId?: string;
  entities?: MentionEntity[];
  attachments?: Array<{ contentType?: string; name?: string }>;
  channelData?: { tenant?: { id?: string }; team?: { id?: string }; channel?: { id?: string } };
}

/** What the plugin keeps about a conversation so it can answer into it later:
 *  the Bot Connector endpoint for that tenant, and how to address the bot. */
export interface ConversationRef {
  serviceUrl: string;
  tenantId: string;
  conversationType: TeamsConversationType;
  botId: string;
}

export interface TeamsInbound extends InboundMessage {
  conversationRef: ConversationRef;
  tenantId: string;
}

function asObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

export function conversationTypeOf(activity: TeamsActivity): TeamsConversationType {
  const raw = activity.conversation?.conversationType;
  if (raw === "personal" || raw === "groupChat" || raw === "channel") return raw;
  // Older payloads omit conversationType; isGroup still tells 1:1 apart.
  return activity.conversation?.isGroup ? "groupChat" : "personal";
}

export function tenantOf(activity: TeamsActivity): string {
  return (activity.conversation?.tenantId ?? activity.channelData?.tenant?.id ?? "").trim().toLowerCase();
}

/**
 * The sender id identities are keyed by: the person's Entra object id, scoped
 * by their tenant ("<tid>:<oid>"). Both come from the activity the Bot
 * Connector signed, never from anything the person typed.
 *
 * SEAM (XYNE-66905): Entra sign-in writes UserSurfaceIdentity rows with
 * exactly this value as surfaceUserId. Until then no row exists, and every
 * sender is told they are not linked yet.
 */
export function teamsSenderId(tenantId: string, from: ChannelAccountRef | undefined): string | null {
  const oid = from?.aadObjectId?.trim().toLowerCase();
  if (oid) return `${tenantId}:${oid}`;
  // Federated or anonymous senders carry no Entra id. Keyed on the channel
  // id they do have, prefixed so it can never collide with an object id —
  // and never linked, because sign-in only ever writes "<tid>:<oid>".
  const channelUserId = from?.id?.trim();
  return channelUserId ? `${tenantId}:bf:${channelUserId}` : null;
}

/** The chat id for this activity (see the header). */
export function chatIdOf(activity: TeamsActivity, type: TeamsConversationType): string {
  const id = activity.conversation?.id ?? "";
  if (type !== "channel" || id.includes(";messageid=")) return id;
  const root = activity.replyToId || activity.id;
  return root ? `${id};messageid=${root}` : id;
}

const ENTITY_MAP: Record<string, string> = {
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&#39;": "'",
  "&apos;": "'",
  "&nbsp;": " ",
};

/**
 * The words the person typed. Teams sends mentions inline as
 * "<at>Name</at>": the bot's own is removed (it is how they addressed us, not
 * part of the request — "@Claw /status" must reach the core as "/status"),
 * anyone else's becomes "@Name". The few wrapper tags and entities Teams adds
 * are unwrapped; nothing else is touched.
 */
export function extractText(activity: TeamsActivity, botId: string): { text: string; mentionedSelf: boolean } {
  let text = activity.text ?? "";
  let mentionedSelf = false;
  for (const entity of activity.entities ?? []) {
    if (entity?.type !== "mention" || !entity.text) continue;
    if (entity.mentioned?.id && entity.mentioned.id === botId) {
      mentionedSelf = true;
      text = text.split(entity.text).join(" ");
    }
  }
  text = text
    .replace(/<at>([^<]*)<\/at>/gi, (_m, name: string) => `@${name.trim()}`)
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/?(?:p|div|span)(?:\s[^>]*)?>/gi, "")
    .replace(/&(?:amp|lt|gt|quot|#39|apos|nbsp);/g, (entity) => ENTITY_MAP[entity] ?? entity)
    .replace(/[ \t]+/g, " ")
    .trim();
  return { text, mentionedSelf };
}

/** Files and inline images ride in `attachments`; the html rendering of the
 *  message itself does too, and is not a file. */
function fileKindOf(activity: TeamsActivity): string | undefined {
  for (const attachment of activity.attachments ?? []) {
    const type = attachment?.contentType ?? "";
    if (type === "application/vnd.microsoft.teams.file.download.info") return "file";
    if (type.startsWith("image/")) return "image";
  }
  return undefined;
}

/**
 * One activity → zero or one inbound message. Only `message` activities from
 * Teams are turned into messages; installs, membership changes, reactions and
 * card invokes are ignored here (cards are XYNE-66906).
 */
export function parseTeamsActivity(payload: unknown): TeamsInbound | null {
  const activity = asObject(payload) as TeamsActivity | null;
  if (!activity || activity.type !== "message" || activity.channelId !== TEAMS_CHANNEL_ID) return null;
  const messageId = activity.id;
  const conversationId = activity.conversation?.id;
  const serviceUrl = activity.serviceUrl;
  const botId = activity.recipient?.id ?? "";
  const tenantId = tenantOf(activity);
  if (!messageId || !conversationId || !serviceUrl || !botId || !tenantId) return null;

  const senderId = teamsSenderId(tenantId, activity.from);
  if (!senderId) return null;

  const conversationType = conversationTypeOf(activity);
  const chatId = chatIdOf(activity, conversationType);
  const extracted = extractText(activity, botId);
  // A 1:1 chat with a bot has nobody else in it: every line is addressed to
  // the bot, which is what a mention means everywhere else. Without this,
  // requireMention (on by default) would ignore everything said in a 1:1.
  const mentionedSelf = extracted.mentionedSelf || conversationType === "personal";
  const mediaKind = fileKindOf(activity);
  const sentAt = activity.timestamp ? Date.parse(activity.timestamp) : NaN;

  return {
    messageId,
    chatId,
    senderId,
    ...(activity.from?.name ? { senderName: activity.from.name } : {}),
    isGroup: conversationType !== "personal",
    text: extracted.text,
    mentionedSelf,
    // In a channel, replyToId is the thread's root post — usually somebody
    // else's — so it says nothing about replying to us.
    replyToSelf: false,
    fromSelf: activity.from?.id === botId,
    ref: { chatId, messageId },
    // SEAM (XYNE-66907): files arrive here. Until they are fetched, the core
    // tells the agent a file was sent that could not be read.
    ...(mediaKind ? { mediaKind, loadAttachments: async () => [] } : {}),
    ...(Number.isFinite(sentAt) ? { timestamp: Math.floor(sentAt / 1000) } : {}),
    tenantId,
    conversationRef: { serviceUrl, tenantId, conversationType, botId },
  };
}
