/**
 * Digital Twin mention intake — the two per-mention decisions the webhook makes
 * before dispatching a twin run for a USER_MENTIONED event:
 *
 *  1. findEligibleTwins   — which mentioned users can have a twin run at all.
 *  2. twinGateAllowsDispatch — for "learned"-policy users, whether the learned
 *     respond/ignore gate says the twin should reply (or stay silent).
 *
 * The dispatch loop itself stays in routes/webhook.ts; it owns the per-iteration
 * error isolation and the run dispatch.
 */

import { userRepository } from "../repositories/index.js";
import { getSpacesAuthForUser } from "../lib/spaces-db.js";
import type { Logger } from "../logger.js";
import { shouldTwinRespond, recordTwinSilence, FAIL_CLOSED } from "./twinRespondGate.js";

/** The webhook payload fields the gate consults (mirrors WebhookEvent.payload in routes/webhook.ts). */
export interface TwinMentionPayload {
  conversationId: string;
  messageId: string;
  content: string;
  cleanContent: string;
  createdAt: string | number;
  userId: string;
  channelId: string;
  senderName?: string;
  channelName?: string;
}

/**
 * Eligibility (registered in claw-auth + digitalTwinEnabled + resolvable Spaces
 * workspaceId) is checked once per mentioned user, so an opted-out /
 * unresolvable user is skipped individually without dropping the rest.
 */
export async function findEligibleTwins(
  mentionedUserIds: readonly string[],
  log: Logger,
): Promise<Array<{ userId: string; workspaceId: string; respondPolicy: string }>> {
  const mentioned = Array.from(new Set(mentionedUserIds));
  const eligibleTwins: Array<{ userId: string; workspaceId: string; respondPolicy: string }> = [];
  for (const uid of mentioned) {
    const u = await userRepository.findById(uid).catch(() => null);
    if (!u) {
      log.info(`Twin: skipping ${uid} — not registered in claw-auth`);
      continue;
    }
    if (!u.digitalTwinEnabled) {
      log.info(`Twin: skipping ${uid} — Digital Twin disabled`);
      continue;
    }
    const twinAuth = await getSpacesAuthForUser(uid, "webhook").catch(() => null);
    if (!twinAuth?.workspaceId) {
      log.info(`Twin: skipping ${uid} — no resolvable workspaceId (no active Spaces session)`);
      continue;
    }
    eligibleTwins.push({
      userId: uid,
      workspaceId: twinAuth.workspaceId,
      respondPolicy: u.digitalTwinRespondPolicy ?? "learned",
    });
  }
  if (eligibleTwins.length === 0) {
    log.info(`Twin: no eligible mentioned users among [${mentioned.join(", ")}] — nothing to dispatch`);
  }
  return eligibleTwins;
}

/**
 * Learned respond/ignore gate — only for users who opted in. Consults their
 * captured patterns. FAIL-CLOSED: the twin posts ONLY on a usable gate
 * "respond". A respond:false (at any confidence), or a null/errored gate, →
 * stay silent (returns false). Better a wrong silence (recoverable via the
 * should-have-replied feedback loop) than a wrong post AS the user.
 */
export async function twinGateAllowsDispatch(
  userId: string,
  payload: TwinMentionPayload,
  log: Logger,
): Promise<boolean> {
  const decision = await shouldTwinRespond(userId, {
    incoming: payload.content ?? "",
    ...(payload.channelName ? { channelName: payload.channelName } : {}),
    ...(payload.channelId ? { channelId: payload.channelId } : {}),
    ...(payload.conversationId ? { conversationId: payload.conversationId } : {}),
    ...(payload.senderName ? { senderName: payload.senderName } : {}),
    ...(payload.userId ? { senderId: payload.userId } : {}),
    ...(payload.messageId ? { sourceMessageId: payload.messageId } : {}),
  }).catch(() => null);
  if (!decision || !decision.respond) {
    log.info(
      `Twin: staying silent for ${userId} — ${
        decision
          ? `gate ignore (conf ${decision.confidence.toFixed(2)}): ${decision.reason}`
          : "gate unavailable (fail-closed)"
      }`,
    );
    // Record the silence so the daily pipeline can reconcile it: if the
    // user replies themselves, it becomes a "should have responded"
    // correction that feeds future gate decisions.
    await recordTwinSilence(
      userId,
      {
        sourceMessageId: payload.messageId,
        ...(payload.channelId ? { channelId: payload.channelId } : {}),
        ...(payload.channelName ? { channelName: payload.channelName } : {}),
        ...(payload.userId ? { senderId: payload.userId } : {}),
        occurredAt: payload.createdAt,
        triggerPreview: payload.cleanContent || payload.content,
      },
      decision ?? FAIL_CLOSED,
    ).catch(() => {});
    return false;
  }
  log.info(
    `Twin: proceeding for ${userId} — gate=${decision.source} respond=true conf=${decision.confidence.toFixed(2)}`,
  );
  return true;
}
