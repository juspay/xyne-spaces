import { CONFIG } from "../config.js";
import { errMsg } from "./errors.js";
import { expandSpacesMentions, resolveUnboundMentions } from "./mention-transform.js";
import { buildSpacesMentionLookupsDb } from "./mention-lookups.js";
import { createLogger } from "../logger.js";
import { resolveTwinReplyTarget } from "./twin-reply-target.js";
import { twinDeliveryParts } from "xyne-claw-shared";

const log = createLogger("twin-delivery");

/**
 * Shared execution of an APPROVED Digital Twin delivery — react AS the user on
 * the triggering message and/or post a reply AS the user to the chosen
 * destination, via the Spaces S2S routes. Extracted so BOTH the (legacy)
 * approval-DM flow-action handler AND the new in-thread reply-draft endpoint
 * run the exact same, single tested implementation.
 *
 * This does DELIVERY only — the caller owns its own HTTP response and its own
 * feedback recording (recordTwinApprovalOutcome). Destination resolution and
 * post-as-user are the hard permission gate: an invalid destination degrades to
 * the origin thread, and post-as-user enforces the user's real Spaces membership.
 */

/** Flat delivery context — the fields needed to react/post as the user. Sourced
 *  from the approval flow-data OR a Redis reply-draft (same shape). */
export interface TwinDeliveryContext {
  mentionedUserId: string;
  workspaceId: string;
  targetChannelId: string;
  targetConversationId: string;
  sourceMessageId?: string | undefined;
  messageContent?: string | undefined;
  deliveryAction: string; // react | reply | react_and_reply
  deliveryEmoji?: string | undefined;
  destinationKind: string;
  destinationChannelId?: string | undefined;
  destinationConversationId?: string | undefined;
  /** For `dm` — a specific person the Twin chose. */
  destinationUserId?: string | undefined;
  /** For `dm_sender` — the person who mentioned the user. */
  senderId?: string | undefined;
}

/** Build the delivery context from approval-card flow-data (the raw, untyped
 *  `flowJSON.data`), applying the same defaults the card was built with. */
export function twinDeliveryContextFromFlowData(data: Record<string, unknown>): TwinDeliveryContext {
  return {
    mentionedUserId: data["mentionedUserId"] as string,
    workspaceId: data["workspaceId"] as string,
    targetChannelId: data["targetChannelId"] as string,
    targetConversationId: data["targetConversationId"] as string,
    sourceMessageId: data["sourceMessageId"] as string | undefined,
    messageContent: (data["messageContent"] as string | undefined) ?? "",
    deliveryAction: (data["deliveryAction"] as string | undefined) ?? "reply",
    deliveryEmoji: data["deliveryEmoji"] as string | undefined,
    destinationKind: (data["destinationKind"] as string | undefined) ?? "origin_thread",
    destinationChannelId: data["destinationChannelId"] as string | undefined,
    destinationConversationId: data["destinationConversationId"] as string | undefined,
    // DM destinations: `dm_sender` → the person who mentioned the user (senderId);
    // `dm` → a specific person the Twin chose (destinationUserId).
    destinationUserId: data["destinationUserId"] as string | undefined,
    senderId: data["senderId"] as string | undefined,
  };
}

export type TwinDeliveryResult =
  | {
      ok: true;
      doneMsg: string;
      wasEdited: boolean;
      finalContent: string;
      /** Where the reply was posted (for the client to redirect there). Absent
       *  for a react-only delivery. */
      posted?: { channelId: string; conversationId?: string };
    }
  | { ok: false; error: string };

