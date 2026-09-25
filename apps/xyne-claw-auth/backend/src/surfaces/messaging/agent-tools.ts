/**
 * The AGENT's actions on a messaging channel (OpenClaw parity): send to any
 * chat, react, list groups, resolve a human target to a chat id. Served as a
 * virtual MCP server named after the channel key (e.g. "whatsapp") for runs
 * that originated on that channel; executed here, in claw-auth, against the
 * account's live connection via the outbox request/reply path, so the
 * one-pod-per-account rule still holds.
 *
 * Gating is per account (`channelConfig.agentActions`), like OpenClaw's
 * `actions` block — NOT the Spaces approval-card flow (which needs a Spaces
 * app context these runs don't have). Replying into the chat that triggered
 * the run is always allowed; everything else is off until an admin turns it
 * on.
 */
import type { McpToolInfo } from "../../mcp/types.js";
import { enqueueAndWait } from "./delivery.js";
import { readGroupContext } from "./group-context.js";
import { getChannel, type ChannelDeliveryTarget, type MessagingChannelKey } from "./plugin.js";
import { agentActionsSchema, type AgentActionGates } from "./schema.js";
import { getAccount, toChannelAccount } from "./store.js";

const gatesSchema = agentActionsSchema();

/** Read the gates out of a plugin's opaque residue. Anything missing or
 *  malformed falls back to the channel-neutral defaults. */
export function agentActionGatesOf(channelConfig: unknown): AgentActionGates {
  const raw =
    channelConfig && typeof channelConfig === "object" ? (channelConfig as { agentActions?: unknown }).agentActions : undefined;
  const parsed = gatesSchema.safeParse(raw ?? undefined);
  return parsed.success ? parsed.data : gatesSchema.parse(undefined);
}

/** Tool names must be identifier-ish, so "whatsapp-cloud" → "whatsapp_cloud". */
function channelToolPrefix(channel: MessagingChannelKey): string {
  return channel.replace(/-/g, "_");
}

/**
 * The tools this channel can actually honour.
 *
 * Offering one it cannot — group listing on a business number that may not be
 * in groups at all — spends a model turn on a call that fails, and teaches it
 * the tool is unreliable rather than absent. Capability, not channel name,
 * decides.
 */
export function channelAgentTools(channel: MessagingChannelKey): McpToolInfo[] {
  const label = channel.startsWith("whatsapp") ? "WhatsApp" : channel;
  const prefix = channelToolPrefix(channel);
  const plugin = getChannel(channel);
  const groups = plugin?.capabilities.groups ?? false;
  const reactions = plugin?.capabilities.reactions ?? false;
  // A shared business number is something people message, not something that
  // opens conversations — so it is never given a way to address another chat.
  // Without that, resolving a target has nothing to resolve for.
  const mayAddressOtherChats = plugin?.accountScope !== "org";
  return [
    {
      name: `${prefix}_send_message`,
      description:
        `Send a ${label} message. Omit "to" to send into the chat this conversation is happening in. ` +
        `"to" may be a phone number with country code (+91 98765 43210), a group id (…@g.us), or a group name. ` +
        `Sending outside the current chat must be enabled for this account by an admin.`,
      inputSchema: {
        type: "object",
        properties: {
          text: { type: "string", description: "Message text. Markdown is converted to the messenger's formatting." },
          ...(mayAddressOtherChats
            ? { to: { type: "string", description: "Target chat: phone number, group id, or group name. Omit for the current chat." } }
            : {}),
          mentions: {
            type: "array",
            items: { type: "string" },
            description: "Phone numbers (with country code) to @mention in a group message. Include @<number> in the text too.",
          },
        },
        required: ["text"],
      },
    },
    ...(reactions
      ? [{
      name: `${prefix}_react`,
      description: `React with an emoji to a ${label} message. Defaults to the message that started this conversation turn.`,
      inputSchema: {
        type: "object",
        properties: {
          emoji: { type: "string", description: "A single emoji, e.g. 👍" },
          message_id: { type: "string", description: "Id of the message to react to. Omit for the triggering message." },
          chat: { type: "string", description: "Chat id of that message. Omit for the current chat." },
        },
        required: ["emoji"],
      },
    }]
      : []),
    ...(groups
      ? [{
      name: `${prefix}_list_groups`,
      description: `List the ${label} groups this account is a member of (id, name, participant count).`,
      inputSchema: { type: "object", properties: {}, required: [] },
    }]
      : []),
    ...(groups
      ? [{
      name: `${prefix}_read_recent`,
      description:
        `Read what has been said recently in the ${label} group this conversation is happening in — the messages ` +
        `nobody addressed the agent in, which it would otherwise never see. Use this when asked to summarise or ` +
        `catch up on "this group" / "this chat". Bounded: only what arrived since the agent last replied here, ` +
        `and only from the last 12 hours. Returns [] in a one-to-one chat, or when there is nothing buffered — ` +
        `say so plainly rather than guessing, and do NOT substitute a Spaces conversation.`,
      inputSchema: { type: "object", properties: {}, required: [] },
    }]
      : []),
    ...(mayAddressOtherChats
      ? [{
      name: `${prefix}_resolve_target`,
      description: `Check whether a phone number is on ${label} / find a group id by name. Returns the chat id to use with ${channel}_send_message.`,
      inputSchema: {
        type: "object",
        properties: { target: { type: "string", description: "Phone number with country code, or a group name." } },
        required: ["target"],
      },
    }]
      : []),
  ];
}

