/**
 * Links a run produces besides its answer — a /design or /dashboard share, the
 * sandbox live preview, a pull request the agent opened — for messaging
 * channels. Spaces shows these as thread posts and an evolving PR card
 * (routes/webhook.ts); a messenger gets one short message each: title, status,
 * link. Everything goes through the account's outbox like any other send.
 *
 * A messenger cannot edit a sent message, so a PR status change is a new
 * message — sent once per change, gated on the PR's widget binding (the same
 * row the Spaces card and the git-host webhook use).
 */
import type { AgentWidgetBinding } from "@prisma/client";
import { prScreenId, type PrProvider, type PrStatus } from "xyne-claw-shared";
import { createLogger } from "../../logger.js";
import {
  claimWidgetBindingStatus,
  normalizePrUrl,
  upsertWidgetBindingRoute,
} from "../../lib/agent-widget-binding.js";
import { activeRun } from "./commands.js";
import { enqueueOutbound } from "./delivery.js";
import { resumeTyping } from "./interim.js";
import { isMessagingChannelKey, type ChannelDeliveryTarget, type MessageTemplate } from "./plugin.js";
import { getAccount, toChannelAccount, type AccountRow } from "./store.js";

const log = createLogger("channel-run-links");

// ── formatting ──

const PR_STATUS_TEXT: Record<PrStatus, string> = {
  created: "opened",
  merged: "merged",
  reverted: "reverted",
  deleted: "deleted",
  declined: "declined",
};

export interface PrLinkFact {
  status: PrStatus;
  title: string;
  url?: string;
  repo?: string;
  number?: string | number;
}

/** Title, status, link — three lines, markdown the plugin turns into its dialect. */
export function formatPrLinkMessage(pr: PrLinkFact): string {
  const where = [pr.repo, pr.number !== undefined ? `#${pr.number}` : undefined].filter(Boolean).join(" ");
  const status = `PR ${PR_STATUS_TEXT[pr.status]}${where ? ` · ${where}` : ""}`;
  return [`**${pr.title}**`, status, ...(pr.url ? [pr.url] : [])].join("\n");
}

export function formatDesignShareMessage(command: string, url: string): string {
  return [`**Live ${command}**`, "Ready · the same link updates with later revisions in this chat", url].join("\n");
}

export interface SandboxPreviewLinks {
  previewUrl: string;
  codePreviewUrl?: string;
  termUrl?: string;
}

/** Null links: the preview could not be attached to the run, so there is no
 *  link worth sending — only the note that says so. */
export function formatSandboxPreviewMessage(links: SandboxPreviewLinks | null): string {
  if (!links) return "Live preview couldn't be attached to this conversation, so it isn't available for this run.";
  return [
    "**Live preview**",
    "Running · watch the agent's browser, or take over",
    `Browser: ${links.previewUrl}`,
    // Same trailing slash the Spaces post uses: the code viewer is a directory.
    ...(links.codePreviewUrl ? [`Code changes: ${links.codePreviewUrl}/`] : []),
    ...(links.termUrl ? [`Terminal: ${links.termUrl}`] : []),
  ].join("\n");
}

// ── delivery ──

async function sendLink(
  target: ChannelDeliveryTarget,
  text: string,
  opts: { sessionId?: string; template?: MessageTemplate } = {},
): Promise<void> {
  await enqueueOutbound(target.connectedSurfaceId, {
    kind: "text",
    chatId: target.chatId,
    text,
    ...(opts.template ? { template: opts.template } : {}),
    ...(target.conversationId ? { conversationId: target.conversationId } : {}),
  });
  // Sent mid-run, the message clears "typing…" on the phone; put it back while
  // this run is still the chat's current one (interim.ts, same reason).
  if (opts.sessionId) {
    const run = await activeRun(target.connectedSurfaceId, target.chatId);
    if (run?.sessionId === opts.sessionId) await resumeTyping(target);
  }
}

/** The /design or /dashboard share, under the run's reply. */
export async function deliverChannelDesignShare(target: ChannelDeliveryTarget, command: string, url: string): Promise<void> {
  await sendLink(target, formatDesignShareMessage(command, url));
}

/** The one-shot sandbox preview announce, while the run is still working. */
export async function deliverChannelSandboxPreview(
  sessionId: string,
  target: ChannelDeliveryTarget,
  links: SandboxPreviewLinks | null,
): Promise<void> {
  await sendLink(target, formatSandboxPreviewMessage(links), { sessionId });
}

/** What a channel PR binding keeps in `data` besides the card fields: where to
 *  send the next status. The quoted message and reaction settings belong to the
 *  run, not to a status change days later. */
type StoredTarget = Omit<ChannelDeliveryTarget, "quoted" | "statusReactions">;

function storedTarget(target: ChannelDeliveryTarget): StoredTarget {
  const { quoted: _quoted, statusReactions: _statusReactions, ...rest } = target;
  return rest;
}

