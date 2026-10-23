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
import { prisma } from "../../db.js";
import { createLogger } from "../../logger.js";
import type { McpToolInfo } from "../../mcp/types.js";
import { asLeadAndDocument, enqueueAndWait, enqueueOutbound, type OutboxAttachment } from "./delivery.js";
import { readGroupContext } from "./group-context.js";
import { getChannel, type ChannelAccount, type ChannelDeliveryTarget, type MessageTemplate, type MessagingChannelKey } from "./plugin.js";
import { agentActionsSchema, type AgentActionGates } from "./schema.js";
import { getAccount, listOrgAccounts, listOwnedAccounts, toChannelAccount } from "./store.js";

const log = createLogger("channel-agent-tools");

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
  const media = plugin?.capabilities.media ?? false;
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
    ...(media
      ? [{
      name: `${prefix}_send_document`,
      description:
        `Send long content as a PDF in this ${label} chat instead of a wall of text: a report, a long list, a ` +
        `table, meeting notes, anything past about 10 short lines. Pass the FULL content as markdown; it is ` +
        `rendered to a PDF and delivered right away. Then reply with a 1-3 line takeaway — don't paste the content too.`,
      inputSchema: {
        type: "object",
        properties: {
          title: { type: "string", description: "Short document title, shown on the first page and used as the file name." },
          markdown: { type: "string", description: "The full content, as markdown (headings, lists, tables, code)." },
        },
        required: ["title", "markdown"],
      },
    }]
      : []),
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
        `and only from the last 15 days. Returns [] in a one-to-one chat, or when there is nothing buffered — ` +
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

    case `${prefix}_send_document`: {
      const title = str(params, "title") ?? "Document";
      const markdown = str(params, "markdown");
      if (!markdown) return JSON.stringify({ ok: false, error: "markdown is required" });
      const { renderMarkdownToPdf } = await import("../../lib/result-pdf.js");
      const pdf = await renderMarkdownToPdf(markdown, { title });
      const fileName = `${title.replace(/[^A-Za-z0-9 _-]+/g, "").trim().replace(/\s+/g, "-").slice(0, 60) || "document"}.pdf`;
      const sent = await enqueueAndWait(accountId, {
        kind: "file",
        chatId: target.chatId,
        attachment: { fileName, mimeType: "application/pdf", data: pdf.toString("base64") },
      });
      return JSON.stringify(sent.ok ? { ok: true, fileName, sentToCurrentChat: true } : { ok: false, error: sent.error });
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
            ? "Nothing buffered for this group. Only messages that did not address the agent are kept, for 15 days — say that rather than looking somewhere else."
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

// ── the person's own WhatsApp, from any run ──────────────────────────────────

/**
 * "Message me on WhatsApp", for runs that did NOT start in a chat — a
 * scheduled job reporting back, a Spaces run that finishes something the
 * person is waiting on. A virtual MCP server like the channel tools above,
 * granted per run (routes/mcp.ts listing + lib/start-run.ts forwarded config,
 * the two gates) to any run whose user has a WhatsApp they can be reached on.
 *
 * It has no recipient parameter on purpose: the only person it can reach is
 * the user the run belongs to, resolved here from the authenticated session —
 * an agent cannot be talked into messaging anyone else with it.
 */
export const NOTIFY_SERVER_TYPE = "whatsapp-notify";
export const NOTIFY_TOOL_NAME = "whatsapp_notify_user";

export const NOTIFY_TOOL: McpToolInfo = {
  name: NOTIFY_TOOL_NAME,
  description:
    "Send a WhatsApp message to the person this run is working for — only them; there is no way to choose a " +
    "recipient. Use it to report back from scheduled or background work, or to tell them something they are " +
    "waiting on is done. Write it like a text from a friend: short, the key fact first, no greeting or sign-off. " +
    "Don't use it to answer them in a conversation you are already having with them.",
  inputSchema: {
    type: "object",
    properties: {
      text: { type: "string", description: "The message. Markdown is converted to WhatsApp formatting. Keep it to a few lines." },
    },
    required: ["text"],
  },
};

export interface NotifyTarget {
  account: ChannelAccount;
  chatId: string;
  template?: MessageTemplate;
}

function isRunning(account: ChannelAccount): boolean {
  return account.config.desiredState === "running" && account.config.connState !== "logged_out";
}

/**
 * Where this user can be reached. Their linked number on the org's business
 * number first (that is the assistant they talk to), else their own linked
 * device, where the message lands in their "You" chat. Null when neither.
 */
export async function findNotifyTarget(userId: string, orgId?: string | null): Promise<NotifyTarget | null> {
  if (!userId) return null;
  const identities = await prisma.userSurfaceIdentity
    .findMany({
      where: { userId, status: "ACTIVE", surface: { key: "whatsapp-cloud" }, ...(orgId ? { orgId } : {}) },
      select: { orgId: true, surfaceUserId: true },
      orderBy: { lastSeenAt: { sort: "desc", nulls: "last" } },
    })
    .catch(() => []);
  for (const identity of identities) {
    const account = (await listOrgAccounts("whatsapp-cloud", identity.orgId)).map(toChannelAccount).find(isRunning);
    if (!account) continue;
    const template = (account.channelConfig as { notificationTemplate?: MessageTemplate } | null)?.notificationTemplate;
    return { account, chatId: identity.surfaceUserId, ...(template ? { template } : {}) };
  }
  if (orgId) {
    const own = (await listOwnedAccounts("whatsapp", orgId, userId))
      .map(toChannelAccount)
      .find((account) => isRunning(account) && account.config.connState === "connected" && !!account.config.selfId);
    if (own) return { account: own, chatId: own.config.selfId! };
  }
  return null;
}

/**
 * Send `text` (and any files) to the user's own WhatsApp. Outside Meta's
 * 24-hour window it goes out as the account's notification template when one
 * is set; otherwise the failure is returned, worded for the agent.
 */
export async function notifyUser(input: {
  userId: string;
  orgId?: string | null;
  text: string;
  attachments?: OutboxAttachment[];
  /** Which account-configured template to prefer outside the 24h window.
   *  "dailyBrief" uses dailyBriefTemplate, falling back to notificationTemplate. */
  templateKind?: "notification" | "dailyBrief";
  /** What fills the template's single `{{1}}` when the window is shut.
   *  Defaults to the message text. */
  templateText?: string;
}): Promise<
  | { ok: true; viaTemplate: boolean }
  | { ok: false; error: string; reason: "no_target" | "window_closed" | "failed" }
> {
  const target = await findNotifyTarget(input.userId, input.orgId);
  if (!target) {
    return {
      ok: false,
      reason: "no_target",
      error: "This person has no WhatsApp linked to Claw, so they can't be messaged there.",
    };
  }
  const template =
    input.templateKind === "dailyBrief"
      ? ((target.account.channelConfig as { dailyBriefTemplate?: MessageTemplate } | null)?.dailyBriefTemplate ??
        target.template)
      : target.template;
  // A long report arrives as its lead plus a PDF, not as a wall of texts.
  const long = await asLeadAndDocument(input.text, "Update").catch(() => null);
  const templateText = input.templateText ?? (long ? input.text : undefined);
  const reply = await enqueueAndWait(target.account.id, {
    kind: "text",
    chatId: target.chatId,
    text: long?.text ?? input.text,
    ...(template ? { template, ...(templateText ? { templateText } : {}) } : {}),
  });
  if (!reply.ok) {
    const closed = /24|window|re-engagement/i.test(reply.error);
    log.warn(`[notify] send failed account=${target.account.id} user=${input.userId}: ${reply.error}`);
    return {
      ok: false,
      reason: closed ? "window_closed" : "failed",
      error: closed
        ? "They haven't messaged in over 24 hours, so WhatsApp won't deliver a free-form message, and no notification template is set up for this number."
        : reply.error,
    };
  }
  // A template carries only the words: files go after, and only when the
  // message itself went out normally (a template means the window is shut).
  if (!reply.viaTemplate) {
    for (const attachment of [...(long ? [long.document] : []), ...(input.attachments ?? [])]) {
      await enqueueOutbound(target.account.id, { kind: "file", chatId: target.chatId, attachment });
    }
  }
  log.info(`[notify] sent account=${target.account.id} user=${input.userId}${reply.viaTemplate ? " via template" : ""}`);
  return { ok: true, viaTemplate: reply.viaTemplate === true };
}