/** POST a JSON body to a Spaces S2S route (30s timeout). */
export function spacesInternalPost(path: string, body: unknown): Promise<Response> {
  return fetch(`${CONFIG.spacesInternalUrl}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-s2s-key": process.env["INTERNAL_S2S_KEY"] ?? "" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(30_000),
  });
}

/**
 * Deliver an approved Twin response. Returns a structured result; NEVER writes
 * an HTTP response or records feedback (the caller does both).
 */
export async function executeTwinApprovalDelivery(
  ctx: TwinDeliveryContext,
  opts: { editedContent?: string | undefined } = {},
): Promise<TwinDeliveryResult> {
  const { emoji: willReact, message: willReply } = twinDeliveryParts(ctx.deliveryAction);

  const original = willReply ? (ctx.messageContent ?? "").trim() : "";
  const edited = opts.editedContent?.trim();
  const finalContent = willReply ? edited || original : "";
  const wasEdited = willReply && !!edited && edited !== original;

  // 1) React AS the user on the triggering message.
  if (willReact && ctx.sourceMessageId && ctx.deliveryEmoji) {
    const rr = await spacesInternalPost("/api/internal/reactAsUser", {
      messageId: ctx.sourceMessageId,
      emojiName: ctx.deliveryEmoji,
      userId: ctx.mentionedUserId,
    });
    if (!rr.ok) {
      const text = await rr.text().catch(() => "");
      log.warn(`[twin-delivery] react failed: ${rr.status} ${text.slice(0, 160)}`);
      // If the reaction was the ONLY action, surface the failure; otherwise
      // continue so the reply still posts.
      if (!willReply) return { ok: false, error: `Failed to react: ${rr.status}` };
    }
  }

  // 2) Post the reply AS the user to the resolved destination.
  let posted: { channelId: string; conversationId?: string } | undefined;
  if (willReply && finalContent) {
    let target: { channelId: string; conversationId?: string };
    if (ctx.destinationKind === "dm_sender" || ctx.destinationKind === "dm") {
      const dmTarget = ctx.destinationKind === "dm_sender" ? ctx.senderId : ctx.destinationUserId;
      if (!dmTarget) {
        log.error(`[twin-delivery] DM has no target user (kind=${ctx.destinationKind})`);
        return { ok: false, error: "Couldn't resolve who to DM" };
      }
      const dmRes = await spacesInternalPost("/api/internal/getOrCreateDm", {
        userId: ctx.mentionedUserId,
        targetUserId: dmTarget,
        workspaceId: ctx.workspaceId,
      });
      if (!dmRes.ok) {
        const text = await dmRes.text().catch(() => "");
        log.error(`[twin-delivery] Failed to open DM: ${dmRes.status} ${text.slice(0, 200)}`);
        return { ok: false, error: `Couldn't open the DM: ${dmRes.status}` };
      }
      const dmData = (await dmRes.json()) as { channelId?: string };
      if (!dmData.channelId) return { ok: false, error: "DM channel could not be resolved" };
      target = { channelId: dmData.channelId };
    } else {
      target = resolveTwinReplyTarget(ctx.destinationKind, {
        targetChannelId: ctx.targetChannelId,
        targetConversationId: ctx.targetConversationId,
        destinationChannelId: ctx.destinationChannelId,
        destinationConversationId: ctx.destinationConversationId,
      });
    }
    // Resolve bare `@Name` / `@email` shorthand in the Twin's reply into real,
    // notifying Spaces mentions BEFORE posting. Every other result-posting path
    // (webhook, scheduled-jobs, attachments, app-tools) already runs this step;
    // twin delivery historically ran only the sync expander, so an approved
    // reply containing a plain `@Anurag Dwivedi` never became a clickable,
    // notifying mention. Post-as-user is S2S (no user JWT), so resolve via the
    // Spaces DB scoped to the delivery workspace. Fail-open: on any error, post
    // the text unchanged so the reply still goes out.
    let markdownText = finalContent;
    try {
      markdownText = await resolveUnboundMentions(finalContent, buildSpacesMentionLookupsDb(ctx.workspaceId));
    } catch (err) {
      log.warn(
        `[twin-delivery] mention resolution failed — posting raw: ${errMsg(err)}`,
      );
    }
    markdownText = expandSpacesMentions(markdownText);

    const postRes = await spacesInternalPost("/api/internal/postAsUser", {
      channelId: target.channelId,
      ...(target.conversationId ? { conversationId: target.conversationId } : {}),
      markdownText,
      userId: ctx.mentionedUserId,
      workspaceId: ctx.workspaceId,
      metadata: { contentFormat: "markdown" },
    });
    if (!postRes.ok) {
      const text = await postRes.text().catch(() => "");
      log.error(`[twin-delivery] Failed to post as user: ${postRes.status} ${text.slice(0, 200)}`);
      return { ok: false, error: `Failed to post: ${postRes.status}` };
    }
    posted = target;
  }

  const doneMsg = willReact && willReply ? "Reacted & replied." : willReply ? "Response sent." : "Reacted.";
  log.info(`[twin-delivery] delivered — action=${ctx.deliveryAction} dest=${ctx.destinationKind} edited=${wasEdited}`);
  return { ok: true, doneMsg, wasEdited, finalContent, ...(posted ? { posted } : {}) };
}
