/**
 * Digital Twin result delivery — what the webhook's /result callback does with a
 * completed approval-mode (twin) run, moved out of routes/webhook.ts:
 *
 *  - handleTwinApprovalResult — outcome chat row, AgentRun finalize + run-recovery
 *    settle, then the ignore / silent / draft dispatch.
 *  - sendTwinReplyDraft       — owner-only in-thread reply draft (Spaces S2S), with
 *    a legacy approve/decline DM fallback (sendDigitalTwinApprovalDm).
 *  - withTwinSuffix           — the owner's signature/disclaimer, also used by the
 *    conversation-mode reply path in routes/webhook.ts.
 *
 * Logs stay under the "webhook" component so existing log queries keep matching.
 */

import { CONFIG } from "../config.js";
import { prisma } from "../db.js";
import { errMsg } from "../lib/errors.js";
import { buildThreadCitationMeta } from "../lib/citations.js";
import { reasoningWithCheck } from "../lib/twin-self-check.js";
import { spacesInternalPost } from "../lib/twin-approval-delivery.js";
import { deleteSession, type SessionContext } from "../lib/session-context.js";
import { createLogger } from "../logger.js";
import { handleRunCompletion } from "../queue/run-recovery-worker.js";
import { agentRunRepository, chatMessageRepository } from "../repositories/index.js";
import type { FinalizeRunInput } from "../repositories/agentRunRepository.js";
import { spacesAppFetch, spacesAppFetchMultipart } from "../surfaces/spaces/client.js";
import { recordTwinApprovalPending } from "./twinResponseFeedback.js";
import { buildTwinApprovalFlow, isTwinDelivery, withSpacesAppId, type TwinDelivery } from "xyne-claw-shared";

const clog = createLogger("webhook");

/** The /result payload fields the approval-mode block reads (the webhook's larger
 *  inline payload type satisfies this structurally). */
export interface TwinRunResult {
  twinDelivery?: TwinDelivery;
  reasoning?: string;
  provider?: string;
  model?: string;
  toolsUsed?: string[];
  toolInvocations?: unknown;
  tokenUsage?: FinalizeRunInput["tokenUsage"];
  latency?: FinalizeRunInput["latency"];
  fastMode?: boolean;
  attachments?: Array<{ fileName: string; mimeType: string; data: string }>;
}

/** Union invocation lists (payload + persisted run) deduped by toolCallId,
 *  preferring the entry that CARRIES citations — subagent children (which the
 *  reasoning's `[clf-…]` tokens reference) live only in the persisted run, not
 *  the parent's payload. Mirrors the merge used by the thread-reply citation path. */
export function mergeInvocationsForCitations(...lists: unknown[]): unknown[] {
  const byId = new Map<string, unknown>();
  const hasCitations = (x: unknown): boolean =>
    !!x && typeof x === "object" && Array.isArray((x as Record<string, unknown>)["citations"]);
  let noId = 0;
  for (const list of lists) {
    if (!Array.isArray(list)) continue;
    for (const inv of list) {
      const rawId = inv && typeof inv === "object" ? (inv as Record<string, unknown>)["toolCallId"] : undefined;
      const key = typeof rawId === "string" && rawId ? rawId : `__noid_${noId++}`;
      const existing = byId.get(key);
      // First entry per id wins, unless a later one carries the citations.
      if (existing === undefined || (!hasCitations(existing) && hasCitations(inv))) byId.set(key, inv);
    }
  }
  return [...byId.values()];
}

/**
 * Append the Twin owner's configured response suffix (signature / disclaimer) to
 * `text`. Idempotent: skips the append when `text` already ends with the exact
 * suffix (rare but cheap to check). Non-fatal: on any failure the text is
 * returned as-is, so the reply still posts, just without the suffix.
 */
