import { Router, type Request, type Response } from "express";
import { executeTwinApprovalDelivery, type TwinDeliveryContext } from "../lib/twin-delivery.js";
import { recordTwinApprovalOutcome } from "../services/twinResponseFeedback.js";
import { createLogger } from "../logger.js";

const log = createLogger("twin-draft");

/**
 * S2S endpoint for the in-thread Digital Twin reply-draft flow (the replacement
 * for the approval DM card). The Spaces backend owns the draft (Redis, owner-
 * only) and forwards the user's approve/decline here — claw-auth owns the Twin's
 * tested DELIVERY (react/post as the user) and FEEDBACK recording. Mounted under
 * requireStrictS2S, so only a trusted service (Spaces) reaches it.
 *
 * The delivery-execution context comes from the SERVER-SIDE Redis draft (Spaces
 * reads it, not the client), so the reply's destination can't be tampered with.
 * We still re-check `actorUserId === draft.mentionedUserId` as defense in depth.
 */
export const twinDraftInternalRouter = Router();

/** The draft shape Spaces forwards (mirrors its TwinReplyDraft). */
interface ForwardedDraft {
  conversationId?: string;
  channelId?: string;
  action?: string;
  message?: string;
  emoji?: string;
  destinationKind?: string;
  destinationChannelId?: string;
  destinationConversationId?: string;
  destinationUserId?: string;
  sourceMessageId?: string;
  mentionedUserId?: string;
  ownerUserId?: string;
  workspaceId?: string;
  senderId?: string;
  channelName?: string;
  incomingTask?: string;
}

twinDraftInternalRouter.post("/action", async (req: Request, res: Response) => {
  const body = (req.body ?? {}) as {
    action?: unknown;
    actorUserId?: unknown;
    editedMessage?: unknown;
    draft?: ForwardedDraft;
  };
  const action = body.action;
  const actorUserId = typeof body.actorUserId === "string" ? body.actorUserId : "";
  const editedMessage = typeof body.editedMessage === "string" ? body.editedMessage : undefined;
  const draft = body.draft ?? {};

  if (action !== "approve" && action !== "decline") {
    res.status(400).json({ error: "action must be approve | decline" });
    return;
  }
  const ownerId = draft.mentionedUserId ?? draft.ownerUserId ?? "";
  if (!ownerId || !draft.workspaceId || !draft.conversationId || !draft.channelId) {
    res.status(400).json({ error: "draft is missing required fields" });
    return;
  }
  // Defense in depth: the actor must be the draft's owner (Spaces already
  // owner-scoped the read; this fails closed if that ever regresses).
  if (!actorUserId || actorUserId !== ownerId) {
    log.error(`[twin-draft] unauthorized: actor ${actorUserId || "(none)"} != owner ${ownerId}`);
    res.status(403).json({ error: "Unauthorized" });
    return;
  }

  // Feedback row shape read by recordTwinApprovalOutcome (mirrors flow-data keys).
  const feedbackData: Record<string, unknown> = {
    mentionedUserId: ownerId,
    sourceMessageId: draft.sourceMessageId,
    targetConversationId: draft.conversationId,
    targetChannelId: draft.channelId,
    channelName: draft.channelName,
    incomingTask: draft.incomingTask,
    deliveryAction: draft.action,
    deliveryEmoji: draft.emoji,
    destinationKind: draft.destinationKind,
    messageContent: draft.message,
  };

  if (action === "decline") {
    void recordTwinApprovalOutcome(feedbackData, "declined");
    log.info(`[twin-draft] declined by ${ownerId} (msg ${draft.sourceMessageId ?? "(none)"})`);
    res.json({ ok: true });
    return;
  }

  // approve — deliver, then record the outcome.
  const ctx: TwinDeliveryContext = {
    mentionedUserId: ownerId,
    workspaceId: draft.workspaceId,
    targetChannelId: draft.channelId,
    targetConversationId: draft.conversationId,
    sourceMessageId: draft.sourceMessageId,
    messageContent: draft.message,
    deliveryAction: draft.action ?? "reply",
    deliveryEmoji: draft.emoji,
    destinationKind: draft.destinationKind ?? "origin_thread",
    destinationChannelId: draft.destinationChannelId,
    destinationConversationId: draft.destinationConversationId,
    destinationUserId: draft.destinationUserId,
    senderId: draft.senderId,
  };

  try {
    const result = await executeTwinApprovalDelivery(ctx, { editedContent: editedMessage });
    if (!result.ok) {
      // Do NOT record an outcome — the draft stays for the user to retry.
      res.status(502).json({ error: result.error });
      return;
    }
    void recordTwinApprovalOutcome(
      feedbackData,
      result.wasEdited ? "accepted_edited" : "accepted",
      result.finalContent,
    );
    log.info(`[twin-draft] approved by ${ownerId} — ${result.doneMsg} (edited=${result.wasEdited})`);
    res.json({ ok: true, ...(result.posted ? { posted: result.posted } : {}) });
  } catch (err) {
    log.error("[twin-draft] approval error:", err);
    res.status(500).json({ error: "Failed to deliver response" });
  }
});
