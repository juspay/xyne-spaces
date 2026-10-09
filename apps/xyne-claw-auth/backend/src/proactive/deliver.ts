import { prisma } from "../db.js";
import { errMsg } from "../lib/errors.js";
import { dispatchOrQueueChannelRun } from "../surfaces/messaging/busy.js";
import { channelConversationId } from "../surfaces/messaging/ids.js";
import { isMessagingChannelKey, type MessagingChannelKey } from "../surfaces/messaging/plugin.js";
import { PROACTIVE } from "./config.js";

export type DeliveryResult =
  | { ok: true; channel: MessagingChannelKey; sessionId: string | null }
  | { ok: false; reason: string };

const CHANNEL_PREFERENCE: MessagingChannelKey[] = ["whatsapp", "whatsapp-cloud"];

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
    select: { id: true, slug: true, name: true, orgId: true, config: true, enabled: true },
  });
  if (!agent || !agent.enabled) return { ok: false, reason: "agent_unavailable" };

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
  const ordered = accounts
    .filter((a) => isMessagingChannelKey(a.surface.key))
    .sort((a, b) => CHANNEL_PREFERENCE.indexOf(a.surface.key as MessagingChannelKey) - CHANNEL_PREFERENCE.indexOf(b.surface.key as MessagingChannelKey));

  let reason = "no_channel";
  for (const account of ordered) {
    const channel = account.surface.key as MessagingChannelKey;
    const identity = await prisma.userSurfaceIdentity.findFirst({
      where: { surfaceId: account.surfaceId, userId: input.userId, orgId: account.orgId, status: "ACTIVE" },
      orderBy: { lastSeenAt: "desc" },
      select: { surfaceUserId: true, lastSeenAt: true },
    });
    if (!identity) {
      reason = "user_not_linked";
      continue;
    }
    if (
      channel === "whatsapp-cloud" &&
      (!identity.lastSeenAt || input.now.getTime() - identity.lastSeenAt.getTime() > PROACTIVE.cloudWindowMs)
    ) {
      reason = "outside_cloud_window";
      continue;
    }
    const chatId = identity.surfaceUserId;
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