export async function withTwinSuffix(userId: string, text: string): Promise<string> {
  try {
    const u = await prisma.user.findUnique({
      where: { id: userId },
      select: { digitalTwinResponseSuffix: true },
    });
    const suffix = u?.digitalTwinResponseSuffix?.trim();
    // Two newlines so the suffix sits visually separated from the body.
    if (!suffix || text.endsWith(suffix)) return text;
    return `${text.trimEnd()}\n\n${suffix}`;
  } catch (err) {
    clog.warn(`[webhook/result] Twin suffix lookup failed for user ${userId}: ${errMsg(err)}`);
    return text;
  }
}

/** Record a PENDING feedback row so the daily learning loop can later reconcile
 *  the user's accept / decline / edit / ignore of this proposal. Fire-and-forget. */
function recordPending(ctx: SessionContext, delivery: TwinDelivery): void {
  void recordTwinApprovalPending({
    userId: ctx.mentionedUserId,
    conversationId: ctx.conversationId,
    channelId: ctx.channelId,
    channelName: ctx.channelName,
    ...(ctx.sourceMessageId ? { sourceMessageId: ctx.sourceMessageId } : {}),
    incomingTask: ctx.task,
    delivery,
  });
}

/** Owner-chat assistant row for a twin run's outcome; `undefined` = the model
 *  never delivered. `isTwinDelivery` does not type-check `message` for react /
 *  ignore, hence the runtime `typeof` guard. */
export function twinOutcomeText(delivery: TwinDelivery | undefined): string {
  if (!delivery) return "_Stayed silent — not confident enough to reply._";
  if (delivery.action === "ignore") return "_Chose not to reply to this._";
  const msg = typeof delivery.message === "string" ? delivery.message.trim() : "";
  if (msg) return delivery.emoji ? `${delivery.emoji} ${msg}` : msg;
  return delivery.emoji ? `Reacted ${delivery.emoji}` : "_Drafted a reply._";
}

/**
 * LEGACY delivery path (pre-XYNE-17815): post the Twin's proposal as an
 * approve/decline card in a DM with the owner — with attachments when present.
 * Kept ONLY as the fallback for Spaces backends that don't yet serve
 * /api/internal/twin-reply-draft — see sendTwinReplyDraft. Delete once every
 * environment runs the in-thread draft. Nothing is posted to the originating
 * thread; deletes the session on completion.
 * The signature suffix is already applied by the caller, so the original
 * inline suffix block was removed on restore (it would double-append).
 */
async function sendDigitalTwinApprovalDm(
  ctx: SessionContext,
  delivery: TwinDelivery,
  attachments: Array<{ fileName: string; mimeType: string; data: string }> | undefined,
  sessionId: string,
): Promise<void> {
  const token = ctx.appToken;

  // workspaceId required by prod openDm schema. Empty fallback only to satisfy
  // types — the earlier USER_MENTIONED gate already rejected runs where we
  // couldn't resolve the workspaceId, so this should always have a real value.
  const dmResult = (await spacesAppFetch("/channel/openDm", {
    targetUserId: ctx.mentionedUserId,
    workspaceId: ctx.workspaceId ?? "",
  }, token)) as { channelId: string };

  const twinFlow = withSpacesAppId(buildTwinApprovalFlow({
    delivery: delivery,
    ...(ctx.sourceMessageId ? { sourceMessageId: ctx.sourceMessageId } : {}),
    targetChannelId: ctx.channelId,
    targetConversationId: ctx.conversationId,
    mentionedUserId: ctx.mentionedUserId,
    workspaceId: ctx.workspaceId ?? "",
    senderId: ctx.senderId,
    senderName: ctx.senderName,
    channelName: ctx.channelName,
    task: ctx.task,
    ...(ctx.agentSlug ? { agentSlug: ctx.agentSlug } : {}),
    dmChannelId: dmResult.channelId,
    spacesBaseUrl: CONFIG.spacesAppUrl,
  }), ctx.spacesAppId);

  if (attachments?.length) {
    const form = new FormData();
    for (const att of attachments) {
      const buffer = Buffer.from(att.data, "base64");
      const blob = new Blob([buffer], { type: att.mimeType });
      form.append("files", blob, att.fileName);
    }
    form.append("channelId", dmResult.channelId);
    form.append("userId", ctx.spacesAppUserId);
    form.append("flow", JSON.stringify(twinFlow));

    await spacesAppFetchMultipart("/files/filesUpload", form, token);
  } else {
    await spacesAppFetch("/chat/postMessage", {
      channelId: dmResult.channelId,
      flow: twinFlow,
      userId: ctx.spacesAppUserId,
    }, token);
  }

  recordPending(ctx, delivery);

  clog.info(`[webhook/result] Digital Twin: sent approve/decline DM to ${ctx.mentionedUserId} (asked by ${ctx.senderId})`);
  await deleteSession(sessionId);
}

