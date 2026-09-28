/**
 * Write approvals on a messenger.
 *
 * A claw write tool does not execute — it returns a signed pending action and
 * the run finishes with that action attached. In Spaces an Approve/Decline
 * card appears alongside the reply. Here the same action becomes a native
 * two-button card (or a numbered menu on channels without one), and the tap
 * is executed by lib/approved-write.ts.
 *
 * The identity rule is the whole point of this file: the signature binds the
 * action to a claw user, and the tap is only honoured when the messenger
 * sender resolves to that same user. A parked token is not authority on its
 * own — it is single-use, chat-bound, and re-checked against the live
 * identity at redemption.
 */
import { createLogger } from "../../logger.js";
import { errMsg } from "../../lib/errors.js";
import { executeApprovedWrite, type SignedWriteAction } from "../../lib/approved-write.js";
import { newCardToken, parkOptions, type ParkedOption } from "./cards.js";
import { enqueueOutbound } from "./delivery.js";
import { chatMessageRepository } from "../../repositories/index.js";
import { resolveIdentity } from "./identity.js";
import type { ChannelAccount, ChannelDeliveryTarget, InteractiveCard } from "./plugin.js";

const log = createLogger("channel-approvals");

/** Card body cap on WhatsApp is 1024; leave room for the framing lines. */
const MAX_DETAIL_CHARS = 600;

function str(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function clamp(value: string, max: number): string {
  return value.length <= max ? value : `${value.slice(0, max)}…`;
}

/**
 * What the person is being asked to allow, in WhatsApp's dialect. Kept
 * separate from webhook.ts's Spaces version: that one writes markdown
 * headings into a card that scrolls, this one has 1024 characters and only
 * *bold* to work with.
 */
function describeWriteAction(tool: string, params: Record<string, unknown>): string {
  switch (tool) {
    case "user-send-message": {
      const where = str(params["channelId"])
        ? `#${str(params["channelId"])}`
        : str(params["conversationId"])
          ? "an existing thread"
          : "Xyne Spaces";
      const content = clamp(str(params["content"]), MAX_DETAIL_CHARS);
      return `Send this message as you to ${where}:\n\n"${content}"`;
    }
    case "spaces-create-ticket": {
      const title = str(params["title"]) || "(untitled)";
      const desc = clamp(str(params["description"]), 300);
      return `Create the ticket *${title}*${desc ? `\n\n${desc}` : ""}`;
    }
    case "spaces-create-bulk-tickets": {
      const tickets = Array.isArray(params["tickets"]) ? params["tickets"] : [];
      const names = tickets
        .slice(0, 5)
        .map((t, i) => `${i + 1}. ${str((t as Record<string, unknown>)["title"]) || "(untitled)"}`)
        .join("\n");
      const more = tickets.length > 5 ? `\n…and ${tickets.length - 5} more` : "";
      return `Create ${tickets.length} ticket(s):\n${names}${more}`;
    }
    case "spaces-update-ticket":
      return `Update ticket ${str(params["ticketId"]) || "(unknown)"}`;
    case "spaces-schedule-call":
      return `Schedule a call: ${clamp(str(params["title"]) || "(untitled)", 200)}`;
    default: {
      // Unknown write tools still have to be describable — never show a card
      // whose body is only a tool name the person has no way to judge.
      const shown = Object.entries(params)
        .filter(([, v]) => typeof v === "string" || typeof v === "number")
        .slice(0, 4)
        .map(([k, v]) => `${k}: ${clamp(String(v), 120)}`)
        .join("\n");
      return `Run *${tool}*${shown ? `\n\n${shown}` : ""}`;
    }
  }
}

/** Read the loosely-typed pendingAction claw sends into our shape. */
function parseSignedAction(raw: unknown): SignedWriteAction | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const serverType = str(r["serverType"]);
  const tool = str(r["tool"]);
  const userId = str(r["userId"]);
  const signature = str(r["signature"]);
  if (!serverType || !tool || !userId || !signature) return null;
  const params = r["params"] && typeof r["params"] === "object" ? (r["params"] as Record<string, unknown>) : {};
  return {
    serverType,
    tool,
    params,
    userId,
    signature,
    ...(str(r["agentSlug"]) ? { agentSlug: str(r["agentSlug"]) } : {}),
    ...(str(r["spacesAppId"]) ? { spacesAppId: str(r["spacesAppId"]) } : {}),
  };
}

/**
 * Turn the run's pending actions into cards and queue them behind the reply.
 * Called from /webhook/result, which may be any pod — parking is in Redis and
 * sending is the owner pod's job, so neither needs to be here.
 */