/** The chat a PR binding sends to, or null for a Spaces card binding. */
export function readChannelPrTarget(binding: Pick<AgentWidgetBinding, "data">): StoredTarget | null {
  const data = binding.data as Record<string, unknown> | null;
  const raw = data && typeof data === "object" ? (data["channelDelivery"] as Record<string, unknown> | undefined) : undefined;
  if (!raw || typeof raw !== "object") return null;
  const { channel, connectedSurfaceId, accountKey, chatId, senderId, isGroup, conversationId } = raw;
  if (!isMessagingChannelKey(channel)) return null;
  if (typeof connectedSurfaceId !== "string" || !connectedSurfaceId) return null;
  if (typeof chatId !== "string" || !chatId) return null;
  return {
    channel,
    connectedSurfaceId,
    accountKey: typeof accountKey === "string" ? accountKey : "",
    chatId,
    senderId: typeof senderId === "string" ? senderId : "",
    isGroup: isGroup === true,
    ...(typeof conversationId === "string" && conversationId ? { conversationId } : {}),
  };
}

export interface ChannelPrInput extends PrLinkFact {
  provider: PrProvider;
  desc?: string;
  ticketId?: string;
}

/**
 * A PR fact from the run (create/merge tool) → the chat, once per status. The
 * binding is written first so a git-host webhook can find this chat after the
 * run is gone; the claim then decides whether this status still needs saying.
 */
export async function deliverChannelPrStatus(input: {
  sessionId: string;
  target: ChannelDeliveryTarget;
  orgId: string;
  conversationId: string;
  agentSlug?: string | null;
  pr: ChannelPrInput;
}): Promise<"sent" | "duplicate"> {
  const { pr, target } = input;
  const screenId = prScreenId({
    provider: pr.provider,
    ...(pr.repo ? { repo: pr.repo } : {}),
    ...(pr.number !== undefined ? { number: pr.number } : {}),
    ...(pr.url ? { url: pr.url } : {}),
  });
  const data: Record<string, unknown> = { provider: pr.provider, title: pr.title, channelDelivery: storedTarget(target) };
  if (pr.url) data["url"] = pr.url;
  if (pr.ticketId) data["ticketId"] = pr.ticketId;
  if (pr.desc) data["desc"] = pr.desc;
  if (pr.repo) data["repo"] = pr.repo;
  if (pr.number !== undefined) data["number"] = pr.number;
  await upsertWidgetBindingRoute({
    orgId: input.orgId,
    kind: "pr",
    screenId,
    externalKey: (pr.url ? normalizePrUrl(pr.url) : "") || null,
    conversationId: input.conversationId,
    channelId: target.chatId,
    spacesAppId: "",
    spacesAppUserId: "",
    agentSlug: input.agentSlug ?? null,
    data,
  });
  if (!(await claimWidgetBindingStatus("pr", screenId, pr.status))) {
    log.info(`[channel-pr] ${pr.status} already sent screenId=${screenId}`);
    return "duplicate";
  }
  await sendLink(target, formatPrLinkMessage(pr), { sessionId: input.sessionId });
  log.info(`[channel-pr] sent ${pr.status} screenId=${screenId} account=${target.connectedSurfaceId}`);
  return "sent";
}

function notificationTemplate(account: AccountRow): MessageTemplate | undefined {
  try {
    const config = toChannelAccount(account).channelConfig as { notificationTemplate?: MessageTemplate } | null;
    return config?.notificationTemplate;
  } catch {
    return undefined;
  }
}

export type ChannelPrEventOutcome = { outcome: "posted" } | { outcome: "skipped"; reason: string };

/**
 * A git-host webhook status change for a PR an agent opened from a chat. Runs
 * long after the run ended, so the account is re-checked (still there, same
 * org) and, outside the 24-hour reply window, the account's notification
 * template carries it.
 */
export async function deliverWebhookPrStatus(
  binding: Pick<AgentWidgetBinding, "orgId" | "screenId" | "data">,
  target: StoredTarget,
  pr: PrLinkFact,
): Promise<ChannelPrEventOutcome> {
  const account = await getAccount(target.connectedSurfaceId);
  if (!account) return { outcome: "skipped", reason: "channel-account-gone" };
  if (!binding.orgId || account.orgId !== binding.orgId) {
    log.warn(`[channel-pr] org mismatch binding.org=${binding.orgId} account=${account.id} — skipping`);
    return { outcome: "skipped", reason: "org-mismatch" };
  }
  if (!(await claimWidgetBindingStatus("pr", binding.screenId, pr.status))) {
    return { outcome: "skipped", reason: "dedup-same-status" };
  }
  const template = notificationTemplate(account);
  await sendLink(target, formatPrLinkMessage(pr), template ? { template } : {});
  return { outcome: "posted" };
}