/**
 * Deliver the Twin's structured proposal as an OWNER-ONLY in-thread reply draft
 * (replaces the old approval DM card). Bakes citation metadata from the Twin's
 * private `reasoning` (its `[clf-…#n]` tokens reference the Spaces tools it
 * searched) so the "Why?" panel can render clickable source chips, then creates
 * the draft in Spaces (Redis, owner-partitioned) via S2S. Fail-CLOSED: any
 * create failure leaves nothing posted and the session cleaned up. An `ignore`
 * delivery must never reach here — the caller drops it (no draft, no pending row).
 */
async function sendTwinReplyDraft(
  ctx: SessionContext,
  delivery: TwinDelivery,
  toolInvocations: unknown,
  sessionId: string,
  /** Callback attachments — only used by the legacy approval-DM fallback. */
  attachments?: Array<{ fileName: string; mimeType: string; data: string }> | undefined,
): Promise<void> {
  // Apply the user's configured Twin signature/disclaimer to the REPLY body (not
  // to a react-only delivery). Deterministic server-side append.
  const effectiveDelivery: TwinDelivery =
    delivery.message && ctx.mentionedUserId
      ? { ...delivery, message: await withTwinSuffix(ctx.mentionedUserId, delivery.message) }
      : delivery;

  // Bake citation metadata from the private reasoning. Null when the reasoning
  // carries no `[clf-…]` tokens — the "Why?" panel then renders plain reasoning.
  let citationMeta: ReturnType<typeof buildThreadCitationMeta> = null;
  if (effectiveDelivery.reasoning) {
    try {
      const persisted = await agentRunRepository.findBySessionId(sessionId).catch(() => null);
      const merged = mergeInvocationsForCitations(persisted?.toolInvocations, toolInvocations);
      citationMeta = buildThreadCitationMeta(merged, effectiveDelivery.reasoning);
    } catch (err) {
      clog.warn(`[webhook/result] Twin citation baking failed: ${errMsg(err)}`);
    }
  }

  // Classifier self-check (claw, R6) goes on the owner-only "Why?" panel. Appended
  // AFTER citation baking so `[clf-…]` offsets are unaffected.
  const draftReasoning = reasoningWithCheck(effectiveDelivery.reasoning, effectiveDelivery.check);
  if (effectiveDelivery.check) {
    clog.info(`[webhook/result] Twin self-check overall=${effectiveDelivery.check.overall} session ${sessionId}`);
  }

  const dest = effectiveDelivery.destination;
  const draft = {
    conversationId: ctx.conversationId,
    ownerUserId: ctx.mentionedUserId,
    channelId: ctx.channelId,
    action: effectiveDelivery.action,
    ...(effectiveDelivery.message ? { message: effectiveDelivery.message } : {}),
    ...(effectiveDelivery.emoji ? { emoji: effectiveDelivery.emoji } : {}),
    ...(draftReasoning ? { reasoning: draftReasoning } : {}),
    ...(citationMeta?.clawCitations ? { clawCitations: citationMeta.clawCitations } : {}),
    ...(citationMeta?.clawCitationIcons ? { clawCitationIcons: citationMeta.clawCitationIcons } : {}),
    destinationKind: dest?.kind ?? "origin_thread",
    ...(dest && "channelId" in dest ? { destinationChannelId: dest.channelId } : {}),
    ...(dest && "conversationId" in dest ? { destinationConversationId: dest.conversationId } : {}),
    ...(dest && "userId" in dest ? { destinationUserId: dest.userId } : {}),
    ...(dest && "channelName" in dest && dest.channelName ? { destinationChannelName: dest.channelName } : {}),
    // DM recipient name for the owner-facing "sends a DM to …" label. `dm` may
    // carry it on the destination; `dm_sender` is the mention sender we already
    // know. Spaces resolves any remaining name from the user id at draft create.
    ...(dest?.kind === "dm" && dest.userName ? { destinationUserName: dest.userName } : {}),
    ...(dest?.kind === "dm_sender" && ctx.senderName ? { destinationUserName: ctx.senderName } : {}),
    ...(effectiveDelivery.destinationReason ? { destinationReason: effectiveDelivery.destinationReason } : {}),
    ...(ctx.sourceMessageId ? { sourceMessageId: ctx.sourceMessageId } : {}),
    mentionedUserId: ctx.mentionedUserId,
    workspaceId: ctx.workspaceId ?? "",
    ...(ctx.senderId ? { senderId: ctx.senderId } : {}),
    ...(ctx.senderName ? { senderName: ctx.senderName } : {}),
    ...(ctx.channelName ? { channelName: ctx.channelName } : {}),
    ...(ctx.task ? { incomingTask: ctx.task } : {}),
    ...(ctx.agentSlug ? { agentSlug: ctx.agentSlug } : {}),
    ...(ctx.spacesAppId ? { spacesAppId: ctx.spacesAppId } : {}),
    sessionId,
  };

  // Create the owner-only in-thread draft in Spaces. When the Spaces backend
  // doesn't serve /api/internal/twin-reply-draft yet (route added in
  // XYNE-17815; caller shipped 2026-07-23, route reached main 2026-08-05), the
  // request falls through to the user-auth middleware and comes back 401/404.
  // That skew silently killed EVERY twin reply for ~2 weeks because this path
  // was fail-closed with no alternative. Fall back to the pre-XYNE-17815
  // approval DM card instead: the twin keeps working on old backends, and the
  // moment the route deploys we're back on the in-thread draft with no change.
  try {
    const resp = await spacesInternalPost("/api/internal/twin-reply-draft", draft);
    if (!resp.ok) {
      const text = await resp.text().catch(() => "");
      // 401/404 == endpoint not deployed (or not reachable as S2S) → legacy DM.
      // Any other status is a genuine draft-create failure: stay fail-closed.
      if (resp.status === 401 || resp.status === 404) {
        clog.warn(`[webhook/result] Twin reply-draft endpoint unavailable (${resp.status}) — falling back to approval DM, session ${sessionId}`);
        await sendDigitalTwinApprovalDm(ctx, effectiveDelivery, attachments, sessionId);
        return;
      }
      clog.error(`[webhook/result] Twin reply-draft create failed: ${resp.status} ${text.slice(0, 200)} — staying silent, session ${sessionId}`);
      await deleteSession(sessionId);
      return;
    }
  } catch (err) {
    clog.error(`[webhook/result] Twin reply-draft create error: ${errMsg(err)} — staying silent, session ${sessionId}`);
    await deleteSession(sessionId);
    return;
  }

  recordPending(ctx, effectiveDelivery);

  clog.info(`[webhook/result] Digital Twin: posted in-thread reply draft for ${ctx.mentionedUserId} (asked by ${ctx.senderId}) action=${effectiveDelivery.action} dest=${dest?.kind ?? "origin_thread"}`);
  await deleteSession(sessionId);
}

