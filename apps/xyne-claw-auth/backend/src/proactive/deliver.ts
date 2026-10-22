import { prisma } from "../db.js";
import { deliveryPlan, loadDeliveryPreference } from "../lib/delivery-preference.js";
import { errMsg } from "../lib/errors.js";
import { dispatchOrQueueChannelRun } from "../surfaces/messaging/busy.js";
import { channelConversationId } from "../surfaces/messaging/ids.js";
import { isMessagingChannelKey, type MessagingChannelKey } from "../surfaces/messaging/plugin.js";
import { PROACTIVE } from "./config.js";
import { orderDeliveryTargets, type DeliveryCandidate } from "./delivery-order.js";

export type DeliveryResult =
  | { ok: true; channel: MessagingChannelKey; sessionId: string | null }
  | { ok: false; reason: string };

export async function deliverNudge(input: {
  userId: string;
  agentId: string | null;
  task: string;
  idempotencyKey: string;
  now: Date;
}): Promise<DeliveryResult> {
  if (!input.agentId) return { ok: false, reason: "no_agent" };
  const agent = await prisma.agent.findUnique({
    where: { id: input.agentId },
    select: { id: true, slug: true, name: true, orgId: true, config: true, enabled: true, delegationTier: true },
  });
  if (!agent || !agent.enabled) return { ok: false, reason: "agent_unavailable" };

  // A nudge is an agent run in a messaging chat, so of the person's order
  // (lib/delivery-preference.ts) only WhatsApp can carry it today: Spaces
  // has no nudge path and Teams no channel. With no order chosen this is
  // ["whatsapp"], the old behaviour; one that leaves WhatsApp out is a "not
  // there", which is respected rather than overridden.
  const plan = deliveryPlan(await loadDeliveryPreference(input.userId, agent.orgId), ["whatsapp"]);
  if (!plan.includes("whatsapp")) return { ok: false, reason: "preference_excludes_whatsapp" };

  const bindings = await prisma.surfaceAgent.findMany({
    where: { agentId: agent.id },
    select: { surfaceId: true, surfaceTenantId: true },
  });
  if (bindings.length === 0) return { ok: false, reason: "no_channel" };
  const accounts = await prisma.connectedSurface.findMany({
    where: {
      status: "ACTIVE",
      OR: bindings.map((b) => ({ surfaceId: b.surfaceId, surfaceTenantId: b.surfaceTenantId })),
    },
    include: { surface: { select: { key: true } } },
  });
  const candidates: DeliveryCandidate<(typeof accounts)[number]>[] = [];
  for (const account of accounts) {
    if (!isMessagingChannelKey(account.surface.key)) continue;
    const identity = await prisma.userSurfaceIdentity.findFirst({
      // Verified numbers only: an unverified link may be somebody else's phone.
      where: {
        surfaceId: account.surfaceId,
        userId: input.userId,
        orgId: account.orgId,
        status: "ACTIVE",
        verifiedAt: { not: null },
      },
      orderBy: { lastSeenAt: "desc" },
      select: { surfaceUserId: true, lastSeenAt: true },
    });
    if (identity) candidates.push({ account, channel: account.surface.key, senderId: identity.surfaceUserId, lastSeenAt: identity.lastSeenAt });
  }
  const { usable, reason: skipReason } = orderDeliveryTargets(candidates, input.now, PROACTIVE);
  let reason = skipReason;
  for (const { account, channel, senderId } of usable) {
    const chatId = senderId;
    try {
      const outcome = await dispatchOrQueueChannelRun({
        agent,
        userId: input.userId,
        task: input.task,
        conversationId: channelConversationId(channel, account.surfaceTenantId, agent.slug, chatId),
        eventType: "DIRECT_MESSAGE",
        idempotencyKey: input.idempotencyKey,
        target: {
          channel,
          connectedSurfaceId: account.id,
          accountKey: account.surfaceTenantId,
          chatId,
          senderId: chatId,
          isGroup: false,
        },
      });
      if (outcome.kind === "dispatched") return { ok: true, channel, sessionId: outcome.sessionId };
      if (outcome.accepted) return { ok: true, channel, sessionId: null };
      reason = "conversation_busy";
    } catch (err) {
      reason = `dispatch_failed: ${errMsg(err).slice(0, 200)}`;
    }
  }
  return { ok: false, reason };
}
