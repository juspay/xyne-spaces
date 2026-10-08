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
import { getSpacesPostTarget, looksLikeMemberIdList, type SpacesPostTarget } from "../../lib/spaces-post-target.js";
import { mentionShorthandToText } from "../../lib/mention-transform.js";
import { getSpacesAuthForUser } from "../../lib/spaces-db.js";
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

function paramText(value: unknown): string {
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value) && value.every((v) => typeof v === "string" || typeof v === "number" || typeof v === "boolean")) {
    return value.map(String).join(", ");
  }
  return "";
}

const THREAD_PREVIEW_CHARS = 160;

/** "MID: merchant_1234" per line, for a card that would otherwise hide the
 *  custom-field values being written. Capped so a wide form cannot push the
 *  rest of the card past WhatsApp's 1024-character body. */
function describeFieldMap(value: unknown): string {
  const map = value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
  if (!map) return "";
  const entries = Object.entries(map)
    .map(([key, raw]) => [key, paramText(raw)] as const)
    .filter(([, text]) => text !== "");
  if (entries.length === 0) return "";
  // Capped at 12 like the Spaces card (lib/write-card-render.ts) so the same
  // write does not show a different number of fields on the two surfaces.
  const shown = entries.slice(0, 12).map(([key, text]) => `${key}: ${clamp(text, 120)}`);
  if (entries.length > 12) shown.push(`…and ${entries.length - 12} more`);
  return shown.join("\n");
}

export function htmlToCardText(html: string): string {
  let current = html;
  let previous: string;
  do {
    previous = current;
    current = current
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/(p|div|li)>/gi, "\n")
      .replace(/<(b|strong)>([\s\S]*?)<\/\1>/gi, "*$2*")
      .replace(/<(i|em)>([\s\S]*?)<\/\1>/gi, "_$2_")
      .replace(/<[^>]+>/g, "")
      .replace(/&nbsp;/g, " ")
      .replace(/&lt;/g, "‹")
      .replace(/&gt;/g, "›")
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/&amp;/g, "&")
      .replace(/[ \t]+/g, " ")
      .replace(/\n\s*\n+/g, "\n")
      .trim();
  } while (current !== previous);
  return current;
}

function describePostTarget(params: Record<string, unknown>, target: SpacesPostTarget | null): string {
  const dm = target?.directMessage;
  const dmWith = dm?.with.length ? ` with *${dm.with.join(", ")}*` : "";
  const channel = !dm && target?.channelName && !looksLikeMemberIdList(target.channelName) ? `*#${target.channelName}*` : "";
  if (str(params["conversationId"])) {
    const thread = target?.thread;
    const preview = thread ? clamp(cardText(thread.html).replace(/\n+/g, " "), THREAD_PREVIEW_CHARS) : "";
    const inChannel = dm ? ` in your direct message${dmWith}` : channel ? ` in ${channel}` : "";
    const by = thread?.author ? ` by *${thread.author}*` : "";
    return preview
      ? `Reply as you in the thread${inChannel} started${by}:\n> ${preview}\n\nYour reply`
      : `Reply as you in an existing thread${inChannel}`;
  }
  if (str(params["channelId"])) {
    if (dm) return `Send this message as you in a direct message${dmWith ? dmWith.replace(" with ", " to ") : ""}`;
    return `Send this message as you to ${channel || "a Spaces channel"}`;
  }
  return "Send this message as you to Xyne Spaces";
}

function cardText(html: string): string {
  return mentionShorthandToText(htmlToCardText(html));
}

/**
 * What the person is being asked to allow, in WhatsApp's dialect. Kept
 * separate from webhook.ts's Spaces version: that one writes markdown
 * headings into a card that scrolls, this one has 1024 characters and only
 * *bold* to work with.
 */