/**
 * Handle a COMPLETED approval-mode (Digital Twin) run's /result callback.
 * The caller returns right after this, so its `finally` (queue drain / slot
 * release) still runs.
 */
export async function handleTwinApprovalResult(
  ctx: SessionContext,
  payload: TwinRunResult,
  sessionId: string,
): Promise<void> {
  // The RUN itself completed successfully — the twin merely chose HOW to act
  // (deliver a draft / react / ignore / stay silent). Finalize the AgentRun
  // and settle run-recovery HERE, before the early return below, exactly as
  // the conversation-mode path does at its own finalize/handleRunCompletion
  // sites. Skipping this was leaving every delivered twin reply stuck
  // "running" until an orphan-reaper mislabeled it "interrupted (orphaned
  // run)" (65 of 72 orphans had actually called twin_deliver), and left stale
  // recovery state that could spuriously re-fire the run.
  // Persist the twin's OUTCOME as an assistant message in the owner's
  // control-center chat so the conversation reads query → reply → query
  // (LINEAR — no `<x/y>` branch pager). The frontend groups CONSECUTIVE
  // same-role messages as sibling variants (resolveEffectiveParents), and a
  // twin thread is otherwise ALL user rows — its real reply is a Spaces draft,
  // never an assistant row — so 3 rapid tags rendered as 3 branches. This also
  // lets the owner SEE what their twin drafted (previously only the raw run
  // debug showed it). Tagged to the owner (mentionedUserId = run owner) so the
  // /messages ACL groups it with the mention; created BEFORE finalize so the
  // run links to it via chatMessageId.
  const delivery = isTwinDelivery(payload.twinDelivery) ? payload.twinDelivery : undefined;
  const outcomeText = twinOutcomeText(delivery);
  let twinAssistantMsgId: string | undefined;
  if (ctx.conversationId && ctx.agentSlug && ctx.agentOrgId && ctx.mentionedUserId) {
    try {
      const outcomeMsg = await chatMessageRepository.create({
        conversationId: ctx.conversationId,
        agentSlug: ctx.agentSlug,
        userId: ctx.mentionedUserId,
        orgId: ctx.agentOrgId,
        role: "assistant",
        content: outcomeText,
        status: "completed",
        ...(payload.reasoning ? { reasoning: payload.reasoning } : {}),
      });
      twinAssistantMsgId = outcomeMsg.id;
    } catch (e) {
      clog.warn(`[webhook/result] Twin: failed to persist outcome chat message for ${sessionId}: ${errMsg(e)}`);
    }
  }

  if (sessionId) {
    const deliveredText = typeof delivery?.message === "string" ? delivery.message : null;
    agentRunRepository.finalize(sessionId, {
      status: "completed",
      result: deliveredText,
      error: null,
      ...(twinAssistantMsgId ? { chatMessageId: twinAssistantMsgId } : {}),
      ...(payload.provider !== undefined ? { provider: payload.provider } : {}),
      ...(payload.model !== undefined ? { model: payload.model } : {}),
      ...(payload.reasoning ? { reasoning: payload.reasoning } : {}),
      toolsUsed: payload.toolsUsed ?? [],
      ...(payload.toolInvocations !== undefined ? { toolInvocations: payload.toolInvocations } : {}),
      ...(payload.tokenUsage ? { tokenUsage: payload.tokenUsage } : {}),
      ...(payload.latency ? { latency: payload.latency } : {}),
      ...(payload.fastMode !== undefined ? { fastMode: payload.fastMode === true } : {}),
    }).catch(() => {});
    await handleRunCompletion(sessionId, "completed").catch((err) => {
      clog.warn(`[webhook/result] Twin: failed to settle run recovery for ${sessionId}:`, err instanceof Error ? err.message : err);
    });
  }

  // action="ignore" is a CONFIDENT decision to post nothing. It is a valid
  // delivery (isTwinDelivery returns true), so this MUST be checked BEFORE the
  // draft dispatch — otherwise it would wrongly open an approval DM. Drop it and
  // end the session; no DM, no post, no pending feedback row.
  if (!delivery) {
    clog.info(`[webhook/result] Digital Twin stayed silent — no twin_deliver delivery (fail-closed), session ${sessionId}`);
    await deleteSession(sessionId);
  } else if (delivery.action === "ignore") {
    clog.info(`[webhook/result] Digital Twin chose to ignore — dropping, no DM/post, session ${sessionId}`);
    await deleteSession(sessionId);
  } else {
    await sendTwinReplyDraft(ctx, delivery, payload.toolInvocations, sessionId, payload.attachments);
  }
}