export function isChannelAgentTool(channel: MessagingChannelKey, tool: string): boolean {
  return channelAgentTools(channel).some((t) => t.name === tool);
}

function str(params: Record<string, unknown>, key: string): string | undefined {
  const v = params[key];
  return typeof v === "string" && v.trim() ? v.trim() : undefined;
}

function sameChat(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

/**
 * Execute one channel tool for the run identified by `target`. Returns the
 * text the model sees. Throws only on programmer error; messenger failures
 * are reported in the returned text so the agent can react to them.
 */
export async function handleChannelAgentTool(input: {
  target: ChannelDeliveryTarget;
  tool: string;
  params: Record<string, unknown>;
}): Promise<string> {
  const { target, tool, params } = input;
  const channel = target.channel;
  const row = await getAccount(target.connectedSurfaceId);
  if (!row || row.status !== "ACTIVE") return JSON.stringify({ ok: false, error: "This channel account is no longer active." });
  const account = toChannelAccount(row);
  const gates = agentActionGatesOf(account.channelConfig);
  const accountId = account.id;
  const prefix = channelToolPrefix(channel);

  switch (tool) {
    case `${prefix}_send_message`: {
      const text = str(params, "text");
      if (!text) return JSON.stringify({ ok: false, error: "text is required" });
      const to = str(params, "to");
      const mentions = Array.isArray(params["mentions"])
        ? (params["mentions"] as unknown[]).filter((m): m is string => typeof m === "string")
        : [];

      let chatId = target.chatId;
      if (to && !sameChat(to, target.chatId)) {
        if (!gates.sendToOtherChats) {
          return JSON.stringify({
            ok: false,
            error: `Sending to other chats is disabled for this ${channel} account. Ask an admin to enable "agent may send to other chats", or omit "to" to reply here.`,
          });
        }
        const resolved = await enqueueAndWait(accountId, { kind: "resolve-target", target: to });
        if (!resolved.ok) return JSON.stringify({ ok: false, error: resolved.error });
        if (!resolved.targetId) return JSON.stringify({ ok: false, error: `Could not resolve "${to}"` });
        chatId = resolved.targetId;
      }
      const sent = await enqueueAndWait(accountId, {
        kind: "text",
        chatId,
        text,
        ...(mentions.length ? { mentions } : {}),
        ...(chatId === target.chatId && target.quoted ? { quoted: target.quoted } : {}),
      });
      if (!sent.ok) return JSON.stringify({ ok: false, error: sent.error });
      return JSON.stringify({ ok: true, chatId, messageId: sent.ref?.messageId ?? null, sentToCurrentChat: chatId === target.chatId });
    }

    case `${prefix}_react`: {
      if (!gates.reactions) return JSON.stringify({ ok: false, error: `Reactions are disabled for this ${channel} account.` });
      const emoji = str(params, "emoji");
      if (!emoji) return JSON.stringify({ ok: false, error: "emoji is required" });
      const messageId = str(params, "message_id");
      const chat = str(params, "chat") ?? target.chatId;
      // A reaction lands in someone's chat as a notification from this number,
      // so reaching into another chat is the same permission as sending there,
      // not a lesser one.
      if (!sameChat(chat, target.chatId) && !gates.sendToOtherChats) {
        return JSON.stringify({
          ok: false,
          error: `Reacting in other chats is disabled for this ${channel} account. Omit "chat" to react here.`,
        });
      }
      const ref = messageId
        ? { chatId: chat, messageId, raw: { key: { remoteJid: chat, id: messageId, fromMe: false } } }
        : target.quoted;
      if (!ref) return JSON.stringify({ ok: false, error: "No message to react to (pass message_id)." });
      const reply = await enqueueAndWait(accountId, { kind: "react", ref, emoji });
      return JSON.stringify(reply.ok ? { ok: true } : { ok: false, error: reply.error });
    }

    case `${prefix}_list_groups`: {
      if (!gates.listGroups) return JSON.stringify({ ok: false, error: `Group listing is disabled for this ${channel} account.` });
      const reply = await enqueueAndWait(accountId, { kind: "list-groups" });
      return JSON.stringify(reply.ok ? { ok: true, groups: reply.groups ?? [] } : { ok: false, error: reply.error });
    }

    case `${prefix}_read_recent`: {
      if (!target.isGroup) {
        return JSON.stringify({ ok: true, messages: [], note: "This is a one-to-one chat; its history is the conversation you already have." });
      }
      // Read, never consume: this is the agent looking, not a run quoting the
      // lines into its task. Draining here would rob the next reply of the
      // context it was buffered for.
      const buffered = await readGroupContext(accountId, target.chatId);
      return JSON.stringify({
        ok: true,
        messages: buffered.map((m) => ({
          from: m.senderName?.trim() || `+${m.senderId.replace(/@.*$/, "")}`,
          text: m.text,
          at: new Date(m.at).toISOString(),
        })),
        note:
          buffered.length === 0
            ? "Nothing buffered for this group. Only messages that did not address the agent are kept, for 12 hours — say that rather than looking somewhere else."
            : undefined,
      });
    }

    case `${prefix}_resolve_target`: {
      const t = str(params, "target");
      if (!t) return JSON.stringify({ ok: false, error: "target is required" });
      const reply = await enqueueAndWait(accountId, { kind: "resolve-target", target: t });
      return JSON.stringify(reply.ok ? { ok: true, chatId: reply.targetId } : { ok: false, error: reply.error });
    }

    default:
      return JSON.stringify({ ok: false, error: `Unknown ${channel} tool: ${tool}` });
  }
}