export async function enqueueApprovalCards(input: {
  target: ChannelDeliveryTarget;
  userId: string;
  pendingActions: unknown[];
  conversationId?: string;
  agentSlug?: string;
}): Promise<void> {
  for (const raw of input.pendingActions) {
    const action = parseSignedAction(raw);
    if (!action) {
      log.warn(`[approvals] skipping unparseable pending action on ${input.target.channel}`);
      continue;
    }
    const approveToken = newCardToken();
    const declineToken = newCardToken();
    const common = {
      chatId: input.target.chatId,
      senderId: input.target.senderId,
      userId: input.userId,
      ...(input.conversationId ? { conversationId: input.conversationId } : {}),
      ...(input.agentSlug ? { agentSlug: input.agentSlug } : {}),
    };
    const label = action.tool;
    const parked: Array<{ token: string; option: ParkedOption }> = [
      { token: approveToken, option: { ...common, action: { kind: "approve-write", label }, write: action } },
      { token: declineToken, option: { ...common, action: { kind: "decline-write", label } } },
    ];
    await parkOptions(input.target.connectedSurfaceId, parked);

    const card: InteractiveCard = {
      kind: "buttons",
      header: "Approval needed",
      body: describeWriteAction(action.tool, action.params),
      footer: "Nothing happens until you choose.",
      buttons: [
        { id: approveToken, title: "Approve" },
        { id: declineToken, title: "Decline" },
      ],
    };
    await enqueueOutbound(input.target.connectedSurfaceId, { kind: "card", chatId: input.target.chatId, card });
  }
}

/**
 * Write the tap and its outcome into the conversation the run used.
 *
 * Without this the approval is invisible to the agent: the card is executed
 * outside any run, so the next turn loads a history whose last word is the
 * model asking for permission, and it tells the person they never approved
 * something they already did. Best-effort — the write already happened, and
 * losing the note must not turn a success into an error.
 */
async function recordOutcome(
  option: ParkedOption,
  orgId: string,
  decision: string,
  outcome: string,
): Promise<void> {
  if (!option.conversationId) return;
  const common = {
    conversationId: option.conversationId,
    agentSlug: option.agentSlug || "assistant",
    userId: option.userId,
    orgId,
  };
  try {
    await chatMessageRepository.create({ ...common, role: "user", content: decision });
    await chatMessageRepository.create({ ...common, role: "assistant", content: outcome, status: "completed" });
  } catch (err) {
    log.warn(`[approvals] could not record outcome in ${option.conversationId}: ${errMsg(err)}`);
  }
}

/**
 * Redeem a tapped (or typed) approval option. The token has already been
 * consumed by the caller, so every path here must reply with something.
 */
export async function redeemApproval(input: {
  account: ChannelAccount;
  option: ParkedOption;
  senderId: string;
  chatId: string;
}): Promise<void> {
  const { account, option } = input;
  const reply = (text: string) => enqueueOutbound(account.id, { kind: "text", chatId: input.chatId, text });

  if (option.action.kind === "decline-write") {
    await reply("Declined — nothing was done.");
    await recordOutcome(option, account.orgId, `Declined: ${option.action.label}`, "Declined — nothing was done.");
    return;
  }
  if (option.action.kind !== "approve-write" || !option.write) {
    await reply("That option has expired. Ask again and I'll re-send it.");
    return;
  }

  // The caller has already proved this tap came from the chat and sender the
  // card was shown to. Re-resolve the identity anyway: a link can be revoked
  // or repointed between the card being sent and the tap arriving, and the
  // parked userId is a record of the past, not a live permission.
  const liveUserId = await resolveIdentity({
    surfaceId: account.surfaceId,
    senderId: input.senderId,
    orgId: account.orgId,
  });
  if (liveUserId !== null && liveUserId !== option.userId) {
    log.error(
      `[approvals] identity changed under a parked card: sender=${input.senderId} now=${liveUserId} was=${option.userId}`,
    );
    await reply("This approval isn't yours to give.");
    return;
  }
  // No live identity is the normal case for a self-chat or a fallback-user
  // account: the run itself ran as option.userId on the same evidence.
  const effectiveUserId = liveUserId ?? option.userId;

  try {
    const outcome = await executeApprovedWrite({
      action: option.write,
      approverUserId: effectiveUserId,
      ...(option.conversationId ? { conversationId: option.conversationId } : {}),
    });
    await reply(outcome.ok ? `✅ ${outcome.message}` : `⚠️ ${outcome.message}`);
    await recordOutcome(option, account.orgId, `Approved: ${option.action.label}`, outcome.message);
  } catch (err) {
    log.error(`[approvals] execution threw for ${option.action.label}: ${errMsg(err)}`);
    await reply("Something went wrong running that. Please try again from Xyne Spaces.");
  }
}