export function describeWriteAction(tool: string, params: Record<string, unknown>, postTarget: SpacesPostTarget | null = null): string {
  switch (tool) {
    case "user-send-message": {
      const content = clamp(cardText(str(params["content"])), MAX_DETAIL_CHARS);
      return `${describePostTarget(params, postTarget)}:\n\n"${content}"`;
    }
    case "spaces-create-ticket": {
      const title = str(params["title"]) || "(untitled)";
      const desc = clamp(str(params["description"]), 300);
      // Custom fields are the whole point of some desks (a MID, a merchant
      // name), and they are invisible in the title — so a card that hides
      // them asks the person to approve a value they cannot see.
      const fields = describeFieldMap(params["dynamicFields"]);
      return `Create the ticket *${title}*${desc ? `\n\n${desc}` : ""}${fields ? `\n\n${fields}` : ""}`;
    }
    case "spaces-create-bulk-tickets": {
      const tickets = Array.isArray(params["tickets"]) ? params["tickets"] : [];
      const shared = describeFieldMap(params["defaultDynamicFields"]);
      const names = tickets
        .slice(0, 5)
        .map((t, i) => {
          const ticket = t as Record<string, unknown>;
          // Per-ticket fields replace the shared ones, so show whichever
          // actually applies rather than implying both are written.
          const own = ticket["dynamicFields"];
          const fields = own === undefined || own === null ? shared : describeFieldMap(own);
          return `${i + 1}. ${str(ticket["title"]) || "(untitled)"}${fields ? ` — ${fields.replace(/\n/g, ", ")}` : ""}`;
        })
        .join("\n");
      const more = tickets.length > 5 ? `\n…and ${tickets.length - 5} more` : "";
      return `Create ${tickets.length} ticket(s):\n${names}${more}`;
    }
    case "spaces-send-ticket-email": {
      // An email leaves the building. Recipients and the actual words are the
      // whole decision, so both go on the card even when that crowds it.
      const to = paramText(params["to"]) || "(nobody)";
      const cc = paramText(params["cc"]);
      const bcc = paramText(params["bcc"]);
      const subject = str(params["subject"]);
      const fullBody = cardText(str(params["body"]));
      const content = clamp(fullBody, MAX_DETAIL_CHARS);
      const lines = [`Email *${to}*${cc ? `, cc ${cc}` : ""}${bcc ? `, bcc ${bcc}` : ""} from this ticket`];
      if (subject) lines.push(`Subject: ${subject}`);
      const cut = fullBody.length > MAX_DETAIL_CHARS ? "\n(shortened for this card — the full message is sent)" : "";
      return `${lines.join("\n")}\n\n"${content}"${cut}`;
    }
    case "spaces-update-ticket": {
      const fields = describeFieldMap(params["customFields"]);
      return `Update ticket ${str(params["ticketId"]) || "(unknown)"}${fields ? `\n\n${fields}` : ""}`;
    }
    case "spaces-schedule-call":
      return `Schedule a call: ${clamp(str(params["title"]) || "(untitled)", 200)}`;
    default: {
      // Unknown write tools still have to be describable — never show a card
      // whose body is only a tool name the person has no way to judge.
      const shown = Object.entries(params)
        .map(([k, v]) => [k, paramText(v)] as const)
        .filter(([, v]) => v !== "")
        .slice(0, 6)
        .map(([k, v]) => `${k}: ${clamp(v, 120)}`)
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

async function lookupPostTarget(action: SignedWriteAction): Promise<SpacesPostTarget | null> {
  const auth = await getSpacesAuthForUser(action.userId, "write-action").catch(() => null);
  if (!auth) return null;
  return getSpacesPostTarget(
    {
      ...(str(action.params["channelId"]) ? { channelId: str(action.params["channelId"]) } : {}),
      ...(str(action.params["conversationId"]) ? { conversationId: str(action.params["conversationId"]) } : {}),
    },
    auth,
    action.userId,
  ).catch(() => null);
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

    const postTarget = action.tool === "user-send-message" ? await lookupPostTarget(action) : null;
    const card: InteractiveCard = {
      kind: "buttons",
      header: "Approval needed",
      body: describeWriteAction(action.tool, action.params, postTarget),
      footer: "Nothing happens until you choose.",
      buttons: [
        { id: approveToken, title: "Approve" },
        { id: declineToken, title: "Decline" },
      ],
    };
    await enqueueOutbound(input.target.connectedSurfaceId, { kind: "card", chatId: input.target.chatId, card });
  }
}

/** Tool results carry inline citation tokens for the Spaces UI; on a phone
 *  they are noise. */
function stripCitationTokens(text: string): string {
  return text
    .replace(/\[clf-[^\]]*\]/g, "")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function fieldFromResult(text: string, label: string): string {
  const match = new RegExp(`^\\s*${label}:\\s*(.+)$`, "im").exec(text);
  return match?.[1]?.trim() ?? "";
}

/**
 * What the person is told once the write has actually run.
 *
 * `executeApprovedWrite` answers with "Done — <tool> ran.", which is true and
 * useless: the one thing somebody creating a ticket from WhatsApp needs back
 * is its id. The tool's own result text has it, so this turns that into a
 * sentence and falls back to the generic line for tools with nothing worth
 * quoting.
 */
export function summarizeApprovedWrite(
  tool: string,
  params: Record<string, unknown>,
  resultText: string | undefined,
): string | null {
  const text = stripCitationTokens(resultText || "");
  if (!text) return null;
  switch (tool) {
    case "spaces-create-ticket": {
      const xyneId = fieldFromResult(text, "xyneId");
      if (!xyneId) return null;
      const title = str(params["title"]);
      const lines = [`Ticket *${xyneId}* created${title ? `: ${title}` : ""}.`];
      const fields = describeFieldMap(params["dynamicFields"]);
      if (fields) lines.push("", fields);
      const attachments = fieldFromResult(text, "Attachments");
      if (attachments) lines.push("", `Attachments: ${attachments}`);
      // On an email desk the ticket is only half of it — offer the step the
      // person would otherwise have to know to ask for. The tool result says
      // whether this channel can mail a customer at all.
      if (/^\s*Email desk:\s*yes/im.test(text)) {
        lines.push("", "Want me to email the customer the ticket details? Send me their email address(es).");
      }
      return lines.join("\n");
    }
    case "spaces-send-ticket-email": {
      const sentTo = paramText(params["to"]);
      return sentTo
        ? `Email sent to ${sentTo}. It is on the ticket's email thread, and replies will land there.`
        : null;
    }
    case "spaces-update-ticket": {
      // The update tool answers "Ticket <id> updated: a, b" already — quote it
      // rather than inventing a second phrasing.
      return /updated/i.test(text) ? text : null;
    }
    default:
      return null;
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
    const spoken = outcome.ok
      ? (summarizeApprovedWrite(option.write.tool, option.write.params, outcome.resultText) ?? outcome.message)
      : outcome.message;
    await reply(spoken);
    // The transcript gets the tool's RAW result as well, not just the sentence
    // the person saw. The write ran outside any run, so this note is the only
    // place the next turn can learn the new ticket's ids — without them the
    // agent cannot act on "now email it to the merchant".
    await recordOutcome(
      option,
      account.orgId,
      `Approved: ${option.action.label}`,
      outcome.ok && outcome.resultText?.trim()
        ? `${spoken}\n\n[tool result]\n${stripCitationTokens(outcome.resultText)}`
        : spoken,
    );
  } catch (err) {
    log.error(`[approvals] execution threw for ${option.action.label}: ${errMsg(err)}`);
    await reply("Something went wrong running that. Please try again from Xyne Spaces.");
  }
}
